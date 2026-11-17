"""Análisis de la imagen de entrada: tipo de corte (axial / coronal / sagital) y medida de la cabeza.

Es un método clásico (sin red neuronal y sin dataset): se segmenta la cabeza, se mide su forma y su
simetría izquierda-derecha y se clasifica con una regresión softmax de 3 parámetros por clase.

  - axial:    contorno ovalado más alto que ancho y simétrico en los dos sentidos (izq-der y arriba-abajo)
  - coronal:  más ancho que alto, simétrico izquierda-derecha pero no arriba-abajo (cúpula arriba, tronco abajo)
  - sagital:  poco simétrico izquierda-derecha (perfil: cerebelo, tronco, frente distinta de la nuca)

IMPORTANTE: los pesos iniciales (PESOS_INICIALES) se ajustaron con cortes SINTÉTICOS del propio modelo 3D
(tools/calibrar_plano.py --fantomas): separan bien el corte axial, pero coronal vs sagital queda con
poca confianza. NO están validados con resonancias reales. Se recalibran con las imágenes del proyecto
(carpetas axial/ coronal/ sagital/) usando tools/calibrar_plano.py, que guarda app/plano_modelo.json;
si ese archivo existe, se usa en lugar de los valores iniciales.
"""
from __future__ import annotations

import io
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

CLASES = ("axial", "coronal", "sagital")
MAX_LADO = 256               # la imagen se reduce a este lado máximo antes de analizarla (poca RAM)
MAX_PIXELES = 40_000_000     # protección contra imágenes gigantes
AREA_MIN, AREA_MAX = 0.08, 0.97
RUTA_MODELO = Path(os.getenv("DREAMUR_PLANO_MODELO", str(Path(__file__).with_name("plano_modelo.json"))))

# logit_c = b + w . [ln(alto/ancho), simetria izq-der, simetria arriba-abajo]   (clase -> [b, w1, w2, w3])
CARACTERISTICAS = ("log_aspecto", "simetria", "simetria_vertical")
PESOS_INICIALES = {   # ajustados con cortes sintéticos (tools/calibrar_plano.py --fantomas)
    "axial":   [-9.816, 22.6295, 4.1499, 18.9212],
    "coronal": [-0.0946, 3.7852, 3.7929, 1.3173],
    "sagital": [9.9105, -26.4147, -7.9429, -20.2385],
}


@dataclass
class AnalisisImagen:
    valida: bool
    plano: str | None = None
    confianza: float = 0.0
    probabilidades: dict = field(default_factory=dict)
    caja: tuple[float, float, float, float] | None = None   # (x0, y0, x1, y1) normalizada, cabeza en la imagen
    anterior_a_la_izquierda: bool | None = None             # solo sagital
    invertir_vertical: bool | None = None                    # solo axial: True si la frente está abajo
    caracteristicas: dict = field(default_factory=dict)
    motivo: str | None = None


def cargar_pesos() -> dict:
    try:
        datos = json.loads(RUTA_MODELO.read_text())
        if all(c in datos and len(datos[c]) == len(CARACTERISTICAS) + 1 for c in CLASES):
            return {c: [float(x) for x in datos[c]] for c in CLASES}
    except (OSError, ValueError):
        pass
    return PESOS_INICIALES


def _a_gris(datos: bytes) -> np.ndarray:
    im = Image.open(io.BytesIO(datos))
    if im.size[0] * im.size[1] > MAX_PIXELES:
        raise ValueError("Imagen demasiado grande")
    im.draft("L", (MAX_LADO * 2, MAX_LADO * 2))   # JPEG: decodifica ya reducida
    im = im.convert("L")
    im.thumbnail((MAX_LADO, MAX_LADO))
    return np.asarray(im, dtype=np.uint8)


def mascara_cabeza(g: np.ndarray) -> np.ndarray | None:
    """Máscara de la cabeza/cerebro: lo claro sobre el fondo, componente mayor, sin huecos."""
    s = ndi.gaussian_filter(g.astype(float), 1.5)
    t = max(0.10 * float(np.percentile(s, 99)), 12.0)
    m = s > t
    borde = np.concatenate([m[0, :], m[-1, :], m[:, 0], m[:, -1]])
    if borde.mean() > 0.5:      # fondo claro: se invierte
        m = ~m
    m = ndi.binary_opening(m, iterations=2)
    etiquetas, n = ndi.label(m)
    if n == 0:
        return None
    tamanos = ndi.sum(m, etiquetas, range(1, n + 1))
    m = etiquetas == (1 + int(np.argmax(tamanos)))
    return ndi.binary_fill_holes(m)


def _correlacion(a: np.ndarray, b: np.ndarray) -> float:
    if a.size < 10 or a.std() < 1e-6 or b.std() < 1e-6:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def caracteristicas(g: np.ndarray, m: np.ndarray) -> dict:
    filas, cols = np.nonzero(m)
    r0, r1, c0, c1 = filas.min(), filas.max(), cols.min(), cols.max()
    crop = m[r0:r1 + 1, c0:c1 + 1]
    h, w = crop.shape
    gc = ndi.gaussian_filter(g[r0:r1 + 1, c0:c1 + 1].astype(float), max(1.0, 0.012 * max(h, w)))  # estructuras grandes
    espejo = crop[:, ::-1]
    iou = float((crop & espejo).sum() / max((crop | espejo).sum(), 1))
    ambos = crop & espejo
    zncc = _correlacion(gc[ambos], gc[:, ::-1][ambos])
    simetria = 0.5 * iou + 0.5 * max(zncc, 0.0)
    arriba_abajo = crop[::-1]
    iou_v = float((crop & arriba_abajo).sum() / max((crop | arriba_abajo).sum(), 1))
    ambos_v = crop & arriba_abajo
    zncc_v = _correlacion(gc[ambos_v], gc[::-1][ambos_v])
    simetria_v = 0.5 * iou_v + 0.5 * max(zncc_v, 0.0)

    k = max(2, int(0.25 * h))
    ancho_fila = crop.sum(axis=1)
    razon_sup_inf = float(ancho_fila[:k].mean() / max(ancho_fila[-k:].mean(), 1e-6))
    bajo_cols = np.nonzero(crop[-max(2, int(0.12 * h)):])[1]
    desplazamiento_bajo = float(bajo_cols.mean() / w - 0.5) if bajo_cols.size else 0.0
    H, W = m.shape
    return {
        "aspecto": h / w, "log_aspecto": float(np.log(h / w)), "simetria": simetria,
        "iou_espejo": iou, "zncc_espejo": zncc, "simetria_vertical": simetria_v, "razon_sup_inf": razon_sup_inf,
        "desplazamiento_bajo": desplazamiento_bajo, "area": float(m.mean()),
        "caja": (float(c0 / W), float(r0 / H), float((c1 + 1) / W), float((r1 + 1) / H)),
    }


def vector(c: dict) -> np.ndarray:
    return np.array([c[f] for f in CARACTERISTICAS])


def ajustar(X: np.ndarray, y: np.ndarray, l2: float = 0.5) -> dict:
    """Regresión softmax multinomial con regularización L2 (L-BFGS). X: (n, nf) características, y: índices de CLASES.
    Las características se centran/escalan internamente y los pesos se devuelven en la escala original."""
    from scipy.optimize import minimize
    mu, sd = X.mean(axis=0), np.maximum(X.std(axis=0), 1e-6)
    Z = (X - mu) / sd
    n, nf = Z.shape
    Y = np.eye(len(CLASES))[y]

    def f(theta):
        W = theta.reshape(len(CLASES), nf + 1)
        L = W[:, 0] + Z @ W[:, 1:].T
        L -= L.max(axis=1, keepdims=True)
        P = np.exp(L)
        P /= P.sum(axis=1, keepdims=True)
        perdida = -np.log(np.maximum(P[np.arange(n), y], 1e-12)).mean() + l2 * (W[:, 1:] ** 2).sum() / n
        G = (P - Y) / n
        grad = np.hstack([G.sum(axis=0)[:, None], G.T @ Z]) + np.hstack([np.zeros((len(CLASES), 1)), 2 * l2 * W[:, 1:] / n])
        return perdida, grad.ravel()

    W = minimize(f, np.zeros(len(CLASES) * (nf + 1)), jac=True, method="L-BFGS-B").x.reshape(len(CLASES), nf + 1)
    w = W[:, 1:] / sd
    b = W[:, 0] - (w * mu).sum(axis=1)
    return {c: [round(float(b[i]), 4)] + [round(float(v), 4) for v in w[i]] for i, c in enumerate(CLASES)}


def clasificar(c: dict, pesos: dict | None = None) -> dict:
    pesos = pesos or cargar_pesos()
    x = np.array([c[f] for f in CARACTERISTICAS])
    z = np.array([pesos[k][0] + float(np.dot(pesos[k][1:], x)) for k in CLASES])
    z -= z.max()
    p = np.exp(z) / np.exp(z).sum()
    return {k: float(v) for k, v in zip(CLASES, p)}


def orientacion(plano: str, c: dict) -> tuple[bool | None, bool | None]:
    """(invertir_vertical, anterior_a_la_izquierda) para un plano dado; None = no se puede saber."""
    inv_v = ant_izq = None
    if plano == "axial" and not (0.93 <= c["razon_sup_inf"] <= 1.07):
        inv_v = c["razon_sup_inf"] > 1.07          # la frente es el extremo más angosto
    if plano == "sagital" and abs(c["desplazamiento_bajo"]) >= 0.06:
        ant_izq = c["desplazamiento_bajo"] > 0     # cerebelo y tronco quedan atrás (parte baja)
    return inv_v, ant_izq


def analizar_imagen(datos: bytes) -> AnalisisImagen:
    try:
        g = _a_gris(datos)
    except Exception as e:  # imagen ilegible, formato raro, demasiado grande...
        return AnalisisImagen(False, motivo=f"No se pudo leer la imagen: {type(e).__name__}")
    m = mascara_cabeza(g)
    if m is None or not (AREA_MIN <= m.mean() <= AREA_MAX):
        return AnalisisImagen(False, motivo="No se distingue la cabeza en la imagen")
    c = caracteristicas(g, m)
    probs = clasificar(c)
    plano = max(probs, key=probs.get)

    inv_v, ant_izq = orientacion(plano, c)
    return AnalisisImagen(True, plano, probs[plano], probs, c["caja"], ant_izq, inv_v,
                          {k: v for k, v in c.items() if k != "caja"})
