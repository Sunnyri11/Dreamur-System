"""Constantes de Dreamur-Generate_Model: colores, tamaños y parámetros por tipo de tumor."""

VERSION_GENERADOR = "v2"

# Ejes del cerebro (sistema interno): x = derecha del paciente, y = anterior (frente), z = arriba.
# Semiejes del elipsoide base del cerebro (el modelo completo cabe siempre en [-1, 1], requisito de la cuantización int16).
SEMIEJES = (0.80, 0.94, 0.70)

# Fracción de la caja de la cabeza (o de la imagen entera si no se detecta) que ocupa el cerebro.
FRACCION_CEREBRO_EN_IMAGEN = 0.88

# Subdivisiones de la icosfera: cerebro 4 -> 5 120 triángulos, 5 -> 20 480; cerebelo 2 -> 320, 3 -> 1 280.
NIVEL_CEREBRO = {"bajo": 4, "medio": 5}
NIVEL_CEREBELO = {"bajo": 2, "medio": 3}
NIVEL_TUMOR = 3  # 1 280 triángulos por zona

MAX_ZONAS = 3  # zonas del detector que se modelan (las de mayor puntaje)

# Color del cerebro (azul tipo holograma) y transparencia para ver el tumor por dentro.
COLOR_CEREBRO = "#2f7bff"
ALFA_CEREBRO = 0.38

# Color del tumor según el tipo que devuelve Dreamur-Detector (códigos de tipos_tumor).
COLORES_TUMOR = {
    "glioma": "#ff3b30",      # rojo
    "meningioma": "#ffb020",  # ámbar
    "pituitario": "#c44dff",  # violeta
}
COLOR_TUMOR_DEFECTO = "#ff3b30"

# Brillo (KHR_materials_emissive_strength): lo que hace que el tumor "resplandezca" en el visor.
EMISIVO_FUERZA_TUMOR = 2.2
EMISIVO_FUERZA_VASOS = 1.4

# Forma del tumor por tipo: irr = irregularidad suave del contorno, bultos = nº de bultos tipo frambuesa,
# sigma = ancho de cada bulto (radianes), amp = altura de los bultos (fracción del radio).
FORMA_TUMOR = {
    "glioma": {"irr": 0.30, "bultos": 64, "sigma": 0.21, "amp": 0.20},
    "meningioma": {"irr": 0.10, "bultos": 34, "sigma": 0.28, "amp": 0.15},
    "pituitario": {"irr": 0.05, "bultos": 18, "sigma": 0.34, "amp": 0.08},
}
FORMA_TUMOR_DEFECTO = {"irr": 0.18, "bultos": 48, "sigma": 0.24, "amp": 0.16}

# Profundidad por defecto (solo plano axial), como fracción del semieje vertical:
# -1 = base del cerebro, 0 = centro, +1 = convexidad superior. El usuario puede forzarla.
PROFUNDIDAD_POR_TIPO = {"glioma": 0.0, "meningioma": 0.55, "pituitario": -0.65}

# Por debajo de esta confianza el resultado de la detección del corte se marca como dudoso.
UMBRAL_CONFIANZA_CORTE = 0.60
