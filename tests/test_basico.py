"""Pruebas que NO necesitan PyTorch, Neon ni R2:  pytest -q"""
import io
import zipfile
from datetime import date
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app import conocimiento, history, readers, viz
from app import taxonomy as tx
from datasets import adapters


def _png(path, color=100, size=(16, 16)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (color, color, color)).save(path)
    return path


# ------------------------------------------------------------ taxonomía y conocimiento
def test_taxonomia_consistente():
    assert set(tx.MALIGNIDAD_POR_TIPO) <= set(tx.TIPOS)
    assert tx.MODALIDADES == ["mri", "tc"]
    for codigo in tx.TIPOS:
        info = conocimiento.info_tipo(codigo)
        assert info["nombre"] and info["recomendaciones"] and info["resumen"]


def test_validar_etiqueta():
    tx.validar_etiqueta("glioma", None, "alto", "IV")
    with pytest.raises(ValueError):
        tx.validar_etiqueta("sin_tumor", grado_oms="II")     # normal no tiene grado
    with pytest.raises(ValueError):
        tx.validar_etiqueta("tumor_de_pulmon")               # ya no hay tumores de otras zonas
    with pytest.raises(ValueError):
        tx.validar_etiqueta("glioma", malignidad="raro")
    with pytest.raises(ValueError):
        tx.validar_modalidad("rx")


def test_normalizar_grados():
    assert tx.normalizar_grado_oms("2") == "II" and tx.normalizar_grado_oms("WHO grade 4") == "IV"
    assert tx.normalizar_grado_oms("III") == "III" and tx.normalizar_grado_oms("") is None
    assert tx.normalizar_grado_oms("raro") is None
    assert tx.normalizar_grado("LGG") == "bajo" and tx.normalizar_grado("HGG") == "alto" and tx.normalizar_grado("x") is None


def test_malignidad_no_se_inventa():
    assert adapters.Muestra(Path("x"), "glioma").malignidad is None
    assert adapters.Muestra(Path("x"), "meningioma").malignidad is None
    assert adapters.Muestra(Path("x"), "sin_tumor").malignidad == "no_tumoral"
    assert adapters.Muestra(Path("x"), "metastasis_cerebral").malignidad == "maligno"


def test_informe_base():
    pred = {"tipo": {"clase": "glioma", "confianza": 0.55, "probabilidades": {"glioma": 0.55, "meningioma": 0.35, "sin_tumor": 0.10}},
            "malignidad": None, "grado": {"clase": "alto"}, "grado_oms": {"clase": "IV"}}
    ev = {"disponible": True, "categoria": "progresion", "mensaje": "Cambios compatibles con progresión."}
    inf = conocimiento.informe_base(pred, ev)
    assert any("poco concluyente" in a for a in inf["alertas"])
    assert inf["grado_oms_texto"].startswith("Grado OMS IV") and inf["grado_texto"].startswith("Grado alto")
    assert "progresión" in inf["recomendaciones"][0]


# ------------------------------------------------------------ lectores
def test_detectar_formato():
    assert readers.detectar_formato("a.NII.GZ", b"") == "nifti"
    assert readers.detectar_formato("a.zip", b"") == "zip"
    assert readers.detectar_formato("a.dcm", b"") == "dicom"
    assert readers.detectar_formato("x", b"\x00" * 128 + b"DICM") == "dicom"
    assert readers.detectar_formato("a.jpg", b"") == "imagen"


def test_imagen_y_16bit():
    buf = io.BytesIO()
    Image.new("RGB", (20, 10), "red").save(buf, format="PNG")
    cortes, meta = readers.cargar_cortes(buf.getvalue(), "a.png")
    assert len(cortes) == 1 and cortes[0].mode == "RGB" and meta["formato"] == "imagen"
    arr = (np.arange(64, dtype=np.uint16).reshape(8, 8) * 1000)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    c16, _ = readers.cargar_cortes(buf.getvalue(), "a.png")
    assert c16[0].mode == "RGB" and np.asarray(c16[0]).max() > 200


def test_archivo_invalido():
    with pytest.raises(readers.ArchivoNoSoportado):
        readers.cargar_cortes(b"no soy una imagen", "x.png")
    with pytest.raises(readers.ArchivoNoSoportado):
        readers.cargar_cortes(b"PK\x03\x04roto", "x.zip")


def test_zip_de_imagenes_reparte_cortes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for i in range(40):
            b = io.BytesIO()
            Image.new("RGB", (8, 8), (i, i, i)).save(b, format="PNG")
            z.writestr(f"serie/{i:03d}.png", b.getvalue())
    cortes, meta = readers.cargar_cortes(buf.getvalue(), "serie.zip", max_cortes=5)
    assert len(cortes) == 5 and meta["n_cortes_total"] == 40 and meta["indices"] == sorted(meta["indices"])
    assert len(readers.cargar_cortes(buf.getvalue(), "serie.zip", max_cortes=1)[0]) == 1
    forzado, m2 = readers.cargar_cortes(buf.getvalue(), "serie.zip", max_cortes=5, indice=7)
    assert m2["indices"] == [7] and len(forzado) == 1


def test_indices():
    assert readers._indices(3, 12) == [0, 1, 2]
    assert readers._indices(100, 1) == [49]
    assert len(readers._indices(100, 12)) == 12


def test_nifti_si_esta_instalado():
    nib = pytest.importorskip("nibabel")
    vol = np.zeros((16, 16, 10), dtype=np.float32)
    vol[4:10, 4:10, 3:7] = 500
    data = nib.Nifti1Image(vol, np.eye(4)).to_bytes()
    cortes, meta = readers.cargar_cortes(data, "v.nii", max_cortes=3)
    assert meta["formato"] == "nifti" and 1 <= len(cortes) <= 3
    assert readers.cargar_cortes(data, "v.nii", indice=4)[1]["indices"] == [4]


# ------------------------------------------------------------ historial
def _pt(i, dias, p, area, tipo="glioma", grado=None):
    d0 = date(2026, 1, 1)
    return history.punto(f"e{i}", d0.fromordinal(d0.toordinal() + dias), tipo, p, area, grado)


def test_primer_estudio_sin_historial():
    a = _pt(1, 0, 0.5, 0.05)
    assert history.estimar(history.construir_features([], a), a)["disponible"] is False


def test_progresion_regresion_estable():
    prev = [_pt(0, 0, 0.40, 0.04)]
    crece = _pt(1, 60, 0.70, 0.08)
    e = history.estimar(history.construir_features(prev, crece), crece)
    assert e["categoria"] == "progresion" and e["metodo"] == "reglas"
    assert e["proyeccion_area_90d"] > crece["area"] and "tiempo_duplicacion_dias" in e
    baja = _pt(1, 60, 0.20, 0.02)
    assert history.estimar(history.construir_features(prev, baja), baja)["categoria"] == "regresion"
    igual = _pt(1, 60, 0.41, 0.041)
    assert history.estimar(history.construir_features(prev, igual), igual)["categoria"] == "estable"


def test_grado_oms_sube_y_tratamiento():
    prev = [_pt(0, 0, 0.5, 0.05, grado={"II": 0.9, "III": 0.1})]
    act = _pt(1, 90, 0.5, 0.05, grado={"IV": 0.9, "III": 0.1})
    f = history.construir_features(prev, act)
    assert f["delta_grado"] > 1
    assert any("grado OMS" in s for s in history.estimar(f, act)["señales"])
    prev2, act2 = [_pt(0, 0, 0.8, 0.10)], _pt(1, 90, 0.5, 0.03)
    f2 = history.construir_features(prev2, act2, [{"tipo": "cirugia", "fecha": date(2026, 2, 1)}], edad=60)
    e2 = history.estimar(f2, act2)
    assert f2["hubo_tratamiento"] == 1 and e2["categoria"] == "regresion" and any("tratamiento" in s for s in e2["señales"])
    assert len(history.vector(f2)) == len(history.COLUMNAS)


def test_grado_esperado():
    assert history.grado_esperado({"I": 0.0, "II": 1.0}) == 2.0
    assert history.grado_esperado(None) is None


# ------------------------------------------------------------ zonas
def test_zonas_y_area():
    cam = np.zeros((224, 224))
    cam[60:120, 80:150] = 1
    z = viz.cam_to_boxes(cam)
    assert len(z) == 1 and 0 < viz.area_total(z) < 1
    assert viz.overlay_png(Image.new("RGB", (300, 300), "gray"), cam, z, "Glioma 90%")[:4] == b"\x89PNG"
    assert viz.cam_to_boxes(np.zeros((224, 224))) == []


# ------------------------------------------------------------ adaptadores de datasets cerebrales
def test_brain_kaggle(tmp_path):
    for sp, cls in [("Training", "glioma"), ("Training", "notumor"), ("Testing", "pituitary"), ("Testing", "meningioma")]:
        _png(tmp_path / sp / cls / "a.png")
    ms = list(adapters.brain_kaggle(tmp_path))
    assert {m.tipo for m in ms} == {"glioma", "sin_tumor", "pituitario", "meningioma"}
    assert [m.split for m in ms][:2] == ["test", "test"]   # Testing primero
    assert all(m.grado is None and m.grado_oms is None and m.modalidad == "mri" for m in ms)
    assert {m.tipo: m.malignidad for m in ms}["glioma"] is None


def test_brain_kaggle_nombres_antiguos(tmp_path):
    for cls in ["glioma_tumor", "no_tumor", "pituitary_tumor", "meningioma_tumor"]:
        _png(tmp_path / "Training" / cls / "a.jpg")
    assert {m.tipo for m in adapters.brain_kaggle(tmp_path)} == {"glioma", "sin_tumor", "pituitario", "meningioma"}


def test_manifest(tmp_path):
    _png(tmp_path / "a.png")
    (tmp_path / "m.csv").write_text(
        "ruta,tipo,secuencia,grado,grado_oms,idh,grupo_ref,fecha,corte,progresion\n"
        "a.png,glioma,flair,HGG,4,salvaje,P1,2025-03-01,12,1\n", encoding="utf-8")
    m = list(adapters.manifest(tmp_path, tmp_path / "m.csv"))[0]
    assert (m.grado, m.grado_oms, m.corte, m.progresion, m.grupo_ref, m.modalidad) == ("alto", "IV", 12, True, "P1", "mri")
    assert m.molecular == {"idh": "salvaje"} and m.secuencia == "flair"
    (tmp_path / "mala.csv").write_text("ruta,tipo\nno_existe.png,glioma\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        list(adapters.manifest(tmp_path, tmp_path / "mala.csv"))


def test_convertir_cheng_con_mat_clasico(tmp_path):
    scipy_io = pytest.importorskip("scipy.io")
    from scripts import convertir_cheng
    rng = np.random.default_rng(0)
    for i, label in enumerate([1, 2, 3]):
        d = {"cjdata": {"image": rng.integers(0, 4000, (32, 32)).astype(np.int16), "label": label, "PID": f"P{i}"}}
        scipy_io.savemat(tmp_path / f"{i + 1}.mat", d)
    import sys
    sys.argv = ["x", "--origen", str(tmp_path), "--destino", str(tmp_path / "out")]
    convertir_cheng.main()
    filas = (tmp_path / "out" / "manifiesto.csv").read_text().splitlines()
    assert len(filas) == 4 and filas[1].startswith("meningioma/1.png,meningioma,mri,t1c,cheng-P0")
    ms = list(adapters.manifest(tmp_path / "out", tmp_path / "out" / "manifiesto.csv"))
    assert {m.tipo for m in ms} == {"meningioma", "glioma", "pituitario"} and ms[0].secuencia == "t1c"
