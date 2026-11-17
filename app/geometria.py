"""Utilidades de geometría compartidas: icosfera, normales, campos suaves y bultos. Solo numpy. (Los tubos están en tubos.py.)"""
from __future__ import annotations

import numpy as np


def icosfera(nivel: int) -> tuple[np.ndarray, np.ndarray]:
    """Esfera unitaria geodésica: (vértices float64 (N,3), caras int64 (M,3)), caras antihorarias hacia afuera."""
    t = (1 + 5 ** 0.5) / 2
    v = np.array([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
                  [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]], float)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    f = np.array([[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
                  [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
                  [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]], np.int64)
    for _ in range(nivel):
        v, f = _subdividir(v, f)
    return v, f


def _subdividir(v: np.ndarray, f: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    nf = len(f)
    aristas = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    unicas, inv = np.unique(aristas, axis=0, return_inverse=True)
    inv = np.asarray(inv).reshape(-1)
    medios = v[unicas].mean(axis=1)
    medios /= np.linalg.norm(medios, axis=1, keepdims=True)
    m = inv + len(v)
    m01, m12, m20 = m[:nf], m[nf:2 * nf], m[2 * nf:]
    a, b, c = f[:, 0], f[:, 1], f[:, 2]
    caras = np.concatenate([np.stack([a, m01, m20], 1), np.stack([b, m12, m01], 1),
                            np.stack([c, m20, m12], 1), np.stack([m01, m12, m20], 1)])
    return np.vstack([v, medios]), caras


def normales(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    """Normales por vértice (promedio de normales de cara ponderado por área)."""
    p0, p1, p2 = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    nc = np.cross(p1 - p0, p2 - p0)
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, f[:, k], nc)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def campo_suave(d: np.ndarray, rng: np.random.Generator, n: int, frecuencia: float) -> np.ndarray:
    """Campo escalar suave sobre la esfera (suma de senos), normalizado a desviación ~1."""
    k = rng.normal(size=(n, 3))
    k /= np.linalg.norm(k, axis=1, keepdims=True)
    fase = rng.uniform(0, 2 * np.pi, n)
    return np.sin(frecuencia * (d @ k.T) + fase).sum(axis=1) / np.sqrt(n / 2)


def bultos(d: np.ndarray, rng: np.random.Generator, n: int, sigma: float) -> np.ndarray:
    """Relieve de 'frambuesa': suma de n bultos gaussianos (ancho sigma, en radianes) sobre la esfera, centrado en 0."""
    c = rng.normal(size=(n, 3))
    c /= np.linalg.norm(c, axis=1, keepdims=True)
    ang = np.arccos(np.clip(d @ c.T, -1.0, 1.0))
    g = np.exp(-(ang / sigma) ** 2).sum(axis=1)
    return g - g.mean()


def paso(x: np.ndarray, a: float, b: float) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
