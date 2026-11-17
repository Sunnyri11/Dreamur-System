"""Malla del tumor a partir de las zonas 2D que dibuja Dreamur-Detector.

Cada zona llega como rectángulo normalizado (x, y, ancho, alto) en [0,1] sobre la imagen
(origen arriba-izquierda, x/y = esquina superior izquierda). Se convierte en un elipsoide con bultos
tipo frambuesa ubicado dentro del cerebro:
  - posición y tamaño en el plano de la imagen: salen directo de la zona (relativa a la caja de la
    cabeza si se detectó, o a la imagen entera);
  - profundidad (eje perpendicular a la imagen): no se puede saber con una sola imagen, así que
    se usa un valor por defecto según el tipo de tumor (o el que se indique).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .brain import CerebroBase
from .config import (FORMA_TUMOR, FORMA_TUMOR_DEFECTO, FRACCION_CEREBRO_EN_IMAGEN, MAX_ZONAS, NIVEL_TUMOR,
                     PROFUNDIDAD_POR_TIPO, SEMIEJES)
from .geometria import bultos, campo_suave, icosfera, normales

# plano -> (eje que recorre el ancho de la imagen, eje que recorre el alto, eje de profundidad)
# ejes internos: 0 = x (derecha del paciente), 1 = y (anterior), 2 = z (arriba)
PLANOS = {"axial": (0, 1, 2), "coronal": (0, 2, 1), "sagital": (1, 2, 0)}

MARGEN_INTERIOR = 0.90      # el tumor nunca pasa de este % del radio del cerebro
RADIO_MINIMO = 0.035
RADIO_MAXIMO_REL = 0.40     # radio máximo como fracción del radio del cerebro en esa dirección


@dataclass(frozen=True)
class Zona:
    x: float
    y: float
    ancho: float
    alto: float
    puntaje: float | None = None

    def validar(self) -> None:
        for nombre in ("x", "y", "ancho", "alto"):
            v = getattr(self, nombre)
            if not (0.0 <= v <= 1.0) or v != v:
                raise ValueError(f"Zona inválida: {nombre}={v} debe estar entre 0 y 1")
        if self.ancho <= 0 or self.alto <= 0:
            raise ValueError("Zona inválida: ancho y alto deben ser mayores que 0")


@dataclass
class MallaTumor:
    vertices: np.ndarray
    caras: np.ndarray
    normales: np.ndarray
    zonas: list[dict]


def centro_y_radios(zona: Zona, cerebro: CerebroBase, plano: str, tipo: str, profundidad: float | None,
                    invertir_horizontal: bool = False, invertir_vertical: bool = False,
                    caja: tuple[float, float, float, float] | None = None):
    """Centro (3,) y radios (3,) del elipsoide del tumor en el sistema interno del cerebro."""
    eu, ev, ed = PLANOS[plano]
    A = np.array(SEMIEJES)
    m = FRACCION_CEREBRO_EN_IMAGEN
    cx, cy, ancho, alto = zona.x + zona.ancho / 2, zona.y + zona.alto / 2, zona.ancho, zona.alto
    if caja is not None and caja[2] - caja[0] > 0.05 and caja[3] - caja[1] > 0.05:
        # coordenadas relativas a la caja de la cabeza: así el cerebro "llena" la caja aunque la imagen tenga márgenes
        x0, y0, x1, y1 = caja
        cx, cy = np.clip((cx - x0) / (x1 - x0), 0, 1), np.clip((cy - y0) / (y1 - y0), 0, 1)
        ancho, alto = ancho / (x1 - x0), alto / (y1 - y0)
    su = -1.0 if invertir_horizontal else 1.0
    sv = -1.0 if invertir_vertical else 1.0

    centro = np.zeros(3)
    centro[eu] = su * (0.5 - cx) * 2 * A[eu] / m   # convención radiológica: izquierda de la imagen = derecha del paciente
    centro[ev] = sv * (0.5 - cy) * 2 * A[ev] / m   # arriba de la imagen = arriba / anterior

    radios = np.zeros(3)
    radios[eu] = ancho * A[eu] / m
    radios[ev] = alto * A[ev] / m
    radios[ed] = np.sqrt(radios[eu] * radios[ev])

    if profundidad is None:
        profundidad = PROFUNDIDAD_POR_TIPO.get(tipo, 0.0) if plano == "axial" else 0.0
    centro[ed] = float(np.clip(profundidad, -1, 1)) * A[ed]

    # Ajuste para que el tumor quepa dentro del cerebro.
    rs = float(cerebro.radio_superficie(centro[None, :] + 1e-9)[0])
    radios = np.clip(radios, RADIO_MINIMO, RADIO_MAXIMO_REL * rs)
    norma = float(np.linalg.norm(centro))
    max_c = max(0.0, MARGEN_INTERIOR * rs - 0.7 * radios.max())
    if norma > max_c and norma > 0:
        centro = centro * (max_c / norma)
    return centro, radios


def malla_tumor(cerebro: CerebroBase, tipo: str, zonas: list[Zona], plano: str = "axial",
                semilla: int = 0, profundidad: float | None = None,
                invertir_horizontal: bool = False, invertir_vertical: bool = False,
                caja: tuple[float, float, float, float] | None = None) -> MallaTumor | None:
    if plano not in PLANOS:
        raise ValueError(f"Plano desconocido: {plano}")
    for z in zonas:
        z.validar()
    zonas = sorted(zonas, key=lambda z: -(z.puntaje or 0.0))[:MAX_ZONAS]
    if not zonas:
        return None

    forma = FORMA_TUMOR.get(tipo, FORMA_TUMOR_DEFECTO)
    d, caras = icosfera(NIVEL_TUMOR)
    todos_v, todas_c, todas_n, info = [], [], [], []
    offset = 0
    for i, zona in enumerate(zonas):
        centro, radios = centro_y_radios(zona, cerebro, plano, tipo, profundidad, invertir_horizontal,
                                         invertir_vertical, caja)
        rng = np.random.default_rng(int(semilla) + 1000 * i)
        suave = 0.7 * campo_suave(d, rng, 8, 3.0) + 0.3 * campo_suave(d, rng, 10, 7.0)
        relieve = bultos(d, rng, forma["bultos"], forma["sigma"])            # textura tipo frambuesa
        factor = np.maximum(1.0 + 0.6 * forma["irr"] * suave + forma["amp"] * relieve, 0.5)
        p = centro + d * radios * factor[:, None]

        # Nunca debe asomar fuera del cerebro: se recorta radialmente a la superficie.
        rs = cerebro.radio_superficie(p)
        q = np.linalg.norm(p, axis=1)
        limite = MARGEN_INTERIOR * rs
        p = np.where((q > limite)[:, None], p * (limite / np.maximum(q, 1e-9))[:, None], p)

        todos_v.append(p)
        todas_c.append(caras + offset)
        todas_n.append(normales(p, caras))
        offset += len(p)
        info.append({"centro": [round(float(c), 4) for c in centro],
                     "radios": [round(float(r), 4) for r in radios],
                     "puntaje": zona.puntaje})
    return MallaTumor(np.vstack(todos_v).astype(np.float32), np.vstack(todas_c).astype(np.int32),
                      np.vstack(todas_n).astype(np.float32), info)
