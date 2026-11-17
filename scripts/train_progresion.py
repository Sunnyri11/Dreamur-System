"""Entrena el modelo de PROGRESIÓN a partir de seguimientos (estudios seriados del mismo paciente / caso).

Necesita estudios con fecha, agrupados por paciente (paciente_id o grupo_ref) y con etiquetas confirmadas de
grado/malignidad o, mejor, la columna `progresion` (p. ej. RANO de LUMIERE, o criterio médico). Para cada
estudio t se calculan las características con el historial hasta t (las mismas que usa la API) y el objetivo es
si el estudio siguiente (t+1) muestra progresión. Hasta tener suficientes seguimientos, la API usa solo reglas.

Uso:  python -m scripts.train_progresion [--min-muestras 60]
"""
import argparse
import tempfile
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
from xgboost import XGBClassifier

from app import db, history, readers, registry, storage, viz
from app import taxonomy as tx
from psycopg.types.json import Jsonb


def _punto_modelo(predictores, modalidad, fila):
    if modalidad not in predictores:
        predictores[modalidad] = registry.obtener(modalidad)
    cortes, _ = readers.cargar_cortes(storage.get_bytes(fila["storage_key"]), fila["storage_key"], 6, fila["corte_clave"])
    pred = predictores[modalidad].predecir(cortes)
    zonas = viz.cam_to_boxes(pred["cam"]) if tx.es_tumor(pred["tipo"]["clase"]) else []
    return history.punto(fila["estudio_id"], fila["fecha"], pred["tipo"]["clase"], pred["prob_maligno"],
                         viz.area_total(zonas), (pred.get("grado_oms") or {}).get("probabilidades"))


def _progreso(a, b):
    """Objetivo derivado de etiquetas cuando no hay columna `progresion`."""
    if b["progresion"] is not None:
        return int(b["progresion"])
    if a["grado_oms"] and b["grado_oms"]:
        return int(tx.GRADO_OMS.index(b["grado_oms"]) > tx.GRADO_OMS.index(a["grado_oms"]))
    if a["malignidad"] and b["malignidad"]:
        return int(a["malignidad"] == "benigno" and b["malignidad"] == "maligno")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-muestras", type=int, default=60)
    a = ap.parse_args()
    with db.cursor() as cur:
        cur.execute(
            "SELECT e.id AS estudio_id, COALESCE(e.paciente_id::text, e.grupo_ref) AS grupo, e.paciente_id, "
            "e.modalidad, e.fecha_estudio AS fecha, l.grado_oms, l.malignidad, l.progresion, "
            "f.storage_key, f.corte_clave FROM estudios e JOIN etiquetas l ON l.estudio_id=e.id "
            "JOIN estudio_archivos f ON f.estudio_id=e.id AND f.orden=0 "
            "WHERE e.deleted_at IS NULL AND e.fecha_estudio IS NOT NULL AND COALESCE(e.paciente_id::text, e.grupo_ref) IS NOT NULL")
        filas = cur.fetchall()
        cur.execute("SELECT paciente_id::text AS grupo, tipo, fecha FROM eventos_clinicos")
        eventos = defaultdict(list)
        for r in cur.fetchall():
            eventos[r["grupo"]].append(r)
    secuencias = defaultdict(list)
    for r in filas:
        secuencias[(r["grupo"], r["modalidad"])].append(r)

    predictores, X, y, grupos = {}, [], [], []
    for (g, mod), seq in secuencias.items():
        seq.sort(key=lambda r: r["fecha"])
        if len(seq) < 2:
            continue
        try:
            pts = [_punto_modelo(predictores, mod, r) for r in seq]
        except registry.ModeloNoDisponible:
            print(f"  (omito '{mod}': aún no hay modelo entrenado)")
            continue
        for i in range(len(seq) - 1):
            obj = _progreso(seq[i], seq[i + 1])
            if obj is None:
                continue
            f = history.construir_features(pts[:i], pts[i], eventos.get(g, []))
            X.append(history.vector(f))
            y.append(obj)
            grupos.append(g)
    print(f"{len(y)} pares de seguimiento utilizables ({sum(y)} con progresión)")
    if len(y) < a.min_muestras or len(set(y)) < 2:
        raise SystemExit(f"Aún no hay suficientes seguimientos etiquetados (mínimo {a.min_muestras}, con ambas clases). "
                         "La API seguirá usando reglas. Revisa el manifiesto con la columna `progresion`.")
    X, y, grupos = np.array(X, dtype=np.float32), np.array(y), np.array(grupos)
    tr, te = next(GroupShuffleSplit(1, test_size=0.25, random_state=42).split(X, y, grupos))
    m = XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.8, tree_method="hist",
                      n_jobs=2, scale_pos_weight=max((y[tr] == 0).sum() / max((y[tr] == 1).sum(), 1), 1.0))
    m.fit(X[tr], y[tr])
    p = m.predict_proba(X[te])[:, 1]
    met = {"accuracy": float(accuracy_score(y[te], p > 0.5)), "n_test": int(len(te)), "n_total": int(len(y))}
    if len(set(y[te])) == 2:
        met["auc"] = float(roc_auc_score(y[te], p))
    print("Métricas en prueba:", met)

    m.fit(X, y)  # modelo final con todos los datos
    with db.cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(version),0)+1 AS v FROM modelo_progresion")
        v = cur.fetchone()["v"]
        key = f"modelos/progresion/v{v}.json"
        with tempfile.TemporaryDirectory() as tmp:
            m.save_model(str(Path(tmp) / "p.json"))
            storage.upload_file(Path(tmp) / "p.json", key)
        activo = met.get("auc", 0) >= 0.6
        if activo:
            cur.execute("UPDATE modelo_progresion SET activo=FALSE WHERE activo")
        cur.execute("INSERT INTO modelo_progresion (version, pesos_key, columnas, n_muestras, metricas, activo) "
                    "VALUES (%s,%s,%s,%s,%s,%s)", (v, key, Jsonb(history.COLUMNAS), len(y), Jsonb(met), activo))
    print(f"Modelo de progresión v{v} guardado ({'ACTIVO' if activo else 'inactivo: AUC < 0,6 o no medible'}).")


if __name__ == "__main__":
    main()
