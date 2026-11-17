import json
import struct
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.brain import cerebro_base, icosfera  # noqa: E402
from app.config import SEMIEJES  # noqa: E402
from app.generator import generar_modelo, resolver_corte  # noqa: E402
from app.tubos import tubo  # noqa: E402
from app.tumor import Zona, centro_y_radios, malla_tumor  # noqa: E402
from app.vasos import construir_vasos  # noqa: E402

ZONA = Zona(0.42, 0.18, 0.16, 0.16, 0.9)


def leer_glb(datos: bytes):
    """Lector GLB independiente del exportador: valida estructura y devuelve (json, binario)."""
    magia, version, total = struct.unpack_from("<4sII", datos, 0)
    assert magia == b"glTF" and version == 2 and total == len(datos)
    largo_json, tipo = struct.unpack_from("<I4s", datos, 12)
    assert tipo == b"JSON" and largo_json % 4 == 0
    gltf = json.loads(datos[20:20 + largo_json])
    off = 20 + largo_json
    largo_bin, tipo = struct.unpack_from("<I4s", datos, off)
    assert tipo == b"BIN\x00" and largo_bin % 4 == 0
    binario = datos[off + 8: off + 8 + largo_bin]
    assert off + 8 + largo_bin == total
    assert gltf["buffers"][0]["byteLength"] <= len(binario)
    return gltf, binario


def leer_accesor(gltf, binario, i):
    a = gltf["accessors"][i]
    v = gltf["bufferViews"][a["bufferView"]]
    assert v["byteOffset"] % 4 == 0
    assert v["byteOffset"] + v["byteLength"] <= len(binario)
    return a, v


def test_icosfera_conteos():
    for nivel in range(5):
        v, f = icosfera(nivel)
        assert len(f) == 20 * 4 ** nivel
        assert len(v) == 10 * 4 ** nivel + 2
        assert np.allclose(np.linalg.norm(v, axis=1), 1)


def test_cerebro_con_cerebelo_y_tronco_cabe_en_cuantizacion():
    c = cerebro_base("medio")
    assert np.abs(c.vertices).max() < 1.0
    assert np.isfinite(c.vertices).all() and np.isfinite(c.normales).all()
    assert len(c.vertices) > 10242 + 642               # hemisferios + cerebelo + tronco
    assert c.vertices[:, 2].min() < -0.85              # el tronco baja por debajo de los hemisferios
    assert c.vertices[:, 1].min() < -0.80              # el cerebelo asoma por detrás


def test_glb_valido_con_cerebro_tumor_y_vasos():
    r = generar_modelo("glioma", [ZONA], plano="axial")
    gltf, binario = leer_glb(r.glb)
    assert [n["name"] for n in gltf["nodes"]] == ["cerebro", "tumor", "vasos"]
    assert gltf["extensionsRequired"] == ["KHR_mesh_quantization"]
    assert "KHR_materials_emissive_strength" in gltf["extensionsUsed"]
    mats = gltf["materials"]
    c = [m["pbrMetallicRoughness"]["baseColorFactor"] for m in mats]
    assert c[0][2] > c[0][0] and c[0][2] > c[0][1]                  # cerebro azul
    assert c[1][0] > c[1][2]                                        # glioma rojizo
    assert mats[0]["alphaMode"] == "BLEND"
    assert mats[1]["extensions"]["KHR_materials_emissive_strength"]["emissiveStrength"] > 1   # el tumor brilla
    for malla in gltf["meshes"]:
        p = malla["primitives"][0]
        a_pos, v_pos = leer_accesor(gltf, binario, p["attributes"]["POSITION"])
        a_nor, _ = leer_accesor(gltf, binario, p["attributes"]["NORMAL"])
        a_idx, v_idx = leer_accesor(gltf, binario, p["indices"])
        n = a_pos["count"]
        assert a_nor["count"] == n and a_idx["count"] % 3 == 0
        datos = np.frombuffer(binario, np.int16, count=n * 4, offset=v_pos["byteOffset"]).reshape(n, 4)[:, :3]
        assert datos.min(axis=0).tolist() == a_pos["min"] and datos.max(axis=0).tolist() == a_pos["max"]
        tipo = np.uint16 if a_idx["componentType"] == 5123 else np.uint32
        idx = np.frombuffer(binario, tipo, count=a_idx["count"], offset=v_idx["byteOffset"])
        assert idx.max() < n


def test_color_cambia_con_el_tipo():
    rojo = leer_glb(generar_modelo("glioma", [ZONA]).glb)[0]["materials"][1]["pbrMetallicRoughness"]["baseColorFactor"]
    ambar = leer_glb(generar_modelo("meningioma", [ZONA]).glb)[0]["materials"][1]["pbrMetallicRoughness"]["baseColorFactor"]
    violeta = leer_glb(generar_modelo("pituitario", [ZONA]).glb)[0]["materials"][1]["pbrMetallicRoughness"]["baseColorFactor"]
    assert rojo != ambar != violeta and ambar[1] > rojo[1] and violeta[2] > rojo[2]


def test_sin_tumor_solo_cerebro_y_vasos_opcionales():
    r = generar_modelo("sin_tumor", [ZONA])
    assert [n["name"] for n in leer_glb(r.glb)[0]["nodes"]] == ["cerebro"]
    assert r.n_triangulos_tumor is None and r.parametros["color_tumor"] is None and not r.parametros["vasos"]
    assert generar_modelo("glioma", []).n_triangulos_tumor is None
    dos = generar_modelo("glioma", [ZONA], vasos=False)
    assert [n["name"] for n in leer_glb(dos.glb)[0]["nodes"]] == ["cerebro", "tumor"]


def test_peso_liviano():
    assert generar_modelo("glioma", [ZONA], calidad="bajo").tam_bytes < 140_000
    assert generar_modelo("glioma", [ZONA], calidad="medio").tam_bytes < 350_000


def test_determinista():
    a = generar_modelo("meningioma", [ZONA])
    b = generar_modelo("meningioma", [ZONA])
    assert a.sha256 == b.sha256
    assert generar_modelo("meningioma", [Zona(0.2, 0.2, 0.2, 0.2)]).sha256 != a.sha256


@pytest.mark.parametrize("tipo", ["glioma", "meningioma", "pituitario", "otro_tipo"])
@pytest.mark.parametrize("plano", ["axial", "coronal", "sagital"])
@pytest.mark.parametrize("zona", [Zona(0.0, 0.0, 0.3, 0.3), Zona(0.7, 0.7, 0.3, 0.3), Zona(0.4, 0.4, 0.2, 0.2),
                                  Zona(0.0, 0.0, 1.0, 1.0)])
def test_tumor_siempre_dentro_del_cerebro(tipo, plano, zona):
    cerebro = cerebro_base("medio")
    t = malla_tumor(cerebro, tipo, [zona], plano, semilla=3, invertir_vertical=True,
                    caja=(0.1, 0.1, 0.9, 0.9))
    p = t.vertices.astype(float)
    assert (np.linalg.norm(p, axis=1) <= 0.95 * cerebro.radio_superficie(p) + 1e-6).all()
    assert np.isfinite(p).all() and np.isfinite(t.normales).all()


def test_posicion_sigue_a_la_zona_y_a_las_orientaciones():
    cerebro = cerebro_base("medio")
    c, _ = centro_y_radios(Zona(0.10, 0.10, 0.16, 0.16), cerebro, "axial", "glioma", None)
    assert c[0] > 0 and c[1] > 0          # izquierda de la imagen = derecha del paciente; arriba = anterior
    c2, _ = centro_y_radios(Zona(0.70, 0.70, 0.16, 0.16), cerebro, "axial", "glioma", None)
    assert c2[0] < 0 and c2[1] < 0
    ci, _ = centro_y_radios(Zona(0.10, 0.10, 0.16, 0.16), cerebro, "axial", "glioma", None, invertir_horizontal=True)
    assert ci[0] < 0
    cv, _ = centro_y_radios(Zona(0.10, 0.10, 0.16, 0.16), cerebro, "axial", "glioma", None, invertir_vertical=True)
    assert cv[1] < 0                      # frente abajo en la imagen
    cz, _ = centro_y_radios(Zona(0.42, 0.10, 0.16, 0.16), cerebro, "coronal", "glioma", None)
    assert cz[2] > 0
    cs, _ = centro_y_radios(Zona(0.10, 0.42, 0.16, 0.16), cerebro, "sagital", "glioma", None)
    assert cs[1] > 0                      # sagital: izquierda de la imagen = anterior


def test_caja_de_la_cabeza_reescala_la_zona():
    cerebro = cerebro_base("medio")
    z = Zona(0.30, 0.45, 0.10, 0.10)
    sin, _ = centro_y_radios(z, cerebro, "axial", "glioma", None)
    con, _ = centro_y_radios(z, cerebro, "axial", "glioma", None, caja=(0.25, 0.10, 0.75, 0.90))
    assert abs(con[0]) > abs(sin[0])      # una caja más estrecha que la imagen estira la posición hacia los bordes
    borde, _ = centro_y_radios(Zona(0.26, 0.45, 0.05, 0.05), cerebro, "axial", "glioma", None, caja=(0.25, 0.10, 0.75, 0.90))
    assert borde[0] > 0.45                # casi en el borde derecho de la caja = casi en el borde del cerebro


def test_profundidad_por_tipo_y_override():
    cerebro = cerebro_base("medio")
    z = Zona(0.42, 0.42, 0.16, 0.16)
    cm, _ = centro_y_radios(z, cerebro, "axial", "meningioma", None)
    cp, _ = centro_y_radios(z, cerebro, "axial", "pituitario", None)
    assert cm[2] > 0 > cp[2]
    assert centro_y_radios(z, cerebro, "axial", "glioma", -0.5)[0][2] < 0


def test_tamano_escala_con_la_zona():
    cerebro = cerebro_base("medio")
    chico = malla_tumor(cerebro, "glioma", [Zona(0.45, 0.45, 0.08, 0.08)], semilla=1)
    grande = malla_tumor(cerebro, "glioma", [Zona(0.35, 0.35, 0.3, 0.3)], semilla=1)
    ext = lambda t: np.ptp(t.vertices, axis=0).max()  # noqa: E731
    assert ext(grande) > 2 * ext(chico)


def test_tumor_con_bultos_no_es_un_elipsoide_liso():
    cerebro = cerebro_base("medio")
    t = malla_tumor(cerebro, "glioma", [Zona(0.35, 0.35, 0.2, 0.2)], semilla=1)
    c = np.array(t.zonas[0]["centro"])
    r = np.linalg.norm(t.vertices - c, axis=1)
    assert r.std() / r.mean() > 0.05      # relieve de frambuesa: el radio varía de punto a punto


def test_varias_zonas_en_una_sola_malla_y_tope():
    zonas = [Zona(0.1 * i, 0.1 * i, 0.1, 0.1, puntaje=i / 10) for i in range(1, 6)]
    t = malla_tumor(cerebro_base("medio"), "glioma", zonas, semilla=1)
    assert len(t.zonas) == 3 and t.zonas[0]["puntaje"] == 0.5 and len(t.caras) == 3 * 1280


def test_vasos_dentro_del_cerebro_y_llegan_al_tumor():
    cerebro = cerebro_base("medio")
    t = malla_tumor(cerebro, "glioma", [ZONA], semilla=5)
    z = t.zonas[0]
    v, f, n = construir_vasos(cerebro, z["centro"], max(z["radios"]), 5)
    assert np.isfinite(v).all() and np.abs(v).max() < 1 and f.max() < len(v) and len(n) == len(v)
    assert (np.linalg.norm(v, axis=1) <= 1.0 * cerebro.radio_superficie(v)).all()
    assert np.linalg.norm(v - np.array(z["centro"]), axis=1).min() < 1.5 * max(z["radios"])   # el tronco toca el tumor


def test_tubo_tiene_normales_hacia_afuera():
    from app.geometria import normales
    centros = np.stack([np.zeros(8), np.zeros(8), np.linspace(0, 1, 8)], axis=1)
    v, f = tubo(centros, np.full(8, 0.1), lados=8)
    n = normales(v, f)
    radial = np.c_[v[:-1, 0], v[:-1, 1], np.zeros(len(v) - 1)]
    assert np.einsum("ij,ij->i", n[:-1], radial).mean() > 0


@pytest.mark.parametrize("zona", [Zona(-0.1, 0.2, 0.1, 0.1), Zona(0.2, 0.2, 0.0, 0.1), Zona(0.2, 1.5, 0.1, 0.1),
                                  Zona(float("nan"), 0.2, 0.1, 0.1)])
def test_zona_invalida(zona):
    with pytest.raises(ValueError):
        generar_modelo("glioma", [zona])


def test_plano_y_calidad_invalidos():
    with pytest.raises(ValueError):
        generar_modelo("glioma", [ZONA], plano="diagonal")
    with pytest.raises(ValueError):
        generar_modelo("glioma", [ZONA], calidad="ultra")


# ---------- resolución del corte (plano auto / manual) ----------
def test_corte_manual_no_usa_la_imagen_para_el_plano():
    info = resolver_corte("coronal", None, None, None)
    assert info["plano"] == "coronal" and info["origen"] == "manual" and not info["dudoso"]


def test_corte_auto_sin_imagen_asume_axial_y_avisa():
    info = resolver_corte("auto", None, None, None)
    assert info["plano"] == "axial" and info["origen"] == "defecto" and info["dudoso"] and info["advertencia"]
    assert generar_modelo("glioma", [ZONA]).parametros["corte"]["origen"] == "defecto"


def test_corte_auto_con_imagen_ilegible_cae_a_axial_con_aviso():
    info = resolver_corte("auto", b"esto no es una imagen", None, None)
    assert info["plano"] == "axial" and info["origen"] == "defecto" and "leer" in info["advertencia"]


def test_corte_auto_con_imagen_detecta_y_pasa_la_caja():
    from fantomas import a_png, corte
    png = a_png(corte("axial", 0.05), np.random.default_rng(1))
    r = generar_modelo("glioma", [ZONA], imagen=png)
    c = r.parametros["corte"]
    assert c["origen"] == "imagen" and c["plano"] == "axial" and c["caja"] and c["confianza"] > 0.5
    # lo indicado a mano manda sobre la detección
    forzado = generar_modelo("glioma", [ZONA], plano="sagital", imagen=png).parametros["corte"]
    assert forzado["plano"] == "sagital" and forzado["origen"] == "manual"
    assert generar_modelo("glioma", [ZONA], imagen=png).sha256 == r.sha256


def test_orientacion_manual_manda():
    info = resolver_corte("axial", None, True, True)
    assert info["invertir_horizontal"] is True and info["invertir_vertical"] is True


def test_semiejes_consistentes():
    assert max(SEMIEJES) < 1.0


def test_api_si_fastapi_instalado():
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    from app.main import app
    cli = TestClient(app)
    r = cli.post("/generar", json={"tipo_tumor": "glioma", "zonas": [{"x": .5, "y": .3, "ancho": .2, "alto": .2}]})
    assert r.status_code == 200 and r.json()["tam_bytes"] > 0
    assert cli.post("/generar", json={"tipo_tumor": "glioma", "zonas": [{"x": 2, "y": .3, "ancho": .2, "alto": .2}]}
                    ).status_code == 422
    assert cli.post("/generar", json={"tipo_tumor": "glioma", "imagen_base64": "###"}).status_code == 422
