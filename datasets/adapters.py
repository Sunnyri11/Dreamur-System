"""Adaptadores: convierten la carpeta de cada dataset de TUMORES CEREBRALES en muestras con la taxonomía de Dreamur.

Cada adaptador SOLO rellena las etiquetas que el dataset realmente trae; lo que no trae queda en None (esa cabeza
del modelo no aprende de esa imagen). Para cualquier otro dataset (BraTS, UCSF-PDGM, UPENN-GBM, LUMIERE, datos
propios) se usa el adaptador genérico `manifest` (CSV).
"""
import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Optional

from app import taxonomy as tx

EXT_IMG = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


@dataclass
class Muestra:
    ruta: Path
    tipo: str
    modalidad: str = "mri"
    secuencia: Optional[str] = None
    malignidad: Optional[str] = None
    grado: Optional[str] = None         # bajo | alto (LGG / HGG)
    grado_oms: Optional[str] = None     # I | II | III | IV
    histologia: Optional[str] = None
    molecular: dict = field(default_factory=dict)   # {"idh": "mutado", "mgmt": "metilado"} (solo se guarda)
    grupo_ref: Optional[str] = None     # paciente/caso: evita fuga de datos entre entrenamiento y prueba
    split: Optional[str] = None         # train | val | test (si el dataset ya lo trae)
    fecha: Optional[str] = None         # AAAA-MM-DD (estudios seriados)
    corte: Optional[int] = None         # corte clave de un volumen
    progresion: Optional[bool] = None
    notas: str = ""

    def __post_init__(self):
        if self.malignidad is None:  # solo si el propio tipo la define sin ambigüedad
            self.malignidad = tx.MALIGNIDAD_POR_TIPO.get(self.tipo)


# ------------------------------------------------------------------ fuentes (tabla dataset_fuentes)
# Licencias: solo las comprobadas; para el resto se remite a la página del dataset.
FUENTES = {
    "brain_kaggle": dict(nombre="Brain Tumor MRI Dataset (Masoud Nickparvar)",
                         url="https://www.kaggle.com/datasets/masoudnickparvar/brain-tumor-mri-dataset",
                         licencia="Ver página del dataset en Kaggle",
                         notas="~7.000 MRI en 4 clases (glioma, meningioma, pituitario, sin tumor). Sin grado ni "
                               "benigno/maligno por caso. Sin ID de paciente."),
    "cheng": dict(nombre="Brain tumor dataset (Jun Cheng et al., figshare)",
                  url="https://figshare.com/articles/dataset/brain_tumor_dataset/1512427",
                  licencia="Ver README del dataset en figshare",
                  notas="3.064 cortes T1 con contraste, 3 tipos (meningioma, glioma, pituitario). Con ID de paciente "
                        "(se usa para dividir sin fuga) y máscaras. Se convierte con scripts/convertir_cheng.py."),
    "brats": dict(nombre="BraTS (Brain Tumor Segmentation)", url="https://www.synapse.org/brats2023",
                  licencia="Ver términos en Synapse",
                  notas="MRI multisecuencia con máscaras; gliomas con grado LGG/HGG (ediciones antiguas), meningiomas "
                        "y metástasis (BraTS 2023). Usar con scripts/manifest_volumenes.py."),
    "ucsf_pdgm": dict(nombre="UCSF-PDGM (TCIA)", url="https://www.cancerimagingarchive.net/collection/ucsf-pdgm/",
                      licencia="Ver términos en TCIA", notas="Gliomas difusos con grado OMS y marcadores moleculares "
                                                             "(no verificado en esta sesión: confirma los campos)."),
    "upenn_gbm": dict(nombre="UPENN-GBM (TCIA)", url="https://www.cancerimagingarchive.net/collection/upenn-gbm/",
                      licencia="Ver términos en TCIA", notas="Glioblastoma con MRI y datos clínicos (no verificado)."),
    "lumiere": dict(nombre="LUMIERE (longitudinal, RANO)",
                    url="https://figshare.com/collections/The_LUMIERE_Dataset_Longitudinal_Glioblastoma_MRI_with_Expert_RANO_Evaluation/5904905",
                    licencia="Ver página en figshare",
                    notas="Glioblastoma con estudios seriados y evaluación RANO: sirve para entrenar la progresión."),
    "manifest": dict(nombre="Manifiesto propio (CSV)", url=None, licencia="Según el dataset de origen",
                     notas="Para BraTS, UCSF-PDGM, UPENN-GBM, LUMIERE y datos propios."),
}


def _dirs(raiz: Path, nombre: str):
    return [d for d in [raiz, *raiz.rglob("*")] if d.is_dir() and d.name.lower() == nombre]


def _imagenes(d: Path):
    return sorted(p for p in d.iterdir() if p.is_file() and p.suffix.lower() in EXT_IMG)


# ------------------------------------------------------------------ Brain Tumor MRI (Kaggle)
def brain_kaggle(raiz: Path) -> Iterator[Muestra]:
    mapa = {"glioma": "glioma", "glioma_tumor": "glioma", "meningioma": "meningioma", "meningioma_tumor": "meningioma",
            "notumor": "sin_tumor", "no_tumor": "sin_tumor", "pituitary": "pituitario", "pituitary_tumor": "pituitario"}
    for nombre, split in (("testing", "test"), ("training", "train")):  # Testing primero: gana si hay duplicados
        for sd in _dirs(raiz, nombre):
            for cd in sorted(p for p in sd.iterdir() if p.is_dir()):
                tipo = mapa.get(cd.name.lower())
                if tipo:
                    for p in _imagenes(cd):
                        yield Muestra(p, tipo, "mri", split=split, notas=f"{nombre}/{cd.name.lower()}")


# ------------------------------------------------------------------ manifiesto CSV genérico
def manifest(raiz: Path, archivo_csv: Path) -> Iterator[Muestra]:
    """Columnas: ruta,tipo  [+ modalidad (mri|tc, por defecto mri), secuencia, malignidad, grado, grado_oms, histologia,
    idh, mgmt, grupo_ref, split, fecha, corte, progresion].  `ruta` es relativa a --root y puede ser una imagen,
    .dcm, .nii/.nii.gz o .zip (serie DICOM). grado acepta bajo/alto/LGG/HGG; grado_oms acepta I-IV o 1-4."""
    with archivo_csv.open(encoding="utf-8-sig", newline="") as f:
        for n, r in enumerate(csv.DictReader(f), start=2):
            vacio = lambda k: (r.get(k) or "").strip() or None  # noqa: E731
            ruta = raiz / r["ruta"].strip()
            if not ruta.exists():
                raise SystemExit(f"Manifiesto línea {n}: no existe {ruta}")
            prog = vacio("progresion")
            molecular = {k: vacio(k) for k in ("idh", "mgmt") if vacio(k)}
            g, go = vacio("grado"), vacio("grado_oms")
            yield Muestra(ruta, r["tipo"].strip(), vacio("modalidad") or "mri", secuencia=vacio("secuencia"),
                          malignidad=vacio("malignidad"),
                          grado=tx.normalizar_grado(g) if g else None,
                          grado_oms=tx.normalizar_grado_oms(go) if go else None,
                          histologia=vacio("histologia"), molecular=molecular, grupo_ref=vacio("grupo_ref"),
                          split=vacio("split"), fecha=vacio("fecha"),
                          corte=int(r["corte"]) if vacio("corte") else None,
                          progresion=None if prog is None else prog.lower() in ("1", "true", "si", "sí"),
                          notas=f"manifest:{archivo_csv.name}")


ADAPTADORES = {"brain_kaggle": brain_kaggle}
