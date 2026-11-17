"""Zonas y dibujo sobre la imagen (solo numpy + Pillow + scipy; sin PyTorch)."""
import base64
import io

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def cam_to_boxes(cam: np.ndarray, umbral: float = 0.5, max_zonas: int = 3, area_min: float = 0.01) -> list[dict]:
    """Convierte un mapa de calor [0,1] (HxW) en cajas normalizadas (0-1) para detecciones_zonas.

    Son regiones de ATENCIÓN del modelo (Grad-CAM), no una segmentación exacta del tumor.
    """
    h, w = cam.shape
    etiquetas, n = ndimage.label(cam >= umbral)
    zonas = []
    for i in range(1, n + 1):
        ys, xs = np.where(etiquetas == i)
        if len(ys) / (h * w) < area_min:
            continue
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        zonas.append({
            "x": x0 / w,
            "y": y0 / h,
            "ancho": (x1 - x0) / w,
            "alto": (y1 - y0) / h,
            "puntaje": float(cam[etiquetas == i].mean()),
        })
    zonas.sort(key=lambda z: z["puntaje"] * z["ancho"] * z["alto"], reverse=True)
    return zonas[:max_zonas]


def _jet(v: np.ndarray) -> np.ndarray:
    r = np.clip(1.5 - np.abs(4 * v - 3), 0, 1)
    g = np.clip(1.5 - np.abs(4 * v - 2), 0, 1)
    b = np.clip(1.5 - np.abs(4 * v - 1), 0, 1)
    return np.stack([r, g, b], axis=-1) * 255


def overlay_png(img: Image.Image, cam: np.ndarray, zonas: list[dict], etiqueta: str = "", max_lado: int = 768) -> bytes:
    """Imagen original + mapa de calor translúcido + rectángulos de las zonas sospechosas."""
    img = img.convert("RGB")
    if max(img.size) > max_lado:
        k = max_lado / max(img.size)
        img = img.resize((max(1, int(img.width * k)), max(1, int(img.height * k))), Image.BICUBIC)
    w, h = img.size

    base = np.asarray(img).astype(np.float32)
    if zonas:  # sin zonas (p. ej. "sin tumor") no se pinta calor
        cam_img = Image.fromarray((np.clip(cam, 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)
        c = np.asarray(cam_img).astype(np.float32) / 255.0
        alpha = (c * 0.55)[..., None]
        base = base * (1 - alpha) + _jet(c) * alpha
    out = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))

    d = ImageDraw.Draw(out)
    grosor = max(2, w // 200)
    for i, z in enumerate(zonas, 1):
        x0, y0 = z["x"] * w, z["y"] * h
        x1, y1 = (z["x"] + z["ancho"]) * w, (z["y"] + z["alto"]) * h
        d.rectangle([x0, y0, x1, y1], outline=(255, 235, 0), width=grosor)
        d.text((x0 + 4, max(0, y0 - 12)), f"Z{i}", fill=(255, 235, 0))
    if etiqueta:
        d.rectangle([0, 0, w, 18], fill=(0, 0, 0))
        d.text((6, 3), etiqueta, fill=(255, 255, 255))

    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def area_total(zonas: list[dict]) -> float:
    """Suma de áreas normalizadas (0-1) de las zonas: sirve para seguir si crece o se reduce entre estudios."""
    return float(min(1.0, sum(z["ancho"] * z["alto"] for z in zonas)))


def a_base64(png: bytes) -> str:
    return base64.b64encode(png).decode("ascii")
