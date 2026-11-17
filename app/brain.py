"""Malla procedural del cerebro (predeterminada, igual para todos los pacientes).

Un solo nodo "cerebro" formado por: hemisferios (icosfera deformada: elipsoide, lóbulo temporal, base
aplanada, fisura longitudinal, fisura de Silvio y surcos), cerebelo con pliegues horizontales y tronco
encefálico. Todo es determinista (semilla fija) y usa solo numpy/scipy: sin torch, sin dataset.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from scipy.spatial import cKDTree

from .config import NIVEL_CEREBELO, NIVEL_CEREBRO, SEMIEJES
from .geometria import campo_suave as _campo_suave  # noqa: F401  (reexportado)
from .geometria import icosfera, normales, paso as _paso  # noqa: F401  (reexportados)
from .tubos import tubo

SEMILLA_CEREBRO = 7


def superficie_cerebro(d: np.ndarray) -> np.ndarray:
    """Puntos de los hemisferios (sistema x der, y anterior, z arriba) para direcciones unitarias d (N,3)."""
    rng = np.random.default_rng(SEMILLA_CEREBRO)
    a, b, c = SEMIEJES
    dx, dy, dz = d[:, 0], d[:, 1], d[:, 2]

    # Surcos: líneas donde un campo suave cruza por cero (curvas sinuosas tipo circunvoluciones).
    grande = _campo_suave(d, rng, 20, 8.0)
    fino = _campo_suave(d, rng, 26, 15.0)
    surco = 0.050 * np.exp(-(grande / 0.17) ** 2) + 0.026 * np.exp(-(fino / 0.19) ** 2)
    giro = 0.012 * grande

    # Fisura longitudinal entre hemisferios (surco medio, de adelante hacia atrás por arriba).
    fisura = 0.13 * np.exp(-(dx / 0.075) ** 2) * _paso(dz, -0.35, 0.15)
    # Fisura de Silvio: surco lateral que separa el lóbulo temporal (baja hacia adelante).
    z_silvio = -0.12 - 0.28 * dy
    silvio = (0.075 * np.exp(-((dz - z_silvio) / 0.075) ** 2) * _paso(np.abs(dx), 0.45, 0.75)
              * _paso(dy, -0.70, -0.30) * (1 - _paso(dy, 0.35, 0.65)))

    r = 1.0 - surco - fisura - silvio + giro
    p = d * r[:, None] * np.array([a, b, c])
    x, y, z = p[:, 0], p[:, 1], p[:, 2]

    x = x * (1.0 - 0.07 * (y / b))                                    # más ancho atrás que adelante
    temporal = np.exp(-(((z / c) + 0.30) / 0.30) ** 2 - (((y / b) - 0.10) / 0.55) ** 2)
    x = x * (1.0 + 0.10 * temporal)                                   # lóbulos temporales
    zf = -0.45 * c
    z = np.where(z < zf, zf + (z - zf) * 0.55, z)                     # base aplanada
    z = z * (1.0 - 0.06 * _paso(y / b, 0.3, 1.0))                     # polo frontal algo más fino
    return np.stack([x, y, z], axis=1)


def _cerebelo(nivel: int) -> tuple[np.ndarray, np.ndarray]:
    """Cerebelo: elipsoide bajo y detrás de los hemisferios, con pliegues horizontales."""
    d, f = icosfera(nivel)
    amplitud = 0.05 if nivel >= 3 else 0.0       # a baja resolución los pliegues no se ven: se omiten
    r = 1.0 + amplitud * np.cos(20 * d[:, 2])
    p = d * r[:, None] * np.array([0.42, 0.30, 0.20])
    p[:, 2] = np.where(p[:, 2] > 0, p[:, 2] * 0.6, p[:, 2])
    return p + np.array([0.0, -0.50, -0.43]), f


def _tronco() -> tuple[np.ndarray, np.ndarray]:
    """Tronco encefálico: tubo que baja desde la base (punto de unión con los vasos) y se afina."""
    t = np.linspace(0, 1, 10)
    centros = np.stack([np.zeros_like(t), -0.18 - 0.10 * t ** 1.3, -0.36 - 0.52 * t], axis=1)
    return tubo(centros, 0.095 - 0.035 * t, lados=14, tapa_final=True)


@dataclass(frozen=True)
class CerebroBase:
    vertices: np.ndarray          # (N,3) float32, sistema interno, dentro de [-1,1] (hemisferios + cerebelo + tronco)
    caras: np.ndarray             # (M,3) int32
    normales: np.ndarray          # (N,3) float32
    _arbol: cKDTree               # solo hemisferios: sirve para saber qué tan adentro está un punto
    _radios: np.ndarray

    def radio_superficie(self, puntos: np.ndarray) -> np.ndarray:
        """Distancia del origen a la superficie de los hemisferios en la dirección de cada punto (N,3)."""
        dirs = puntos / np.maximum(np.linalg.norm(puntos, axis=1, keepdims=True), 1e-9)
        _, idx = self._arbol.query(dirs, k=3)
        return self._radios[idx].mean(axis=1)


@lru_cache(maxsize=2)
def cerebro_base(calidad: str = "medio") -> CerebroBase:
    """Cerebro predeterminado (se calcula una sola vez por proceso y se reutiliza)."""
    d, f = icosfera(NIVEL_CEREBRO[calidad])
    hemis = superficie_cerebro(d)
    radios = np.linalg.norm(hemis, axis=1)
    arbol = cKDTree(hemis / radios[:, None])

    partes = [(hemis, f), _cerebelo(NIVEL_CEREBELO[calidad]), _tronco()]
    vs, fs, ns, off = [], [], [], 0
    for v, caras in partes:
        vs.append(v)
        fs.append(caras + off)
        ns.append(normales(v, caras))
        off += len(v)
    return CerebroBase(np.vstack(vs).astype(np.float32), np.vstack(fs).astype(np.int32),
                       np.vstack(ns).astype(np.float32), arbol, radios)
