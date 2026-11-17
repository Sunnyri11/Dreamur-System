"""Vasos rojos decorativos que llegan al tumor (como en la imagen de referencia).

Son un adorno visual de baja resolución (tubos de 6 lados), NO anatomía real. Se pueden quitar con
`vasos=False`. Salen del tumor, bajan por un tronco hasta la base del cerebro y se ramifican hacia
la superficie, siempre dentro del cerebro.
"""
from __future__ import annotations

import numpy as np

from .brain import CerebroBase
from .tubos import curva_bezier, tubo, unir

N_RAMAS = 7
PUNTOS = 14
SUBRAMAS = 2
LADOS = 6
RAIZ = np.array([0.0, -0.20, -0.40])   # donde el tronco se junta con el tronco encefálico


def _ondular(ruta: np.ndarray, rng, amplitud: float) -> np.ndarray:
    """Hace la ruta sinuosa (los vasos reales no son rectos); los extremos quedan fijos."""
    k = len(ruta)
    t = np.gradient(ruta, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
    lado = np.cross(t, rng.normal(size=3))
    lado /= np.maximum(np.linalg.norm(lado, axis=1, keepdims=True), 1e-9)
    s = np.linspace(0, 1, k)
    onda = np.sin(2 * np.pi * (rng.uniform(1.2, 2.2) * s + rng.uniform())) * np.sin(np.pi * s)
    return ruta + lado * (amplitud * onda)[:, None]


def _dentro(cerebro: CerebroBase, ruta: np.ndarray, fraccion: float = 0.88) -> np.ndarray:
    rs_p = cerebro.radio_superficie(ruta)
    q = np.linalg.norm(ruta, axis=1)
    return np.where((q > fraccion * rs_p)[:, None], ruta * (fraccion * rs_p / np.maximum(q, 1e-9))[:, None], ruta)


def construir_vasos(cerebro: CerebroBase, centro_tumor, radio_tumor: float, semilla: int):
    rng = np.random.default_rng(int(semilla) + 77)
    c = np.asarray(centro_tumor, float)
    inicio = c - np.array([0.0, 0.0, 0.6 * radio_tumor])
    medio = (inicio + RAIZ) / 2 + np.array([rng.uniform(-0.12, 0.12), rng.uniform(-0.10, 0.10), 0.0])
    tronco = _dentro(cerebro, _ondular(curva_bezier(inicio, medio, RAIZ, PUNTOS), rng, 0.03), 0.92)
    partes = [tubo(tronco, np.linspace(0.020, 0.014, PUNTOS), LADOS)]

    for _ in range(N_RAMAS):
        origen = tronco[rng.integers(1, PUNTOS - 2)]
        direccion = rng.normal(size=3)
        direccion[2] = abs(direccion[2]) * 0.6 + 0.1          # las ramas suben hacia la corteza
        direccion /= np.linalg.norm(direccion)
        rs = float(cerebro.radio_superficie(direccion[None, :])[0])
        destino = direccion * rs * rng.uniform(0.60, 0.80)
        control = (origen + destino) / 2 + rng.normal(scale=0.10, size=3)
        ruta = _dentro(cerebro, _ondular(curva_bezier(origen, control, destino, PUNTOS), rng, 0.035))
        partes.append(tubo(ruta, np.linspace(0.011, 0.004, PUNTOS), LADOS))
        # sub-ramas que se abren hacia la corteza
        for _ in range(SUBRAMAS):
            j = int(rng.integers(PUNTOS // 3, PUNTOS - 2))
            d2 = rng.normal(size=3)
            d2 /= np.linalg.norm(d2)
            fin = ruta[j] + d2 * rng.uniform(0.14, 0.26)
            sub = _dentro(cerebro, _ondular(curva_bezier(ruta[j], (ruta[j] + fin) / 2 + rng.normal(scale=0.05, size=3),
                                                         fin, 8), rng, 0.02), 0.86)
            partes.append(tubo(sub, np.linspace(0.0065, 0.0025, 8), LADOS))
    return unir(partes)
