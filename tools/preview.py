"""Vista previa PNG estilo holograma (rasterizador por software con PIL) para comprobar el modelo sin visor 3D.

Uso: python -I tools/preview.py salida.png [tipo] [x y ancho alto] [plano] [angulo_grados] [elevacion]
El brillo (bloom) y el borde luminoso del cerebro son solo de esta vista previa; en el visor real los
da el front (three.js: UnrealBloomPass / material con fresnel).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.generator import construir_mallas  # noqa: E402
from app.glb import a_gltf  # noqa: E402
from app.tumor import Zona  # noqa: E402


def renderizar(mallas, angulo=35.0, elevacion=12.0, tam=720, ss=2):
    a, e = np.radians(angulo), np.radians(elevacion)
    ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    rx = np.array([[1, 0, 0], [0, np.cos(e), -np.sin(e)], [0, np.sin(e), np.cos(e)]])
    R = rx @ ry
    luz = np.array([0.4, 0.6, 0.7]); luz /= np.linalg.norm(luz)
    T = tam * ss
    base = Image.new("RGB", (T, T), (2, 5, 12))
    dib = ImageDraw.Draw(base, "RGBA")
    brillo = Image.new("RGB", (T, T), (0, 0, 0))
    dib_b = ImageDraw.Draw(brillo)
    tri = []
    for m in mallas:
        v = a_gltf(np.asarray(m.vertices, float)) @ R.T
        n = a_gltf(np.asarray(m.normales, float)) @ R.T
        col = np.array(m.color[:3]) ** (1 / 2.2)
        cerebro = m.nombre == "cerebro"
        nf = n[m.caras].mean(axis=1)
        for k, f in enumerate(m.caras):
            if cerebro and nf[k, 2] < -0.35:
                continue
            nk = nf[k] / max(np.linalg.norm(nf[k]), 1e-9)
            lamb = 0.25 + 0.75 * max(0.0, float(nk @ luz))
            if cerebro:
                borde = (1 - abs(nk[2])) ** 2.2            # borde luminoso tipo holograma
                c = col * (0.30 * lamb + 0.15) + np.array([0.10, 0.45, 1.0]) * 0.55 * borde
                alfa = 0.34 + 0.50 * borde
            else:
                c = np.minimum(1.0, col * (0.30 + 0.85 * lamb))
                alfa = 1.0
            tri.append((v[f][:, 2].mean(), v[f], c, alfa, cerebro))
    tri.sort(key=lambda t: t[0])
    for _, p, c, alfa, cerebro in tri:
        xy = [((q[0] * 0.5 + 0.5) * T, (0.5 - q[1] * 0.5) * T) for q in p]
        dib.polygon(xy, fill=tuple(int(min(1, x) * 255) for x in c) + (int(alfa * 255),))
        if not cerebro:
            dib_b.polygon(xy, fill=tuple(int(min(1, x) * 255) for x in c))
    halo = brillo.filter(ImageFilter.GaussianBlur(T * 0.018))
    halo2 = brillo.filter(ImageFilter.GaussianBlur(T * 0.05))
    img = ImageChops.add(ImageChops.add(base, halo.point(lambda x: int(x * 0.55))), halo2.point(lambda x: int(x * 0.45)))
    return img.resize((tam, tam), Image.LANCZOS)


if __name__ == "__main__":
    salida = sys.argv[1] if len(sys.argv) > 1 else "preview.png"
    tipo = sys.argv[2] if len(sys.argv) > 2 else "glioma"
    zona = [float(s) for s in sys.argv[3:7]] if len(sys.argv) >= 7 else [0.42, 0.18, 0.16, 0.16]
    plano = sys.argv[7] if len(sys.argv) > 7 else "axial"
    angulo = float(sys.argv[8]) if len(sys.argv) > 8 else 35.0
    elev = float(sys.argv[9]) if len(sys.argv) > 9 else 12.0
    mallas, _, _ = construir_mallas(tipo, [Zona(*zona)], plano)
    renderizar(mallas, angulo, elev).save(salida)
    print("guardado", salida)
