"""Historial del paciente: cómo cambió la lesión entre estudios y qué podría pasar.

Dos niveles (se informa siempre cuál se usó):
  1) REGLAS (siempre disponibles): compara el estudio actual con los anteriores de la MISMA modalidad
     (cambio del área marcada, de la prob. de malignidad y del grado OMS esperado, tratamientos intermedios).
  2) MODELO XGBoost de progresión (solo cuando hay seguimientos etiquetados suficientes; ver scripts/train_progresion.py).

Límites que conviene tener presentes: el "área" sale de las zonas de atención de Grad-CAM (aproximación, no una
medición del tumor), y los cortes de estudios distintos pueden no ser comparables. Es una señal de alerta para
el médico, no una medición clínica.
"""
import math
from datetime import date, datetime

import numpy as np

COLUMNAS = ["n_previos", "dias_desde_primero", "dias_desde_ultimo", "p_maligno_actual", "delta_p_maligno",
            "pendiente_p_mes", "area_actual", "crec_area_pct", "crec_area_mes_pct", "grado_esp_actual",
            "delta_grado", "cambio_tipo", "hubo_tratamiento", "edad"]
TRATAMIENTOS = {"cirugia", "quimioterapia", "radioterapia", "tratamiento_hormonal", "inmunoterapia"}
UMBRAL_AREA_PCT = 25.0
UMBRAL_P_MALIGNO = 0.15


def _fecha(f) -> date:
    if isinstance(f, datetime):
        return f.date()
    return f


def grado_esperado(prob_grado: dict | None) -> float | None:
    """{'I':0.1,'II':0.6,...} -> 2.0 (grado OMS medio ponderado, 1..4)."""
    if not prob_grado:
        return None
    orden = {"I": 1, "II": 2, "III": 3, "IV": 4}
    tot = sum(prob_grado.values())
    return float(sum(orden[k] * v for k, v in prob_grado.items() if k in orden) / tot) if tot > 0 else None


def punto(estudio_id, fecha, tipo, p_maligno, area, grado_prob=None) -> dict:
    return {"estudio_id": str(estudio_id), "fecha": _fecha(fecha), "tipo": tipo, "p_maligno": p_maligno,
            "area": area, "grado_esp": grado_esperado(grado_prob)}


def puntos_desde_filas(filas: list[dict]) -> list[dict]:
    """Filas SQL (estudio_id, fecha, tipo_tumor, prob_maligno, area_zonas, probabilidades) -> puntos ordenados."""
    out = []
    for f in filas:
        pe = (f.get("probabilidades") or {}).get("grado_oms")
        out.append(punto(f["estudio_id"], f["fecha"], f["tipo_tumor"], f.get("prob_maligno"), f.get("area_zonas"), pe))
    return sorted(out, key=lambda p: p["fecha"])


def _resta(a, b):
    return None if a is None or b is None else a - b


def construir_features(previos: list[dict], actual: dict, eventos: list[dict] | None = None, edad=None) -> dict:
    """previos: puntos anteriores (cualquier orden). actual: punto del estudio que se analiza."""
    previos = sorted(previos, key=lambda p: p["fecha"])
    f = {c: None for c in COLUMNAS}
    f["n_previos"] = len(previos)
    f["edad"] = edad
    f["p_maligno_actual"], f["area_actual"], f["grado_esp_actual"] = actual["p_maligno"], actual["area"], actual["grado_esp"]
    if not previos:
        return f
    ult, prim = previos[-1], previos[0]
    dias_ult = (actual["fecha"] - ult["fecha"]).days
    f["dias_desde_ultimo"] = dias_ult
    f["dias_desde_primero"] = (actual["fecha"] - prim["fecha"]).days
    f["delta_p_maligno"] = _resta(actual["p_maligno"], ult["p_maligno"])
    f["delta_grado"] = _resta(actual["grado_esp"], ult["grado_esp"])
    f["cambio_tipo"] = int(actual["tipo"] != ult["tipo"])

    # pendiente de la prob. de malignidad por mes (regresión lineal sobre todos los estudios)
    serie = [(p["fecha"], p["p_maligno"]) for p in previos + [actual] if p["p_maligno"] is not None]
    if len(serie) >= 2 and (serie[-1][0] - serie[0][0]).days >= 1:
        x = np.array([(d - serie[0][0]).days for d, _ in serie], dtype=float)
        y = np.array([v for _, v in serie], dtype=float)
        f["pendiente_p_mes"] = float(np.polyfit(x, y, 1)[0] * 30)

    a0, a1 = ult["area"], actual["area"]
    if a0 is not None and a1 is not None and a0 > 0.001:
        f["crec_area_pct"] = (a1 - a0) / a0 * 100
        if dias_ult >= 1:
            f["crec_area_mes_pct"] = f["crec_area_pct"] / dias_ult * 30
    ini = ult["fecha"]
    f["hubo_tratamiento"] = int(any(e["tipo"] in TRATAMIENTOS and ini <= _fecha(e["fecha"]) <= actual["fecha"]
                                    for e in (eventos or [])))
    return f


def vector(f: dict) -> list:
    return [float("nan") if f[c] is None else float(f[c]) for c in COLUMNAS]


def estimar(f: dict, actual: dict, p_modelo: float | None = None) -> dict:
    if not f["n_previos"]:
        return {"disponible": False, "mensaje": "Es el primer estudio cerebral de este paciente con esta modalidad: aún no hay "
                "historial con el que comparar. Con los próximos estudios se podrá estimar la evolución."}
    score, señales = 0, []
    c = f["crec_area_pct"]
    if c is not None:
        if c >= UMBRAL_AREA_PCT:
            score += 2
            señales.append(f"El área de las zonas marcadas aumentó {c:.0f}% desde el último estudio.")
        elif c <= -UMBRAL_AREA_PCT:
            score -= 2
            señales.append(f"El área de las zonas marcadas disminuyó {abs(c):.0f}% desde el último estudio.")
    dp = f["delta_p_maligno"]
    if dp is not None:
        if dp >= UMBRAL_P_MALIGNO:
            score += 2
            señales.append(f"La probabilidad de malignidad subió {dp * 100:.0f} puntos porcentuales.")
        elif dp <= -UMBRAL_P_MALIGNO:
            score -= 2
            señales.append(f"La probabilidad de malignidad bajó {abs(dp) * 100:.0f} puntos porcentuales.")
    de = f["delta_grado"]
    if de is not None:
        if de >= 0.5:
            score += 1
            señales.append("El grado OMS estimado es mayor que en el estudio anterior.")
        elif de <= -0.5:
            score -= 1
            señales.append("El grado OMS estimado es menor que en el estudio anterior.")
    if f["cambio_tipo"]:
        señales.append("El tipo de lesión estimado cambió respecto al estudio anterior.")

    cat = "progresion" if score >= 2 else "regresion" if score <= -2 else "estable"
    if cat == "estable" and not señales:
        señales.append("No se observan cambios relevantes respecto al estudio anterior.")
    if f["hubo_tratamiento"]:
        señales.append("Hubo un tratamiento registrado entre ambos estudios: los cambios pueden deberse a él.")
    txt = {"progresion": "Cambios compatibles con progresión.", "regresion": "Cambios compatibles con reducción.",
           "estable": "Lesión sin cambios relevantes."}[cat]

    out = {"disponible": True, "categoria": cat, "mensaje": txt + " " + " ".join(señales),
           "señales": señales, "n_estudios_previos": f["n_previos"], "dias_desde_ultimo": f["dias_desde_ultimo"],
           "metodo": "reglas", "probabilidad_progresion": None, "features": {k: v for k, v in f.items() if v is not None}}
    if p_modelo is not None:
        out["metodo"], out["probabilidad_progresion"] = "modelo_xgboost", float(p_modelo)

    # Proyección matemática simple del área (crecimiento exponencial entre los dos últimos estudios).
    a1 = actual["area"]
    if c is not None and a1 and f["dias_desde_ultimo"] and f["dias_desde_ultimo"] >= 7 and a1 > 0 and c > -99:
        k = math.log(max(1 + c / 100, 1e-3)) / f["dias_desde_ultimo"]
        factor = min(5.0, max(0.2, math.exp(k * 90)))
        out["proyeccion_area_90d"] = float(min(1.0, a1 * factor))
        if c > 0:
            out["tiempo_duplicacion_dias"] = round(f["dias_desde_ultimo"] * math.log(2) / math.log(1 + c / 100), 1)
        out["advertencia_proyeccion"] = ("Proyección matemática simple a partir de dos estudios; no es un pronóstico "
                                         "clínico. La evolución real depende del tratamiento y de la biología del tumor.")
    return out
