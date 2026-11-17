"""API de Dreamur-Detector v2 (servicio de IA). El backend la llama con la cabecera X-API-Key.

Quien llama (el backend) es responsable de comprobar que el usuario tiene permiso sobre el estudio / paciente.
"""
import hmac
import logging
import uuid
from datetime import date
from typing import Optional

import numpy as np
import psycopg
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from . import conocimiento, db, gemma, history, readers, registry, storage, training, viz
from . import taxonomy as tx
from .config import settings

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("dreamur.api")

app = FastAPI(title="Dreamur-Detector (tumores cerebrales)", version="3.0.0")


def auth(x_api_key: Optional[str] = Header(None)):
    if not x_api_key or not hmac.compare_digest(x_api_key, settings.ml_api_key):
        raise HTTPException(401, "API key inválida")


def _modalidad_ok(modalidad: str) -> str:
    try:
        tx.validar_modalidad(modalidad)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return modalidad


def _predictor(modalidad: str):
    try:
        return registry.obtener(modalidad)
    except registry.ModeloNoDisponible as e:
        raise HTTPException(503, str(e))


def _leer(data: bytes, nombre: str, max_cortes: int, indice=None):
    try:
        return readers.cargar_cortes(data, nombre, max_cortes, indice)
    except readers.ArchivoNoSoportado as e:
        raise HTTPException(422, str(e))


def _publico(pred: dict) -> dict:
    """Quita lo no serializable (mapa de calor) de la predicción."""
    return {k: v for k, v in pred.items() if k != "cam"}


def _zonas_y_overlay(pred: dict, img):
    tumor = tx.es_tumor(pred["tipo"]["clase"])
    zonas = viz.cam_to_boxes(pred["cam"]) if tumor else []
    nombre = tx.TIPOS[pred["tipo"]["clase"]][0]
    return zonas, viz.overlay_png(img, pred["cam"], zonas, f"{nombre} {pred['tipo']['confianza']:.0%}")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/modelos")
def modelos(_=Depends(auth)):
    """Modelos activos + formatos aceptados (para que el frontend sepa qué ofrecer)."""
    return {"modelos": registry.modelos_activos(), "modalidades": tx.MODALIDADES, "secuencias": tx.SECUENCIAS,
            "formatos": {"imagen": list(readers.EXT_IMAGEN), "dicom": [".dcm"], "nifti": [".nii", ".nii.gz"],
                         "zip": [".zip (serie DICOM, NIfTI o imágenes)"]},
            "max_mb_estudio": settings.max_bytes_estudio // (1024 * 1024)}


@app.get("/catalogo")
def catalogo(_=Depends(auth)):
    return [{"codigo": c, "nombre": v[0], "es_tumor": v[1], "naturaleza_general": v[2]} for c, v in tx.TIPOS.items()]


@app.post("/predecir")
def predecir(archivo: UploadFile = File(...), modalidad: str = Form("mri"), _=Depends(auth)):
    """Prueba rápida con un archivo suelto (imagen, DICOM, NIfTI o ZIP). NO guarda nada y no usa historial."""
    dom = _modalidad_ok(modalidad)
    data = archivo.file.read(settings.max_bytes_estudio + 1)
    if len(data) > settings.max_bytes_estudio:
        raise HTTPException(413, f"Archivo demasiado grande (máx. {settings.max_bytes_estudio // (1024 * 1024)} MB)")
    predictor = _predictor(dom)
    cortes, meta = _leer(data, archivo.filename or "", settings.max_cortes)
    pred = predictor.predecir(cortes)
    zonas, png = _zonas_y_overlay(pred, cortes[pred["corte_representativo"]])
    informe = gemma.redactar_informe(pred, None, len(zonas))
    return {"modelo_version": predictor.version, "modalidad": dom, "archivo": meta, "resultado": _publico(pred),
            "zonas": zonas, "informe": informe, "overlay_base64": viz.a_base64(png)}

@app.post("/predict")
def predict_compat(file: UploadFile = File(...), region: str = Form("cerebro"), _=Depends(auth)):
    """Puente para el backend .NET: reutiliza la lógica de /predecir y adapta el JSON."""
    res = predecir(archivo=file, modalidad="mri")
    pred = res["resultado"]
    tipo_info = pred["tipo"]
    probs = pred.get("probabilidades_por_cabeza", {}).get("tipo") or tipo_info.get("probabilidades") or {}
    
    # Convierte la versión (ej. "3.0.0" o "v3") a entero para .NET (int? ModeloVersion)
    digitos = "".join(c for c in str(res["modelo_version"]).split(".")[0] if c.isdigit())
    ver_num = int(digitos) if digitos else 3

    return {
        "imagen_valida": True,
        "tipo_imagen": "resonancia_cerebral",
        "mensaje": None,
        "tipo_tumor": tipo_info["clase"],
        "confianza": tipo_info["confianza"],
        "probabilidades": probs,
        "zonas": res["zonas"],
        "modelo_version": ver_num
    }

class AnalizarIn(BaseModel):
    estudio_id: uuid.UUID
    solicitado_por: Optional[uuid.UUID] = None
    incluir_overlay_base64: bool = False
    usar_gemma: bool = True


def _historial_previo(cur, paciente_id, modalidad, estudio_id, hasta: date):
    cur.execute(
        "SELECT DISTINCT ON (d.estudio_id) d.estudio_id, COALESCE(e.fecha_estudio, d.created_at::date) AS fecha, "
        "d.tipo_tumor, d.prob_maligno, d.area_zonas, d.probabilidades "
        "FROM detecciones d JOIN estudios e ON e.id = d.estudio_id "
        "WHERE e.paciente_id=%s AND d.modalidad=%s AND e.id<>%s AND e.deleted_at IS NULL "
        "AND COALESCE(e.fecha_estudio, d.created_at::date) <= %s "
        "ORDER BY d.estudio_id, d.created_at DESC", (paciente_id, modalidad, estudio_id, hasta))
    return history.puntos_desde_filas(cur.fetchall())


def _evolucion(cur, est: dict, modalidad: str, pred: dict, area: float, fecha: date) -> dict:
    """Compara con el historial del mismo paciente. Sin paciente (p. ej. estudios de dataset) no hay historial."""
    if est["paciente_id"] is None:
        return {"disponible": False, "mensaje": "Estudio sin paciente asociado: no hay historial."}
    previos = _historial_previo(cur, est["paciente_id"], modalidad, est["id"], fecha)
    cur.execute("SELECT tipo, fecha FROM eventos_clinicos WHERE paciente_id=%s", (est["paciente_id"],))
    eventos = cur.fetchall()
    cur.execute("SELECT fecha_nacimiento FROM personas WHERE id=%s", (est["paciente_id"],))
    nac = (cur.fetchone() or {}).get("fecha_nacimiento")
    edad = (fecha - nac).days // 365 if nac else None
    actual = history.punto(est["id"], fecha, pred["tipo"]["clase"], pred["prob_maligno"], area,
                           (pred.get("grado_oms") or {}).get("probabilidades"))
    f = history.construir_features(previos, actual, eventos, edad)
    p_modelo = None
    if f["n_previos"]:
        try:
            modelo, columnas = registry.obtener_progresion()
            if modelo is not None and columnas == history.COLUMNAS:
                p_modelo = float(modelo.predict_proba(np.array([history.vector(f)], dtype=np.float32))[0, 1])
        except Exception:
            log.exception("No se pudo usar el modelo de progresión; se usan reglas")
    return history.estimar(f, actual, p_modelo)


@app.post("/analizar")
def analizar(body: AnalizarIn, _=Depends(auth)):
    """Flujo real: el estudio ya está en el bucket y registrado en la BD (estudios + estudio_archivos)."""
    with db.cursor() as cur:
        cur.execute("SELECT id, paciente_id, modalidad, fecha_estudio FROM estudios "
                    "WHERE id=%s AND deleted_at IS NULL", (body.estudio_id,))
        est = cur.fetchone()
        if est is None:
            raise HTTPException(404, "Estudio no encontrado")
        cur.execute("SELECT id, orden, formato, nombre_original, storage_key, tam_bytes, corte_clave FROM estudio_archivos "
                    "WHERE estudio_id=%s ORDER BY orden", (body.estudio_id,))
        archivos = cur.fetchall()
    if not archivos:
        raise HTTPException(422, "El estudio no tiene archivos")
    if sum(a["tam_bytes"] or 0 for a in archivos) > settings.max_bytes_estudio:
        raise HTTPException(413, "El estudio supera el tamaño máximo permitido")
    dom = _modalidad_ok(est["modalidad"])
    predictor = _predictor(dom)

    # Un estudio puede tener varios archivos (cortes sueltos o un volumen): se reparten los cortes entre ellos.
    por_archivo = max(1, settings.max_cortes // len(archivos))
    cortes, origen, fecha_dicom = [], [], None
    for a in archivos:
        cs, meta = _leer(storage.get_bytes(a["storage_key"]), a["nombre_original"] or a["storage_key"], por_archivo, a["corte_clave"])
        cortes += cs
        origen += [(a["id"], i) for i in meta["indices"][:len(cs)]]
        fecha_dicom = fecha_dicom or meta.get("fecha_estudio")
    pred = predictor.predecir(cortes)
    rep = pred["corte_representativo"]
    archivo_rep, corte_rep = origen[rep]
    zonas, png = _zonas_y_overlay(pred, cortes[rep])
    area = viz.area_total(zonas)
    fecha = est["fecha_estudio"] or (date.fromisoformat(fecha_dicom) if fecha_dicom else date.today())

    det_id = uuid.uuid4()
    overlay_key = f"overlays/{body.estudio_id}/{det_id}.png"
    storage.put_bytes(overlay_key, png, "image/png")
    tumor = tx.es_tumor(pred["tipo"]["clase"])
    mal = pred["malignidad"]
    try:
        with db.cursor() as cur:
            evolucion = _evolucion(cur, est, dom, pred, area, fecha)
            informe = gemma.redactar_informe(pred, evolucion, len(zonas), body.usar_gemma)
            cur.execute(
                "INSERT INTO detecciones (id, estudio_id, archivo_id, modelo_version_id, modalidad, tiene_tumor, tipo_tumor, "
                "malignidad, malignidad_fuente, prob_maligno, grado, grado_oms, confianza, probabilidades, n_cortes, "
                "corte_representativo, area_zonas, solicitado_por, overlay_key, informe, evolucion) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (det_id, body.estudio_id, archivo_rep, predictor.version_id, dom, tumor, pred["tipo"]["clase"],
                 mal["clase"] if mal else None, mal["fuente"] if mal else None, pred["prob_maligno"],
                 (pred["grado"] or {}).get("clase"), (pred["grado_oms"] or {}).get("clase"), pred["tipo"]["confianza"],
                 Jsonb(pred["probabilidades_por_cabeza"]), pred["n_cortes"], corte_rep, area, body.solicitado_por,
                 overlay_key, Jsonb(informe), Jsonb(evolucion, dumps=_dumps)))
            for i, z in enumerate(zonas, 1):
                cur.execute("INSERT INTO detecciones_zonas (deteccion_id, orden, x, y, ancho, alto, puntaje) "
                            "VALUES (%s,%s,%s,%s,%s,%s,%s)",
                            (det_id, i, z["x"], z["y"], z["ancho"], z["alto"], z["puntaje"]))
            cur.execute("UPDATE estudios SET estado='analizado', fecha_estudio=COALESCE(fecha_estudio, %s) "
                        "WHERE id=%s", (fecha, body.estudio_id))
            cur.execute("INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle) "
                        "VALUES (%s,'analizar','estudio',%s,%s)",
                        (body.solicitado_por, str(body.estudio_id),
                         Jsonb({"deteccion_id": str(det_id), "modalidad": dom, "modelo_version": predictor.version})))
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(422, "solicitado_por no es un usuario existente (o el tipo no está en tipos_tumor: ejecuta init_db)")

    out = {"deteccion_id": str(det_id), "estudio_id": str(body.estudio_id), "modalidad": dom,
           "modelo_version": predictor.version, "tiene_tumor": tumor, "resultado": _publico(pred), "zonas": zonas,
           "area_zonas": area, "informe": informe, "evolucion": evolucion, "overlay_key": overlay_key,
           "overlay_url": storage.presign(overlay_key, 3600)}
    if body.incluir_overlay_base64:
        out["overlay_base64"] = viz.a_base64(png)
    return out


def _dumps(obj):
    import json
    return json.dumps(obj, default=lambda o: o.isoformat() if hasattr(o, "isoformat") else str(o))


@app.get("/historial/{paciente_id}")
def historial(paciente_id: uuid.UUID, modalidad: Optional[str] = None, _=Depends(auth)):
    """Línea de tiempo de detecciones del paciente (más antiguo primero) + evolución entre los dos últimos estudios."""
    with db.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT ON (d.estudio_id) d.estudio_id, d.id AS deteccion_id, e.modalidad, e.secuencia, "
            "COALESCE(e.fecha_estudio, d.created_at::date) AS fecha, d.tipo_tumor, d.malignidad, d.prob_maligno, "
            "d.grado, d.grado_oms, d.confianza, d.area_zonas, d.probabilidades "
            "FROM detecciones d JOIN estudios e ON e.id=d.estudio_id "
            "WHERE e.paciente_id=%s AND e.deleted_at IS NULL AND (%s::text IS NULL OR e.modalidad=%s) "
            "ORDER BY d.estudio_id, d.created_at DESC", (paciente_id, modalidad, modalidad))
        filas = sorted(cur.fetchall(), key=lambda r: r["fecha"])
        cur.execute("SELECT tipo, descripcion, fecha FROM eventos_clinicos WHERE paciente_id=%s ORDER BY fecha", (paciente_id,))
        eventos = cur.fetchall()
    evol = {"disponible": False, "mensaje": "Se necesitan al menos dos estudios de la misma modalidad para comparar."}
    if filas:
        dom = filas[-1]["modalidad"]
        pts = history.puntos_desde_filas([r for r in filas if r["modalidad"] == dom])
        if len(pts) >= 2:
            f = history.construir_features(pts[:-1], pts[-1], eventos)
            evol = history.estimar(f, pts[-1])
    for r in filas:
        r.pop("probabilidades", None)
    return {"paciente_id": str(paciente_id), "linea_de_tiempo": filas, "eventos_clinicos": eventos, "evolucion": evol}


class EntrenarIn(BaseModel):
    modalidad: str = "mri"
    epochs: int = Field(8, ge=1, le=50)
    activar: str = Field("auto", pattern="^(auto|si|no)$")


def _entrenar_bg(dom, epochs, activar):
    try:
        training.train(dom, epochs=epochs, disparado_por="api", activar=activar, progress=log.info)
    except training.EntrenamientoEnCurso:
        pass
    except Exception:
        log.exception("Falló el reentrenamiento")
    finally:
        registry.invalidar(dom)


@app.post("/entrenar", status_code=202)
def entrenar(body: EntrenarIn, bg: BackgroundTasks, _=Depends(auth)):
    """Reentrena el modelo de una modalidad. En la CPU de Render es lento: lo normal es entrenar en tu PC o Colab."""
    dom = _modalidad_ok(body.modalidad)
    if not settings.reentrenar_habilitado:
        raise HTTPException(403, "Reentrenamiento por API deshabilitado (ALLOW_RETRAIN_ENDPOINT=0)")
    if training.en_curso(dom):
        raise HTTPException(409, "Ya hay un entrenamiento en curso")
    bg.add_task(_entrenar_bg, dom, body.epochs, body.activar)
    return {"mensaje": "Entrenamiento iniciado", "consulta": f"GET /entrenar/estado?modalidad={body.modalidad}"}


@app.get("/entrenar/estado")
def entrenar_estado(modalidad: str = "mri", _=Depends(auth)):
    return training.estado_reciente(_modalidad_ok(modalidad))
