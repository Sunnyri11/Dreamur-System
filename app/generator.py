"""Orquestación: tipo de tumor + zonas de Dreamur-Detector (+ imagen) -> GLB con cerebro, tumor y vasos."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

from .brain import cerebro_base
from .config import (ALFA_CEREBRO, COLOR_CEREBRO, COLOR_TUMOR_DEFECTO, COLORES_TUMOR, EMISIVO_FUERZA_TUMOR,
                     EMISIVO_FUERZA_VASOS, NIVEL_CEREBRO, UMBRAL_CONFIANZA_CORTE, VERSION_GENERADOR)
from .glb import Malla, construir_glb
from .plano import analizar_imagen, orientacion
from .tumor import PLANOS, MallaTumor, Zona, malla_tumor
from .vasos import construir_vasos

SIN_TUMOR = "sin_tumor"


def hex_a_lineal(h: str, alfa: float = 1.0) -> tuple[float, float, float, float]:
    """#rrggbb (sRGB) -> RGBA lineal, que es lo que espera glTF."""
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (lin[0], lin[1], lin[2], alfa)


@dataclass
class ResultadoModelo:
    glb: bytes
    sha256: str
    tam_bytes: int
    n_triangulos_cerebro: int
    n_triangulos_tumor: int | None
    tipo_tumor: str
    version_generador: str
    parametros: dict


def semilla_por_defecto(tipo: str, zonas: list[Zona], plano: str) -> int:
    """Misma detección -> mismo modelo (la semilla sale de los datos)."""
    base = f"{tipo}|{plano}|" + "|".join(f"{z.x:.4f},{z.y:.4f},{z.ancho:.4f},{z.alto:.4f}" for z in zonas)
    return int.from_bytes(hashlib.sha1(base.encode()).digest()[:4], "big")


def resolver_corte(plano: str | None, imagen: bytes | None, invertir_horizontal: bool | None,
                   invertir_vertical: bool | None) -> dict:
    """Decide el plano y la orientación: lo indicado manda; si es 'auto' se detecta desde la imagen."""
    auto = plano in (None, "auto")
    analisis = analizar_imagen(imagen) if imagen else None
    info = {"origen": "manual", "plano": plano, "confianza": None, "dudoso": False, "probabilidades": None,
            "caja": None, "advertencia": None}
    if analisis is not None and analisis.valida:
        info.update(probabilidades={k: round(v, 3) for k, v in analisis.probabilidades.items()},
                    caja=[round(c, 4) for c in analisis.caja])
    if auto:
        if analisis is not None and analisis.valida:
            info.update(origen="imagen", plano=analisis.plano, confianza=round(analisis.confianza, 3),
                        dudoso=analisis.confianza < UMBRAL_CONFIANZA_CORTE)
            if info["dudoso"]:
                info["advertencia"] = "La detección del tipo de corte tiene poca confianza; conviene confirmarlo."
        else:
            info.update(origen="defecto", plano="axial", dudoso=True)
            info["advertencia"] = (analisis.motivo if analisis is not None
                                   else "No se envió la imagen: se asume corte axial.")
    elif plano not in PLANOS:
        raise ValueError(f"Plano desconocido: {plano}")

    # Orientación (solo con imagen válida y cuando no se indicó a mano).
    inv_v = inv_h = None
    if analisis is not None and analisis.valida:
        inv_v, ant_izq = orientacion(info["plano"], analisis.caracteristicas)
        inv_h = (not ant_izq) if ant_izq is not None else None
    info["invertir_horizontal"] = bool(invertir_horizontal if invertir_horizontal is not None else inv_h or False)
    info["invertir_vertical"] = bool(invertir_vertical if invertir_vertical is not None else inv_v or False)
    return info


def construir_mallas(tipo_tumor: str, zonas: list[Zona], plano: str = "axial", semilla: int | None = None,
                     calidad: str = "medio", profundidad: float | None = None,
                     invertir_horizontal: bool = False, invertir_vertical: bool = False,
                     caja: tuple[float, float, float, float] | None = None,
                     vasos: bool = True) -> tuple[list[Malla], MallaTumor | None, int]:
    if calidad not in NIVEL_CEREBRO:
        raise ValueError(f"Calidad desconocida: {calidad}")
    if plano not in PLANOS:
        raise ValueError(f"Plano desconocido: {plano}")
    if semilla is None:
        semilla = semilla_por_defecto(tipo_tumor, zonas, plano)

    cerebro = cerebro_base(calidad)
    mallas = [Malla("cerebro", cerebro.vertices, cerebro.caras, cerebro.normales,
                    hex_a_lineal(COLOR_CEREBRO, ALFA_CEREBRO), metalico=0.0, rugosidad=0.55,
                    emisivo=(0.01, 0.04, 0.12), transparente=True)]
    tumor = None
    if tipo_tumor != SIN_TUMOR and zonas:
        tumor = malla_tumor(cerebro, tipo_tumor, zonas, plano, semilla, profundidad, invertir_horizontal,
                            invertir_vertical, caja)
    if tumor is not None:
        color = COLORES_TUMOR.get(tipo_tumor, COLOR_TUMOR_DEFECTO)
        lineal = hex_a_lineal(color)
        mallas.append(Malla("tumor", tumor.vertices, tumor.caras, tumor.normales, lineal,
                            rugosidad=0.45, emisivo=tuple(0.45 * c for c in lineal[:3]),
                            emisivo_fuerza=EMISIVO_FUERZA_TUMOR,
                            extras={"tipo_tumor": tipo_tumor, "color": color}))
        if vasos:
            principal = tumor.zonas[0]
            v, f, n = construir_vasos(cerebro, principal["centro"], max(principal["radios"]), semilla)
            mallas.append(Malla("vasos", v.astype(np.float32), f.astype(np.int32), n.astype(np.float32), lineal,
                                rugosidad=0.5, emisivo=tuple(0.5 * c for c in lineal[:3]),
                                emisivo_fuerza=EMISIVO_FUERZA_VASOS, extras={"decorativo": True}))
    return mallas, tumor, semilla


def generar_modelo(tipo_tumor: str, zonas: list[Zona] | None = None, plano: str | None = "auto",
                   semilla: int | None = None, calidad: str = "medio", profundidad: float | None = None,
                   invertir_horizontal: bool | None = None, invertir_vertical: bool | None = None,
                   imagen: bytes | None = None, vasos: bool = True) -> ResultadoModelo:
    zonas = list(zonas or [])
    corte = resolver_corte(plano, imagen, invertir_horizontal, invertir_vertical)
    caja = tuple(corte["caja"]) if corte["caja"] else None
    mallas, tumor, semilla = construir_mallas(
        tipo_tumor, zonas, corte["plano"], semilla, calidad, profundidad, corte["invertir_horizontal"],
        corte["invertir_vertical"], caja, vasos)
    glb = construir_glb(mallas)
    color = COLORES_TUMOR.get(tipo_tumor, COLOR_TUMOR_DEFECTO) if tumor is not None else None
    parametros = {
        "corte": corte, "calidad": calidad, "semilla": semilla, "profundidad": profundidad,
        "vasos": bool(vasos and tumor is not None),
        "color_cerebro": COLOR_CEREBRO, "color_tumor": color,
        "zonas": tumor.zonas if tumor is not None else [],
        "aproximado": True,  # la profundidad y la forma del tumor son una representación, no una reconstrucción
    }
    return ResultadoModelo(
        glb=glb, sha256=hashlib.sha256(glb).hexdigest(), tam_bytes=len(glb),
        n_triangulos_cerebro=int(len(mallas[0].caras)),
        n_triangulos_tumor=int(len(tumor.caras)) if tumor is not None else None,
        tipo_tumor=tipo_tumor, version_generador=VERSION_GENERADOR, parametros=parametros)
