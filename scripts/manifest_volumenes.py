"""Genera un manifiesto CSV para volúmenes NIfTI de cerebro (BraTS, Medical Segmentation Decathlon Task01...).

Elige para cada volumen el CORTE con más tumor (según su máscara) y lo escribe en la columna `corte`, para que el
entrenamiento use un corte que realmente muestra la lesión. Requiere: pip install nibabel

Diseños de carpeta admitidos:
  --layout brats : <root>/<caso>/<caso>_<seq>.nii[.gz]  y  <caso>_seg.nii[.gz]     (seq: flair, t1ce, t1, t2)
  --layout msd   : <root>/imagesTr/<caso>.nii.gz  y  <root>/labelsTr/<caso>.nii.gz  (mismo nombre; si el volumen es
                   4D, como Task01_BrainTumour, se usa el primer canal = FLAIR)

Ejemplo BraTS con grado LGG/HGG (CSV con columnas caso,grado[,grado_oms,malignidad]):
  python -m scripts.manifest_volumenes --root BraTS2020 --layout brats --sufijo flair --tipo glioma \
      --etiquetas-csv grados.csv --salida manifiesto_brats.csv
Luego:
  python -m scripts.ingest --adaptador manifest --root BraTS2020 --manifest manifiesto_brats.csv --fuente-codigo brats

Si todos los casos de la carpeta son del mismo tipo (p. ej. solo gliomas), basta con --tipo; si no, pon la columna
`tipo` en el CSV de etiquetas (glioma, meningioma, metastasis_cerebral).
"""
import argparse
import csv
from pathlib import Path

import numpy as np

from app import readers
from app import taxonomy as tx

SECUENCIA_DE = {"flair": "flair", "t1ce": "t1c", "t1c": "t1c", "t1": "t1", "t2": "t2"}


def _cargar(path: Path):
    import nibabel as nib
    return readers.nifti_a_array(nib.load(str(path)))


def _casos(root: Path, layout: str, sufijo: str):
    if layout == "msd":
        for img in sorted((root / "imagesTr").glob("*.nii*")):
            if img.name.startswith("."):
                continue
            seg = root / "labelsTr" / img.name
            if seg.exists():
                yield img.name.split(".")[0], img, seg
    else:
        for d in sorted(p for p in root.iterdir() if p.is_dir()):
            imgs = sorted(d.glob(f"*_{sufijo}.nii*"))
            segs = sorted(d.glob("*_seg.nii*"))
            if imgs and segs:
                yield d.name, imgs[0], segs[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", required=True)
    ap.add_argument("--layout", choices=["brats", "msd"], required=True)
    ap.add_argument("--sufijo", default="flair", help="secuencia BraTS a usar (flair, t1ce, t1, t2)")
    ap.add_argument("--tipo", help="tipo para todos los casos (ver app/taxonomy.py); o columna `tipo` en el CSV")
    ap.add_argument("--malignidad", help="solo si el dataset la define para TODOS los casos")
    ap.add_argument("--etiquetas-csv", help="CSV por caso: caso[,tipo,grado,grado_oms,malignidad]")
    ap.add_argument("--salida", default="manifiesto.csv")
    a = ap.parse_args()
    root = Path(a.root)

    extra = {}
    if a.etiquetas_csv:
        with open(a.etiquetas_csv, encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                extra[r["caso"].strip()] = {
                    "tipo": (r.get("tipo") or "").strip(),
                    "grado": tx.normalizar_grado(r.get("grado")) or "",
                    "grado_oms": tx.normalizar_grado_oms(r.get("grado_oms")) or "",
                    "malignidad": (r.get("malignidad") or "").strip()}

    cols = ["ruta", "tipo", "modalidad", "secuencia", "malignidad", "grado", "grado_oms", "grupo_ref", "corte"]
    n = 0
    with open(a.salida, "w", encoding="utf-8", newline="") as out:
        w = csv.DictWriter(out, fieldnames=cols)
        w.writeheader()
        for caso, img, seg in _casos(root, a.layout, a.sufijo):
            if a.etiquetas_csv and caso not in extra:
                continue
            e = extra.get(caso, {})
            tipo = e.get("tipo") or a.tipo
            if not tipo:
                raise SystemExit(f"Falta el tipo del caso {caso}: usa --tipo o la columna `tipo` del CSV")
            area = (_cargar(seg) > 0).sum(axis=(0, 1))  # píxeles de tumor por corte
            if area.max() == 0:
                continue
            w.writerow({"ruta": str(img.relative_to(root)), "tipo": tipo, "modalidad": "mri",
                        "secuencia": SECUENCIA_DE.get(a.sufijo, "otra") if a.layout == "brats" else "flair",
                        "malignidad": e.get("malignidad") or a.malignidad or "", "grado": e.get("grado", ""),
                        "grado_oms": e.get("grado_oms", ""), "grupo_ref": caso, "corte": int(np.argmax(area))})
            n += 1
    print(f"{n} casos escritos en {a.salida}")


if __name__ == "__main__":
    main()
