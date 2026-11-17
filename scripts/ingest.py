"""Sube un dataset al bucket R2 y registra estudios + etiquetas en Neon (REANUDABLE: omite lo ya subido por SHA-256).

Dataset con carpeta conocida (Brain Tumor MRI de Kaggle):
  python -m scripts.ingest --adaptador brain_kaggle --root "C:/datos/brain-tumor-mri-dataset"

Cualquier otro (Cheng, BraTS, UCSF-PDGM, UPENN-GBM, LUMIERE, datos propios) con un manifiesto CSV:
  python -m scripts.ingest --adaptador manifest --root "C:/datos/cheng_png" --manifest manifiesto_cheng.csv \
         --fuente-codigo cheng

Útiles:  --limite 200 (prueba rápida) · --max-por-clase 3000 (limita clases enormes)
"""
import argparse
import hashlib
import io
import random
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image
from psycopg.types.json import Jsonb

from app import db, readers, storage
from app import taxonomy as tx
from datasets.adapters import ADAPTADORES, FUENTES, manifest

LOTE = 100
MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".bmp": "image/bmp",
        ".tif": "image/tiff", ".tiff": "image/tiff", ".webp": "image/webp", ".dcm": "application/dicom",
        ".nii": "application/octet-stream", ".gz": "application/gzip", ".zip": "application/zip"}


def _ext(p: Path) -> str:
    return ".nii.gz" if p.name.lower().endswith(".nii.gz") else p.suffix.lower()


def _leer(m):
    data = m.ruta.read_bytes()
    return m, data, hashlib.sha256(data).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--adaptador", required=True, choices=[*ADAPTADORES, "manifest"])
    ap.add_argument("--root", required=True, help="Carpeta del dataset")
    ap.add_argument("--manifest", help="CSV (solo con --adaptador manifest)")
    ap.add_argument("--limite", type=int)
    ap.add_argument("--max-por-clase", type=int)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--fuente-codigo")
    ap.add_argument("--fuente-nombre")
    ap.add_argument("--fuente-url")
    ap.add_argument("--fuente-licencia")
    a = ap.parse_args()

    raiz = Path(a.root)
    if not raiz.is_dir():
        raise SystemExit(f"No existe la carpeta {raiz}")
    if a.adaptador == "manifest":
        if not a.manifest:
            raise SystemExit("--adaptador manifest requiere --manifest")
        muestras = list(manifest(raiz, Path(a.manifest)))
        fuente = a.fuente_codigo or "manifest"
    else:
        muestras = list(ADAPTADORES[a.adaptador](raiz))
        fuente = a.adaptador
    if not muestras:
        raise SystemExit("No encontré imágenes con esa estructura de carpetas. Revisa --root y el adaptador.")

    errores = []
    for m in muestras:
        try:
            tx.validar_modalidad(m.modalidad)
            tx.validar_etiqueta(m.tipo, m.malignidad, m.grado, m.grado_oms)
            if m.secuencia not in (None, *tx.SECUENCIAS):
                raise ValueError(f"secuencia inválida: {m.secuencia}")
            if m.split not in (None, "train", "val", "test"):
                raise ValueError(f"split inválido: {m.split}")
        except ValueError as e:
            errores.append(f"{m.ruta.name}: {e}")
    if errores:
        raise SystemExit("Etiquetas inválidas:\n  " + "\n  ".join(errores[:8]) + (f"\n  ... y {len(errores) - 8} más" if len(errores) > 8 else ""))

    if a.max_por_clase:
        rnd, cont, sel = random.Random(42), {}, []
        muestras = sorted(muestras, key=lambda m: str(m.ruta))
        rnd.shuffle(muestras)
        for m in muestras:
            if cont.get(m.tipo, 0) < a.max_por_clase:
                cont[m.tipo] = cont.get(m.tipo, 0) + 1
                sel.append(m)
        muestras = sel
    if a.limite:
        muestras = muestras[:a.limite]
    cuenta = {}
    for m in muestras:
        k = f"{m.modalidad}/{m.tipo}"
        cuenta[k] = cuenta.get(k, 0) + 1
    print(f"{len(muestras)} muestras:")
    for k, v in sorted(cuenta.items()):
        print(f"   {k}: {v}")

    info = dict(FUENTES.get(fuente, {}))
    info.update({k: v for k, v in (("nombre", a.fuente_nombre), ("url", a.fuente_url), ("licencia", a.fuente_licencia)) if v})
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO dataset_fuentes (codigo, nombre, url, licencia, citacion, notas) VALUES (%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (codigo) DO UPDATE SET nombre=EXCLUDED.nombre, url=EXCLUDED.url, licencia=EXCLUDED.licencia",
            (fuente, info.get("nombre", fuente), info.get("url"), info.get("licencia"), info.get("citacion"), info.get("notas")))
        cur.execute("SELECT sha256 FROM estudio_archivos")
        vistos = {r["sha256"] for r in cur.fetchall()}
    print(f"{len(vistos)} archivos ya registrados en la BD")

    nuevas = duplicadas = invalidas = 0
    with ThreadPoolExecutor(a.workers) as ex:
        for ini in range(0, len(muestras), LOTE):
            lote = []
            for m, data, sha in ex.map(_leer, muestras[ini:ini + LOTE]):
                if sha in vistos:
                    duplicadas += 1
                    continue
                formato = readers.detectar_formato(m.ruta.name, data)
                ancho = alto = None
                if formato == "imagen":
                    try:
                        with Image.open(io.BytesIO(data)) as im:
                            ancho, alto = im.size
                    except Exception:
                        invalidas += 1
                        continue
                vistos.add(sha)
                ext = _ext(m.ruta)
                lote.append((m, data, sha, formato, ancho, alto, f"estudios/dataset/{fuente}/{sha[:2]}/{sha}{ext}"))

            list(ex.map(lambda t: storage.put_bytes(t[6], t[1], MIME.get(_ext(t[0].ruta), "application/octet-stream")), lote))

            with db.cursor() as cur:
                for m, data, sha, formato, ancho, alto, key in lote:
                    cur.execute(
                        "INSERT INTO estudios (origen, dataset_fuente, grupo_ref, split_origen, modalidad, secuencia, "
                        "fecha_estudio, notas, estado) VALUES ('dataset',%s,%s,%s,%s,%s,%s,%s,'revisado') RETURNING id",
                        (fuente, m.grupo_ref, m.split, m.modalidad, m.secuencia, m.fecha, m.notas))
                    eid = cur.fetchone()["id"]
                    cur.execute(
                        "INSERT INTO estudio_archivos (estudio_id, orden, formato, nombre_original, storage_key, sha256, mime, "
                        "ancho, alto, tam_bytes, corte_clave) VALUES (%s,0,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (eid, formato, m.ruta.name, key, sha, MIME.get(_ext(m.ruta)), ancho, alto, len(data), m.corte))
                    cur.execute(
                        "INSERT INTO etiquetas (estudio_id, tiene_tumor, tipo_tumor, malignidad, grado, grado_oms, "
                        "histologia, molecular, progresion, fuente) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'dataset_inicial')",
                        (eid, tx.es_tumor(m.tipo), m.tipo, m.malignidad, m.grado, m.grado_oms, m.histologia,
                         Jsonb(m.molecular) if m.molecular else None, m.progresion))
            nuevas += len(lote)
            print(f"  {min(ini + LOTE, len(muestras))}/{len(muestras)} · nuevas={nuevas} duplicadas={duplicadas} inválidas={invalidas}")
    print(f"Listo. Nuevas: {nuevas} · duplicadas omitidas: {duplicadas} · inválidas: {invalidas}")


if __name__ == "__main__":
    main()
