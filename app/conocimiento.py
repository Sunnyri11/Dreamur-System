"""Textos del informe: conocimiento médico GENERAL sobre tumores cerebrales (tipo, grado, evolución).

Nada de aquí es una predicción sobre el paciente: son explicaciones generales y orientativas que siempre remiten
a un profesional. Revísalo con un neurólogo / neurocirujano antes de usarlo con pacientes.
"""
from . import taxonomy as tx

AVISO = ("Resultado de apoyo generado por una IA. No es un diagnóstico médico: debe ser interpretado por un "
         "especialista (neurología, neurocirugía, neurorradiología) junto con la historia clínica, otros estudios y, "
         "cuando corresponda, el análisis de tejido (biopsia o cirugía).")

TIPOS_INFO = {
    "sin_tumor": {
        "resumen": "No se detectó un patrón compatible con tumor en las imágenes analizadas.",
        "recomendaciones": [
            "Un resultado negativo de la IA no descarta enfermedad: la imagen debe ser informada por un neurorradiólogo.",
            "Si tienes síntomas persistentes (dolores de cabeza que empeoran, convulsiones, pérdida de visión o de fuerza, "
            "cambios de conducta), consulta con un médico aunque este resultado sea negativo.",
        ],
        "pronostico_general": "No aplica.",
    },
    "glioma": {
        "resumen": ("Los gliomas nacen de las células gliales. Varían desde crecimiento lento (grado bajo) hasta muy "
                    "agresivos (p. ej. glioblastoma, grado IV). El grado y las características moleculares solo se "
                    "confirman con el análisis del tejido."),
        "recomendaciones": [
            "Consulta prioritaria con neurología / neurocirugía / neuro-oncología.",
            "Resonancia con contraste y secuencias completas; lleva los estudios previos para comparar.",
            "La confirmación del tipo y del grado requiere biopsia o resección con estudio histológico y molecular.",
            "No inicies ni suspendas tratamientos sin indicación médica.",
        ],
        "pronostico_general": ("Depende del grado, la localización, la edad, la extensión de la cirugía y los marcadores "
                               "moleculares (p. ej. IDH, MGMT). No se puede estimar individualmente con una imagen."),
    },
    "meningioma": {
        "resumen": ("Surge de las meninges. La mayoría son grado I (benignos) y de crecimiento lento; una minoría es "
                    "atípica (grado II) o anaplásica (grado III), lo que solo confirma la patología."),
        "recomendaciones": [
            "Valoración por neurocirugía / neurología.",
            "Según tamaño, localización y síntomas, el médico puede indicar control con imágenes, cirugía o radioterapia.",
            "Lleva los estudios previos: el crecimiento en el tiempo es un dato clave.",
        ],
        "pronostico_general": "Suele ser favorable en grado I, sobre todo si se extirpa por completo; puede recurrir.",
    },
    "pituitario": {
        "resumen": ("Casi siempre adenomas benignos. Pueden alterar hormonas y, si crecen, comprimir los nervios ópticos "
                    "y afectar la visión."),
        "recomendaciones": [
            "Evaluación por endocrinología (perfil hormonal) y neurocirugía.",
            "Examen oftalmológico con campo visual.",
            "Resonancia dedicada a la región selar.",
        ],
        "pronostico_general": "En general bueno: muchos se controlan con medicación, cirugía o radiocirugía.",
    },
    "metastasis_cerebral": {
        "resumen": ("Son depósitos de células de un cáncer que empezó en otro órgano (pulmón, mama, piel, etc.). "
                    "Pueden ser únicas o múltiples."),
        "recomendaciones": [
            "Consulta prioritaria con oncología y neurocirugía / radioterapia.",
            "Es necesario identificar el cáncer de origen y valorar su extensión con otros estudios.",
            "Lleva tu historia oncológica y estudios previos.",
        ],
        "pronostico_general": ("Depende del cáncer de origen, el número y tamaño de las lesiones y el estado general; "
                               "no se puede estimar con una imagen."),
    },
}

GRADO_OMS_TXT = {
    "I": "Grado OMS I: crecimiento lento, aspecto celular poco agresivo.",
    "II": "Grado OMS II: crecimiento relativamente lento, pero puede progresar a un grado mayor con el tiempo.",
    "III": "Grado OMS III: células de comportamiento agresivo y crecimiento más rápido.",
    "IV": "Grado OMS IV: el más agresivo (p. ej. glioblastoma).",
}
GRADO_TXT = {
    "bajo": "Grado bajo: células de crecimiento más lento.",
    "alto": "Grado alto: células de crecimiento más rápido y comportamiento más agresivo.",
}
MALIGNIDAD_TXT = {
    "no_tumoral": "Sin tumor.",
    "benigno": "Tumor de comportamiento benigno (no invade ni se disemina), aunque puede causar síntomas por su tamaño y ubicación.",
    "maligno": "Tumor de comportamiento maligno (cancerígeno).",
}


def info_tipo(codigo: str) -> dict:
    nombre, tumor, naturaleza, desc = tx.TIPOS[codigo]
    i = TIPOS_INFO[codigo]
    return {"nombre": nombre, "naturaleza": naturaleza, "resumen": i["resumen"],
            "recomendaciones": list(i["recomendaciones"]), "pronostico_general": i["pronostico_general"]}


def informe_base(pred: dict, evolucion: dict | None = None) -> dict:
    """pred: salida de Predictor.predecir (tipo, malignidad, grado, grado_oms, confianza...)."""
    info = info_tipo(pred["tipo"]["clase"])
    alertas = []
    if pred["tipo"]["confianza"] < 0.60:
        alertas.append("Resultado poco concluyente (confianza baja). Se recomienda revisión médica de la imagen.")
    otros = sorted(((c, p) for c, p in pred["tipo"]["probabilidades"].items() if c != pred["tipo"]["clase"]),
                   key=lambda kv: -kv[1])
    if otros and otros[0][1] >= 0.25:
        alertas.append(f"Existe otra categoría con probabilidad relevante: {tx.TIPOS[otros[0][0]][0]} ({otros[0][1]:.0%}).")
    mal = pred.get("malignidad")
    if mal and mal["fuente"] == "conocimiento_general":
        alertas.append("La naturaleza mostrada es la habitual de este tipo de lesión (conocimiento general), "
                       "no una predicción del modelo para este caso.")
    texto_oms = texto_grado = None
    if pred.get("grado_oms"):
        texto_oms = GRADO_OMS_TXT[pred["grado_oms"]["clase"]]
    if pred.get("grado"):
        texto_grado = GRADO_TXT[pred["grado"]["clase"]]
    if texto_oms or texto_grado:
        alertas.append("El grado estimado por imagen es orientativo: el grado real lo define el análisis del tejido.")
    out = {
        "tipo": info["nombre"],
        "naturaleza": info["naturaleza"],
        "naturaleza_texto": MALIGNIDAD_TXT.get(mal["clase"]) if mal else None,
        "resumen": info["resumen"],
        "grado_oms_texto": texto_oms,
        "grado_texto": texto_grado,
        "recomendaciones": info["recomendaciones"],
        "pronostico_general": info["pronostico_general"],
        "alertas": alertas,
        "aviso": AVISO,
        "generado_por": "plantilla",
    }
    if evolucion and evolucion.get("disponible"):
        out["evolucion_resumen"] = evolucion.get("mensaje")
        if evolucion.get("categoria") == "progresion":
            out["recomendaciones"].insert(0, "Se detectaron cambios compatibles con progresión respecto a estudios "
                                             "previos: comparte este resultado con tu médico lo antes posible.")
    return out
