"""Tubos de baja resolución (tronco encefálico y vasos): sección circular que sigue una curva."""
from __future__ import annotations

import numpy as np

from .geometria import normales


def curva_bezier(p0, p1, p2, n: int) -> np.ndarray:
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * np.asarray(p0) + 2 * (1 - t) * t * np.asarray(p1) + t ** 2 * np.asarray(p2)


def tubo(centros: np.ndarray, radios: np.ndarray, lados: int = 8, tapa_final: bool = True):
    """Devuelve (vértices float64, caras int64) de un tubo que recorre `centros` con `radios`."""
    centros = np.asarray(centros, float)
    k = len(centros)
    t = np.gradient(centros, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-12)
    ref = np.array([0.0, 0.0, 1.0]) if abs(t[0] @ np.array([0.0, 0.0, 1.0])) < 0.9 else np.array([1.0, 0.0, 0.0])
    n = np.cross(t[0], ref)
    n /= np.linalg.norm(n)
    normales_anillo = [n]
    for i in range(1, k):  # transporte paralelo del marco
        n = normales_anillo[-1] - (normales_anillo[-1] @ t[i]) * t[i]
        n /= np.linalg.norm(n)
        normales_anillo.append(n)
    ns = np.array(normales_anillo)
    bs = np.cross(t, ns)
    ang = np.linspace(0, 2 * np.pi, lados, endpoint=False)
    anillo = np.cos(ang)[None, :, None] * ns[:, None, :] + np.sin(ang)[None, :, None] * bs[:, None, :]
    v = (centros[:, None, :] + np.asarray(radios, float)[:, None, None] * anillo).reshape(-1, 3)

    caras = []
    for i in range(k - 1):
        for j in range(lados):
            a, b = i * lados + j, i * lados + (j + 1) % lados
            c, d = a + lados, b + lados
            caras += [[a, c, b], [b, c, d]]
    if tapa_final:
        centro = len(v)
        v = np.vstack([v, centros[-1]])
        base = (k - 1) * lados
        for j in range(lados):
            caras.append([base + j, base + (j + 1) % lados, centro])
    caras = np.array(caras, np.int64)

    # Orientación hacia afuera: la normal de cada cara debe apuntar lejos del eje del tubo.
    n_cara = np.cross(v[caras[:, 1]] - v[caras[:, 0]], v[caras[:, 2]] - v[caras[:, 0]])
    eje = centros[np.minimum(caras[:, 0] // lados, k - 1)]
    centro_cara = v[caras].mean(axis=1)
    if (np.einsum("ij,ij->i", n_cara, centro_cara - eje)[: (k - 1) * lados * 2]).mean() < 0:
        caras = caras[:, ::-1].copy()
    return v, caras


def unir(partes: list[tuple[np.ndarray, np.ndarray]]):
    """Concatena mallas (v, f) calculando las normales de cada una por separado."""
    vs, fs, ns, off = [], [], [], 0
    for v, f in partes:
        vs.append(v)
        fs.append(f + off)
        ns.append(normales(v, f))
        off += len(v)
    return np.vstack(vs), np.vstack(fs), np.vstack(ns)
