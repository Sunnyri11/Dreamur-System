"""Calibra el detector del tipo de corte (axial / coronal / sagital) con imágenes etiquetadas.

Uso con imágenes reales (lo recomendado):
    python tools/calibrar_plano.py /ruta/dataset            # subcarpetas axial/ coronal/ sagital/ con .jpg/.png
Genera app/plano_modelo.json (el servicio lo usa automáticamente) e imprime precisión (validación cruzada)
y matriz de confusión. Bastan unas 50-100 imágenes por clase para notar la mejora.

Uso con cortes sintéticos del modelo 3D (así se obtuvieron los pesos iniciales de plano.py):
    python tools/calibrar_plano.py --fantomas [--salida -]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "tests"))
from app.plano import CARACTERISTICAS, CLASES, RUTA_MODELO, _a_gris, ajustar, caracteristicas, mascara_cabeza, vector  # noqa: E402


def extraer(datos: bytes):
    try:
        g = _a_gris(datos)
    except Exception:
        return None
    m = mascara_cabeza(g)
    if m is None or not (0.08 <= m.mean() <= 0.97):
        return None
    return vector(caracteristicas(g, m))


def dataset_carpeta(ruta: Path):
    X, y, omitidas = [], [], 0
    for i, clase in enumerate(CLASES):
        for p in sorted((ruta / clase).glob("*")):
            if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}:
                continue
            v = extraer(p.read_bytes())
            if v is None:
                omitidas += 1
                continue
            X.append(v)
            y.append(i)
    return np.array(X), np.array(y), omitidas


def dataset_fantomas(n_por_clase: int, semilla: int):
    from fantomas import a_png, corte
    rng = np.random.default_rng(semilla)
    rangos = {"axial": (-0.30, 0.45), "coronal": (-0.45, 0.45), "sagital": (-0.35, 0.35)}
    X, y = [], []
    for i, clase in enumerate(CLASES):
        for _ in range(n_por_clase):
            img = corte(clase, rng.uniform(*rangos[clase]), bool(rng.integers(0, 2)))
            v = extraer(a_png(img, rng, ocupacion=rng.uniform(0.55, 0.95), rotacion=6.0))
            if v is not None:
                X.append(v)
                y.append(i)
    return np.array(X), np.array(y)


def predecir(pesos: dict, X: np.ndarray) -> np.ndarray:
    L = np.stack([pesos[c][0] + X @ np.array(pesos[c][1:]) for c in CLASES], axis=1)
    return L.argmax(axis=1)


def validacion_cruzada(X, y, k=5, semilla=0):
    idx = np.random.default_rng(semilla).permutation(len(y))
    pred = np.zeros_like(y)
    for fold in range(k):
        test = idx[fold::k]
        train = np.setdiff1d(idx, test)
        pred[test] = predecir(ajustar(X[train], y[train]), X[test])
    return pred


def informe(y, pred):
    print(f"Precisión (validación cruzada): {(y == pred).mean():.1%}  sobre {len(y)} imágenes")
    print("Matriz de confusión (filas = real, columnas = predicho):")
    print("            " + "".join(f"{c:>9}" for c in CLASES))
    for i, c in enumerate(CLASES):
        print(f"{c:>10}  " + "".join(f"{int(((y == i) & (pred == j)).sum()):9d}" for j in range(len(CLASES))))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("carpeta", nargs="?", help="carpeta con subcarpetas axial/ coronal/ sagital/")
    ap.add_argument("--fantomas", action="store_true", help="usar cortes sintéticos del modelo 3D")
    ap.add_argument("--n", type=int, default=200, help="imágenes sintéticas por clase")
    ap.add_argument("--salida", default=str(RUTA_MODELO), help="archivo JSON de salida ('-' = solo imprimir)")
    a = ap.parse_args()
    if a.fantomas:
        X, y = dataset_fantomas(a.n, semilla=11)
    elif a.carpeta:
        X, y, omitidas = dataset_carpeta(Path(a.carpeta))
        if omitidas:
            print(f"({omitidas} imágenes omitidas: ilegibles o sin cabeza distinguible)")
        if len(y) < 30 or len(set(y.tolist())) < 3:
            sys.exit("Se necesitan imágenes en las 3 carpetas (axial, coronal, sagital), al menos ~10 por clase.")
    else:
        ap.error("indica una carpeta o --fantomas")
    informe(y, validacion_cruzada(X, y))
    pesos = ajustar(X, y)
    print("Características:", CARACTERISTICAS)
    print(json.dumps(pesos, indent=1))
    if a.salida != "-":
        Path(a.salida).write_text(json.dumps(pesos, indent=1))
        print("Guardado en", a.salida)
