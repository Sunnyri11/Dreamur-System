"""Servicio HTTP de Dreamur-Generate_Model.

Flujo previsto: el backend ASP.NET llama a /generar con el tipo de tumor y las zonas que dejó
Dreamur-Detector (y, opcionalmente, la imagen para detectar el tipo de corte), recibe el GLB, lo sube al
bucket y guarda la fila en modelos_3d (ver 003_modelos_3d.sql). Este servicio no toca la base de datos
ni el bucket y no guarda estado.

Ejecutar:  uvicorn app.main:app --host 0.0.0.0 --port $PORT
Seguridad: si existe la variable DREAMUR_API_KEY, se exige la cabecera X-API-Key.
"""
from __future__ import annotations

import base64
import binascii
import hmac
import os
import threading
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .brain import cerebro_base
from .config import UMBRAL_CONFIANZA_CORTE, VERSION_GENERADOR
from .generator import generar_modelo
from .plano import analizar_imagen
from .tumor import Zona

app = FastAPI(title="Dreamur-Generate_Model", version=VERSION_GENERADOR)

# Limita la concurrencia para acotar la RAM en instancias pequeñas (cada generación usa pocos MB).
_cupo = threading.Semaphore(int(os.getenv("DREAMUR_MAX_CONCURRENTES", "2")))
MAX_IMAGEN_BYTES = int(os.getenv("DREAMUR_MAX_IMAGEN_BYTES", str(8 * 1024 * 1024)))


def _autorizar(x_api_key: str | None = Header(default=None)) -> None:
    clave = os.getenv("DREAMUR_API_KEY")
    if clave and not (x_api_key and hmac.compare_digest(x_api_key, clave)):
        raise HTTPException(status_code=401, detail="API key inválida")


def _decodificar(imagen_base64: str | None) -> bytes | None:
    if not imagen_base64:
        return None
    if len(imagen_base64) > MAX_IMAGEN_BYTES * 4 // 3 + 16:
        raise HTTPException(status_code=413, detail="Imagen demasiado grande")
    try:
        return base64.b64decode(imagen_base64.split(",")[-1], validate=True)   # acepta data URL
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status_code=422, detail="imagen_base64 no es base64 válido") from e


class ZonaIn(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    ancho: float = Field(gt=0, le=1)
    alto: float = Field(gt=0, le=1)
    puntaje: float | None = None


class SolicitudModelo(BaseModel):
    tipo_tumor: str = Field(min_length=1, max_length=40, description="Código de tipos_tumor, p. ej. glioma")
    zonas: list[ZonaIn] = Field(default_factory=list, max_length=20)
    plano: Literal["auto", "axial", "coronal", "sagital"] = "auto"
    imagen_base64: str | None = Field(default=None, description="Imagen original; permite detectar corte y orientación")
    semilla: int | None = None
    calidad: Literal["bajo", "medio"] = "medio"
    profundidad: float | None = Field(default=None, ge=-1, le=1)
    invertir_horizontal: bool | None = None
    invertir_vertical: bool | None = None
    vasos: bool = True


class SolicitudCorte(BaseModel):
    imagen_base64: str


def _generar(s: SolicitudModelo):
    zonas = [Zona(z.x, z.y, z.ancho, z.alto, z.puntaje) for z in s.zonas]
    imagen = _decodificar(s.imagen_base64)
    try:
        with _cupo:
            return generar_modelo(s.tipo_tumor, zonas, s.plano, s.semilla, s.calidad, s.profundidad,
                                  s.invertir_horizontal, s.invertir_vertical, imagen, s.vasos)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.get("/salud")
def salud():
    cerebro_base("medio")  # precalienta la malla base
    return {"estado": "ok", "version": VERSION_GENERADOR}


@app.post("/detectar-corte", dependencies=[Depends(_autorizar)])
def detectar_corte(s: SolicitudCorte):
    """Solo detecta el tipo de corte y la orientación de una imagen (sin generar el modelo)."""
    imagen = _decodificar(s.imagen_base64)
    with _cupo:
        a = analizar_imagen(imagen)
    if not a.valida:
        raise HTTPException(status_code=422, detail=a.motivo)
    return {"plano": a.plano, "confianza": round(a.confianza, 3), "dudoso": a.confianza < UMBRAL_CONFIANZA_CORTE,
            "probabilidades": {k: round(v, 3) for k, v in a.probabilidades.items()},
            "caja_cabeza": [round(c, 4) for c in a.caja],
            "anterior_a_la_izquierda": a.anterior_a_la_izquierda, "invertir_vertical": a.invertir_vertical}


@app.post("/generar", dependencies=[Depends(_autorizar)])
def generar(s: SolicitudModelo):
    """Devuelve el GLB en base64 junto con los datos para la tabla modelos_3d."""
    r = _generar(s)
    return {
        "glb_base64": base64.b64encode(r.glb).decode("ascii"),
        "sha256": r.sha256, "tam_bytes": r.tam_bytes,
        "n_triangulos_cerebro": r.n_triangulos_cerebro, "n_triangulos_tumor": r.n_triangulos_tumor,
        "tipo_tumor": r.tipo_tumor, "version_generador": r.version_generador, "parametros": r.parametros,
    }


@app.post("/generar.glb", dependencies=[Depends(_autorizar)])
def generar_glb(s: SolicitudModelo):
    """Igual que /generar pero devuelve el binario .glb directamente (útil para probar en un visor)."""
    r = _generar(s)
    return Response(content=r.glb, media_type="model/gltf-binary",
                    headers={"X-Sha256": r.sha256, "X-Version-Generador": r.version_generador})
