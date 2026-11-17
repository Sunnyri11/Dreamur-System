"""Genera COMPARACION_RESULTADOS.md con las métricas reales de cada modelo entrenado (leídas de Neon).

Compara, sobre el MISMO conjunto de prueba y para cada cabeza (tipo, malignidad, grado, grado_oms):
CNN+red neuronal (red) · XGBoost · mezcla (la que se usa en producción).
Uso:  python -m scripts.comparar [--modalidad mri] [--salida COMPARACION_RESULTADOS.md]
"""
import argparse
from pathlib import Path

from app import db


def _fila(nombre, m):
    auc = f"{m['auc_maligno']:.4f}" if "auc_maligno" in m else "–"
    return f"| {nombre} | {m['accuracy']:.4f} | {m['f1_macro']:.4f} | {m['log_loss']:.4f} | {auc} | {m['n']} |"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modalidad")
    ap.add_argument("--salida", default="COMPARACION_RESULTADOS.md")
    a = ap.parse_args()
    with db.cursor() as cur:
        cur.execute("SELECT modalidad, version, activo, n_muestras, metricas FROM modelo_versiones "
                    "WHERE (%s::text IS NULL OR modalidad=%s) ORDER BY modalidad, version DESC", (a.modalidad, a.modalidad))
        filas = cur.fetchall()
    if not filas:
        raise SystemExit("No hay modelos entrenados todavía. Ejecuta scripts/train.py primero.")

    out = ["# Comparación de modelos reales", "",
           "Métricas sobre el conjunto de PRUEBA (datos que el modelo no vio). Accuracy engaña con clases "
           "desbalanceadas: mira F1 macro, el recall por clase y el AUC de malignidad.", ""]
    for f in filas:
        m = f["metricas"] or {}
        test = m.get("test") or {}
        out += [f"## {f['modalidad']} · versión {f['version']} {'(ACTIVA)' if f['activo'] else ''}",
                f"Muestras: {f['n_muestras']} · backbone: {m.get('backbone')} · etiquetas por cabeza: {m.get('etiquetas_por_cabeza')}",
                f"Peso de XGBoost en la mezcla: { {h: v['w'] for h, v in (m.get('xgb') or {}).items()} }", ""]
        for h, variantes in test.items():
            out += [f"### Cabeza `{h}`", "", "| Modelo | Accuracy | F1 macro | Log-loss | AUC maligno | n |", "|---|---|---|---|---|---|"]
            for clave, nombre in (("red", "CNN + red neuronal"), ("xgb", "XGBoost"), ("mezcla", "Mezcla (producción)")):
                if clave in variantes:
                    out.append(_fila(nombre, variantes[clave]))
            if h in ("tipo", "malignidad") and "mezcla" in variantes:
                out += ["", "Por clase (mezcla):", "", "| Clase | Precisión | Recall (sensibilidad) | F1 |", "|---|---|---|---|"]
                for c, v in variantes["mezcla"]["por_clase"].items():
                    out.append(f"| {c} | {v['precision']:.3f} | {v['recall']:.3f} | {v['f1']:.3f} |")
            out.append("")
    Path(a.salida).write_text("\n".join(out), encoding="utf-8")
    print(f"Escrito {a.salida}")


if __name__ == "__main__":
    main()
