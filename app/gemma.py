"""Gemma 3: redacta la explicación y las recomendaciones en lenguaje claro.

Gemma NO clasifica ni decide el diagnóstico: solo recibe el resultado ya calculado (tipo, porcentajes, grado
estimado y resumen de la evolución) y lo explica. No recibe la imagen ni datos personales del paciente.
Si no hay GEMMA_API_KEY o falla la llamada, se devuelve la plantilla de conocimiento.py.
"""
import json
import logging
import urllib.request

from . import conocimiento
from . import taxonomy as tx
from .config import settings

log = logging.getLogger("dreamur.gemma")


def _prompt(pred: dict, base: dict, evolucion: dict | None, n_zonas: int) -> str:
    t = pred["tipo"]
    detalle = ", ".join(f"{tx.TIPOS[c][0]}: {p:.0%}" for c, p in sorted(t["probabilidades"].items(), key=lambda kv: -kv[1])[:4])
    extra = []
    if pred.get("malignidad"):
        m = pred["malignidad"]
        origen = "estimada por el modelo" if m["fuente"] == "modelo" else "habitual de este tipo (conocimiento general)"
        extra.append(f"Naturaleza: {m['clase'].replace('_', ' ')} ({origen}).")
    if pred.get("grado_oms"):
        extra.append(f"Grado OMS estimado por imagen (orientativo): {pred['grado_oms']['clase']}.")
    if pred.get("grado"):
        extra.append(f"Grado estimado: {pred['grado']['clase']}.")
    if evolucion and evolucion.get("disponible"):
        extra.append(f"Evolución frente a estudios previos: {evolucion['mensaje']}")
    return (
        "Eres un asistente que explica resultados de una IA de apoyo para estudios por imágenes del cerebro (tumores cerebrales). "
        "Escribe en español claro, para un paciente sin formación médica, en 130 a 200 palabras, con tono sereno y "
        "respetuoso.\nReglas estrictas: no afirmes un diagnóstico; no inventes cifras, dosis ni tratamientos "
        "específicos; no contradigas la información base; recuerda que la IA es solo un apoyo y que el médico "
        "decide; no des una expectativa de vida. Termina con 2 o 3 preguntas útiles para llevar a la consulta.\n\n"
        f"Resultado de la IA: {base['tipo']} (confianza {t['confianza']:.0%}). Probabilidades: {detalle}. "
        f"Zonas marcadas: {n_zonas}.\n" + "\n".join(extra) + "\n"
        f"Información base: {base['resumen']}\nPronóstico general: {base['pronostico_general']}\n"
    )


def _llamar(prompt: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemma_model}:generateContent"
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}],
                       "generationConfig": {"temperature": 0.3, "maxOutputTokens": 700}}).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/json", "x-goog-api-key": settings.gemma_api_key})
    with urllib.request.urlopen(req, timeout=40) as r:
        data = json.load(r)
    return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def redactar_informe(pred: dict, evolucion: dict | None, n_zonas: int, usar_gemma: bool = True) -> dict:
    base = conocimiento.informe_base(pred, evolucion)
    if not (usar_gemma and settings.gemma_api_key):
        return base
    try:
        base["explicacion_ia"] = _llamar(_prompt(pred, base, evolucion, n_zonas))
        base["generado_por"] = f"plantilla + {settings.gemma_model}"
    except Exception as e:  # nunca romper el análisis por un fallo del texto
        log.warning("Gemma no disponible, se usa la plantilla: %s", e)
    return base
