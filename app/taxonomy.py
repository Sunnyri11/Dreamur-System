"""Taxonomía de Dreamur-Detector (solo tumores CEREBRALES).

Hay un modelo por MODALIDAD de imagen: 'mri' (resonancia) y 'tc' (tomografía). Cada modelo tiene varias "cabezas":

  tipo       : tipo de tumor (clases propias de los datos entrenados)
  malignidad : no_tumoral | benigno | maligno
  grado      : bajo | alto               (gliomas LGG/HGG, p. ej. BraTS)
  grado_oms  : I | II | III | IV         (grado OMS, p. ej. UCSF-PDGM)

Los tumores cerebrales NO se estadifican con TNM como el cáncer de pulmón o mama: "qué tan avanzado está" se
expresa con el GRADO (OMS), el tamaño/extensión y la evolución en el tiempo. Si un dataset no trae una etiqueta,
queda desconocida (-1) y esa cabeza no aprende de esa imagen: NUNCA se inventan etiquetas.
"""

MODALIDADES = ["mri", "tc"]
SECUENCIAS = ["t1", "t1c", "t2", "flair", "otra"]   # informativa (MRI); el modelo no la usa como entrada

MALIGNIDAD = ["no_tumoral", "benigno", "maligno"]
GRADO = ["bajo", "alto"]
GRADO_OMS = ["I", "II", "III", "IV"]
HEADS_FIJOS = {"malignidad": MALIGNIDAD, "grado": GRADO, "grado_oms": GRADO_OMS}
HEADS = ["tipo", "malignidad", "grado", "grado_oms"]  # orden fijo de columnas de etiquetas
HEADS_GRADO = ("grado", "grado_oms")

SIN_TUMOR = "sin_tumor"

# codigo -> (nombre, es_tumor, naturaleza_general, descripcion)
TIPOS = {
    "sin_tumor": ("Sin tumor", False, "No aplica", "No se observa un patrón compatible con tumor."),
    "glioma": ("Glioma", True, "Variable: de bajo grado a muy agresivo (glioblastoma)",
               "Tumor de las células gliales del cerebro."),
    "meningioma": ("Meningioma", True, "Mayormente benigno (grado I)", "Tumor de las meninges."),
    "pituitario": ("Tumor de hipófisis (pituitario)", True, "Mayormente benigno",
                   "Adenoma de la glándula hipófisis."),
    "metastasis_cerebral": ("Metástasis cerebral", True, "Maligno (cáncer de otro órgano)",
                            "Tumor secundario: células de un cáncer de otra parte del cuerpo."),
}

# Malignidad implícita en el propio tipo (solo donde no hay ambigüedad).
MALIGNIDAD_POR_TIPO = {"sin_tumor": "no_tumoral", "metastasis_cerebral": "maligno"}
# glioma, meningioma y pituitario NO están a propósito: dependen del grado/patología de cada caso.


def validar_modalidad(modalidad: str) -> None:
    if modalidad not in MODALIDADES:
        raise ValueError(f"Modalidad desconocida '{modalidad}'. Válidas: {MODALIDADES}")


def es_tumor(codigo: str) -> bool:
    return TIPOS[codigo][1]


def validar_etiqueta(tipo: str, malignidad=None, grado=None, grado_oms=None) -> None:
    if tipo not in TIPOS:
        raise ValueError(f"Tipo de tumor desconocido: '{tipo}'. Válidos: {list(TIPOS)}")
    if malignidad is not None and malignidad not in MALIGNIDAD:
        raise ValueError(f"Malignidad inválida: '{malignidad}'")
    if grado is not None and grado not in GRADO:
        raise ValueError(f"Grado inválido: '{grado}' (usa bajo o alto)")
    if grado_oms is not None and grado_oms not in GRADO_OMS:
        raise ValueError(f"Grado OMS inválido: '{grado_oms}' (usa I, II, III o IV)")
    if not es_tumor(tipo) and (grado or grado_oms):
        raise ValueError(f"'{tipo}' no es un tumor: no puede tener grado")


def normalizar_grado_oms(texto: str | None) -> str | None:
    """'2' -> 'II', 'WHO grade 4' -> 'IV', 'III' -> 'III'. Devuelve None si no se reconoce."""
    if not texto:
        return None
    t = texto.strip().upper().replace("WHO", "").replace("OMS", "").replace("GRADE", "").replace("GRADO", "").strip()
    if len(t) == 1 and t in "1234":
        return GRADO_OMS[int(t) - 1]
    for pref in ("IV", "III", "II", "I"):
        if t == pref:
            return pref
    return None


def normalizar_grado(texto: str | None) -> str | None:
    """'LGG' -> 'bajo', 'HGG' -> 'alto'."""
    if not texto:
        return None
    t = texto.strip().lower()
    return {"lgg": "bajo", "low": "bajo", "bajo": "bajo", "hgg": "alto", "high": "alto", "alto": "alto"}.get(t)
