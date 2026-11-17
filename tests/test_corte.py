"""Detección del tipo de corte. OJO: se prueba con cortes SINTÉTICOS (ver fantomas.py); el rendimiento con
resonancias reales hay que medirlo con tools/calibrar_plano.py y las imágenes del proyecto."""
import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import plano  # noqa: E402
from fantomas import POSICIONES, a_png, corte  # noqa: E402


@pytest.fixture(scope="module")
def resultados():
    rng = np.random.default_rng(99)   # distinta de la semilla con la que se ajustaron los pesos (11)
    filas = []
    for real, posiciones in POSICIONES.items():
        for craneo in (True, False):
            for p in posiciones:
                for oc in (0.6, 0.95):
                    for vv, hh in ((False, False), (True, False), (False, True)):
                        a = plano.analizar_imagen(a_png(corte(real, p, craneo), rng, ocupacion=oc, voltear_v=vv, voltear_h=hh))
                        filas.append((real, a, vv, hh))
    return filas


def test_axial_se_reconoce_siempre(resultados):
    axiales = [a for real, a, _, _ in resultados if real == "axial"]
    assert all(a.valida for a in axiales)
    assert np.mean([a.plano == "axial" for a in axiales]) >= 0.95


def test_precision_global_sobre_fantomas(resultados):
    assert np.mean([a.plano == real for real, a, _, _ in resultados]) >= 0.80


def test_nunca_confunde_axial_con_los_otros_dos_planos(resultados):
    otros = [a for real, a, _, _ in resultados if real != "axial"]
    assert np.mean([a.plano == "axial" for a in otros]) <= 0.05


def test_orientacion_cuando_se_da_es_correcta(resultados):
    axial = [(a.invertir_vertical, vv) for real, a, vv, hh in resultados
             if real == "axial" and a.plano == "axial" and a.invertir_vertical is not None]
    sagital = [(a.anterior_a_la_izquierda, not hh) for real, a, vv, hh in resultados
               if real == "sagital" and a.plano == "sagital" and a.anterior_a_la_izquierda is not None]
    assert axial and sagital
    assert np.mean([dado == real for dado, real in axial]) >= 0.9
    assert np.mean([dado == real for dado, real in sagital]) >= 0.9


def test_probabilidades_suman_uno_y_hay_caja(resultados):
    for _, a, _, _ in resultados[:20]:
        assert abs(sum(a.probabilidades.values()) - 1) < 1e-6
        x0, y0, x1, y1 = a.caja
        assert 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1


@pytest.mark.parametrize("datos", [b"", b"no es una imagen", b"\x89PNG\r\n\x1a\n" + b"0" * 20])
def test_imagen_ilegible_no_rompe(datos):
    a = plano.analizar_imagen(datos)
    assert not a.valida and a.motivo


def test_imagen_sin_cabeza_se_rechaza():
    for valor in (0, 255):   # negra o blanca: no hay forma
        buf = io.BytesIO()
        Image.fromarray(np.full((128, 128), valor, np.uint8)).save(buf, "PNG")
        assert not plano.analizar_imagen(buf.getvalue()).valida


def test_ajustar_aprende_y_el_json_de_calibracion_se_usa(tmp_path, monkeypatch):
    rng = np.random.default_rng(0)
    # 3 nubes separables en el espacio de características
    X = np.vstack([rng.normal(c, 0.05, (40, 3)) for c in ([0.2, 0.9, 0.9], [-0.3, 0.9, 0.6], [-0.4, 0.6, 0.6])])
    y = np.repeat([0, 1, 2], 40)
    pesos = plano.ajustar(X, y)
    pred = np.array([max(range(3), key=lambda k: pesos[plano.CLASES[k]][0] + np.dot(pesos[plano.CLASES[k]][1:], x)) for x in X])
    assert (pred == y).mean() > 0.95
    ruta = tmp_path / "plano_modelo.json"
    ruta.write_text(json.dumps(pesos))
    monkeypatch.setattr(plano, "RUTA_MODELO", ruta)
    assert plano.cargar_pesos() == pesos
    ruta.write_text("{ roto")
    assert plano.cargar_pesos() == plano.PESOS_INICIALES
