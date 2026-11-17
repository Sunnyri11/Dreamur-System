"""Convierte el dataset de Cheng et al. (figshare, 3064 cortes T1 con contraste en archivos .mat) a PNG + manifiesto CSV.

Cada .mat tiene una estructura `cjdata` con: label (1=meningioma, 2=glioma, 3=pituitario), PID (ID del paciente),
image (corte 512x512). Se usa el PID como `grupo_ref`, así el entrenamiento divide por paciente y no por imagen.
Requiere h5py (los .mat v7.3 son HDF5):  pip install h5py   (scipy.io.loadmat se usa si el archivo es más antiguo).

Uso:
  python -m scripts.convertir_cheng --origen "D:/datos/cheng_mat" --destino "D:/datos/cheng_png"
  python -m scripts.ingest --adaptador manifest --root "D:/datos/cheng_png" --manifest "D:/datos/cheng_png/manifiesto.csv" --fuente-codigo cheng
"""
import argparse
import csv
from pathlib import Path

import numpy as np
from PIL import Image

TIPOS = {1: "meningioma", 2: "glioma", 3: "pituitario"}


def _leer_mat(ruta: Path):
    """Devuelve (imagen 2D, etiqueta int, pid str)."""
    try:
        import h5py
    except ImportError:
        h5py = None
    if h5py is not None:
        try:
            with h5py.File(ruta, "r") as f:
                d = f["cjdata"]
                img = np.array(d["image"], dtype=np.float32).T
                label = int(np.array(d["label"]).squeeze())
                pid = "".join(chr(int(c)) for c in np.array(d["PID"]).squeeze().tolist()) if "PID" in d else ruta.stem
            return img, label, pid
        except OSError:
            pass  # no es HDF5: .mat clásico
    from scipy.io import loadmat
    try:
        d = loadmat(str(ruta), squeeze_me=True, struct_as_record=False)["cjdata"]
    except NotImplementedError:
        raise SystemExit("Los .mat son versión 7.3 (HDF5): instala h5py  ->  pip install h5py")
    return np.asarray(d.image, dtype=np.float32), int(d.label), str(getattr(d, "PID", ruta.stem))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--origen", required=True, help="carpeta con los .mat")
    ap.add_argument("--destino", required=True)
    a = ap.parse_args()
    dest = Path(a.destino)
    dest.mkdir(parents=True, exist_ok=True)
    mats = sorted(Path(a.origen).rglob("*.mat"))
    if not mats:
        raise SystemExit("No encontré archivos .mat en --origen")
    n = 0
    with open(dest / "manifiesto.csv", "w", encoding="utf-8", newline="") as out:
        w = csv.writer(out)
        w.writerow(["ruta", "tipo", "modalidad", "secuencia", "grupo_ref"])
        for m in mats:
            img, label, pid = _leer_mat(m)
            if label not in TIPOS:
                print(f"  (omito {m.name}: etiqueta desconocida {label})")
                continue
            lo, hi = np.percentile(img, (1, 99.5))
            u8 = (np.clip((img - lo) / max(hi - lo, 1e-6), 0, 1) * 255).astype(np.uint8)
            nombre = f"{TIPOS[label]}/{m.stem}.png"
            (dest / TIPOS[label]).mkdir(exist_ok=True)
            Image.fromarray(u8, mode="L").save(dest / nombre)
            w.writerow([nombre, TIPOS[label], "mri", "t1c", f"cheng-{pid}"])
            n += 1
    print(f"{n} imágenes convertidas en {dest} (manifiesto: {dest / 'manifiesto.csv'})")


if __name__ == "__main__":
    main()
