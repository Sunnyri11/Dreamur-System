"""Cortes sintéticos (fantomas) del propio cerebro 3D, para probar la detección del plano.

OJO: son imágenes sintéticas derivadas de la misma geometría; sirven para comprobar que el detector
y las convenciones de ejes son coherentes, NO reemplazan una validación con resonancias reales.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.brain import cerebro_base  # noqa: E402

N = 72


def _volumen(craneo: bool = True) -> np.ndarray:
    g = np.linspace(-1, 1, N)
    X, Y, Z = np.meshgrid(g, g, g, indexing="ij")
    P = np.stack([X, Y, Z], -1).reshape(-1, 3) + 1e-6
    cb = cerebro_base("bajo")
    q = np.linalg.norm(P, axis=1)
    rs = cb.radio_superficie(P)
    cerebro = q < 0.98 * rs
    u = (P - np.array([0.0, -0.50, -0.43])) / np.array([0.42, 0.30, 0.16])
    cerebro |= (u ** 2).sum(1) < 1
    z = P[:, 2]
    t = np.clip((-z - 0.36) / 0.52, 0, 1)
    yc = -0.18 - 0.10 * t ** 1.3
    tronco = (z < -0.36) & (z > -0.88) & (np.hypot(P[:, 0], P[:, 1] - yc) < 0.095 - 0.035 * t)
    cerebro |= tronco

    vol = np.full(len(P), 0.0)
    rng = np.random.default_rng(3)
    ruido = ndi.gaussian_filter(rng.normal(size=(N, N, N)), 1.5).reshape(-1)
    ruido = ruido / ruido.std()
    vol[cerebro] = 0.55 + 0.10 * ruido[cerebro]
    # estructuras bilaterales (ventrículos) y fisura interhemisférica: dan simetría izquierda-derecha interna
    for sx in (-1, 1):
        w = ((P[:, 0] - sx * 0.16) / 0.07) ** 2 + ((P[:, 1] - 0.05) / 0.30) ** 2 + ((P[:, 2] - 0.12) / 0.10) ** 2
        vol[(w < 1) & cerebro] = 0.12
    vol[(np.abs(P[:, 0]) < 0.025) & (z > 0.0) & cerebro] *= 0.6
    if craneo:
        anillo = (q < 1.10 * rs) & ~cerebro & (z > -0.62)
        vol[anillo] = 0.85
    return vol.reshape(N, N, N)


_VOL: dict[bool, np.ndarray] = {}


def corte(plano: str, pos: float, craneo: bool = True) -> np.ndarray:
    """Imagen (float 0-1) con la convención de la app: arriba = anterior (axial) / arriba (coronal, sagital),
    izquierda de la imagen = derecha del paciente (axial, coronal) o anterior a la izquierda (sagital)."""
    if craneo not in _VOL:
        _VOL[craneo] = _volumen(craneo)
    vol = _VOL[craneo]
    i = int(round((np.clip(pos, -1, 1) + 1) / 2 * (N - 1)))
    sl = {"axial": vol[:, :, i], "coronal": vol[:, i, :], "sagital": vol[i, :, :]}[plano]
    return sl.T[::-1, ::-1].copy()


def a_png(img: np.ndarray, rng: np.random.Generator, lado: int = 256, ocupacion: float = 0.8,
          rotacion: float = 5.0, ruido: float = 0.02, voltear_v: bool = False, voltear_h: bool = False) -> bytes:
    """Convierte el corte en un PNG 'realista': tamaño, márgenes, rotación pequeña, ruido y brillo aleatorios."""
    if voltear_v:
        img = img[::-1]
    if voltear_h:
        img = img[:, ::-1]
    filas, cols = np.nonzero(img > 0.05)
    img = img[filas.min():filas.max() + 1, cols.min():cols.max() + 1]
    h, w = img.shape
    esc = ocupacion * lado / max(h, w)
    im = Image.fromarray((img * 255).astype(np.uint8)).resize((max(8, int(w * esc)), max(8, int(h * esc))),
                                                              Image.BICUBIC)
    lienzo = Image.new("L", (lado, lado), 0)
    lienzo.paste(im, ((lado - im.width) // 2 + int(rng.integers(-6, 7)), (lado - im.height) // 2 + int(rng.integers(-6, 7))))
    lienzo = lienzo.rotate(float(rng.uniform(-rotacion, rotacion)), Image.BILINEAR)
    a = np.asarray(lienzo, float) / 255 * rng.uniform(0.8, 1.2) + rng.normal(0, ruido, (lado, lado)) + rng.uniform(0, 0.02)
    buf = io.BytesIO()
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(buf, "PNG")
    return buf.getvalue()


POSICIONES = {"axial": [-0.25, -0.1, 0.05, 0.2, 0.35], "coronal": [-0.4, -0.2, 0.0, 0.2, 0.4],
              "sagital": [-0.3, -0.15, 0.0, 0.15, 0.3]}
