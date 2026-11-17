"""Lectura de estudios médicos: JPG/PNG/WEBP/BMP/TIFF, DICOM (.dcm), NIfTI (.nii/.nii.gz) y ZIP de una serie DICOM.

Todo se convierte a imágenes PIL RGB de cortes 2D (el modelo trabaja con cortes). De un volumen se eligen hasta
`max_cortes` cortes repartidos por la zona central. Se leen solo los píxeles y 2 datos técnicos del DICOM
(fecha de estudio y modalidad): el resto de la cabecera (nombre, documento, etc.) se descarta y nunca se guarda.
"""
import gzip
import io
import zipfile
from datetime import date
from pathlib import PurePosixPath

import numpy as np
from PIL import Image, UnidentifiedImageError

MAX_CORTES = 12
MAX_ZIP_ARCHIVOS = 2500
MAX_BYTES_DESCOMPRIMIDO = 600 * 1024 * 1024

EXT_IMAGEN = (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp")
FORMATOS = ("imagen", "dicom", "nifti", "zip")


class ArchivoNoSoportado(ValueError):
    pass


def detectar_formato(nombre: str | None, data: bytes) -> str:
    n = (nombre or "").lower()
    if n.endswith((".nii.gz", ".nii")):
        return "nifti"
    if n.endswith(".zip"):
        return "zip"
    if n.endswith((".dcm", ".dicom")):
        return "dicom"
    if n.endswith(EXT_IMAGEN):
        return "imagen"
    if data[128:132] == b"DICM":
        return "dicom"
    if data[:2] == b"PK":
        return "zip"
    if data[:2] == b"\x1f\x8b":
        return "nifti"
    return "imagen"


# ---------------------------------------------------------------- utilidades de intensidad
def _a_u8(arr: np.ndarray, lo: float | None = None, hi: float | None = None, invertir: bool = False) -> np.ndarray:
    arr = np.asarray(arr, dtype=np.float32)
    if lo is None or hi is None or hi <= lo:
        lo, hi = np.percentile(arr, (1, 99))
        if hi <= lo:
            lo, hi = float(arr.min()), float(arr.max())
    if hi <= lo:
        return np.zeros(arr.shape, dtype=np.uint8)
    out = np.clip((arr - lo) / (hi - lo), 0, 1)
    if invertir:
        out = 1 - out
    return (out * 255).astype(np.uint8)


def _gris_pil(u8: np.ndarray) -> Image.Image:
    return Image.fromarray(u8, mode="L").convert("RGB")


def _indices(n: int, k: int, desde: float = 0.1, hasta: float = 0.9) -> list[int]:
    """k índices repartidos en la zona central [desde, hasta] de n cortes."""
    if n <= k:
        return list(range(n))
    a = int(n * desde)
    b = max(int(n * hasta) - 1, a)
    if k == 1:
        return [(a + b) // 2]
    return sorted(set(np.linspace(a, b, k).round().astype(int).tolist()))


# ---------------------------------------------------------------- imagen normal
def _cargar_imagen(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ArchivoNoSoportado("El archivo no es una imagen válida")
    if img.mode in ("I;16", "I;16B", "I;16L", "I", "F"):
        return _gris_pil(_a_u8(np.asarray(img)))
    return img.convert("RGB")


# ---------------------------------------------------------------- DICOM
def _pydicom():
    try:
        import pydicom
    except ImportError:
        raise ArchivoNoSoportado("Este servidor no tiene instalado pydicom (necesario para leer DICOM)")
    return pydicom


def _primero(v):
    if v is None:
        return None
    try:
        if hasattr(v, "__iter__") and not isinstance(v, (str, bytes)):
            v = list(v)[0]
        return float(v)
    except Exception:
        return None


def _frames_dicom(ds) -> list[Image.Image]:
    try:
        arr = ds.pixel_array
    except Exception as e:  # sin PixelData, compresión sin decodificador, etc.
        raise ArchivoNoSoportado(f"No se pudo leer la imagen DICOM ({type(e).__name__}). "
                                 "Si está comprimida, instala pylibjpeg/gdcm en el servidor.")
    if int(getattr(ds, "SamplesPerPixel", 1)) == 3:
        frames = arr if arr.ndim == 4 else arr[None]
        return [Image.fromarray(_a_u8(f, 0, 255 if f.dtype == np.uint8 else None)) for f in frames]
    frames = arr if arr.ndim == 3 else arr[None]
    slope = float(getattr(ds, "RescaleSlope", 1) or 1)
    inter = float(getattr(ds, "RescaleIntercept", 0) or 0)
    wc, ww = _primero(getattr(ds, "WindowCenter", None)), _primero(getattr(ds, "WindowWidth", None))
    lo = hi = None
    if wc is not None and ww and ww > 1:
        lo, hi = wc - ww / 2, wc + ww / 2
    invertir = getattr(ds, "PhotometricInterpretation", "") == "MONOCHROME1"
    return [_gris_pil(_a_u8(f.astype(np.float32) * slope + inter, lo, hi, invertir)) for f in frames]


def _meta_dicom(ds) -> dict:
    meta = {}
    fecha = str(getattr(ds, "StudyDate", "") or "")
    if len(fecha) == 8 and fecha.isdigit():
        try:
            meta["fecha_estudio"] = date(int(fecha[:4]), int(fecha[4:6]), int(fecha[6:])).isoformat()
        except ValueError:
            pass
    if getattr(ds, "Modality", None):
        meta["modalidad_dicom"] = str(ds.Modality)
    return meta


def _dicom_archivo(data: bytes, max_cortes: int, indice):
    pd = _pydicom()
    try:
        ds = pd.dcmread(io.BytesIO(data), force=True)
    except Exception:
        raise ArchivoNoSoportado("El archivo DICOM está dañado")
    frames = _frames_dicom(ds)
    idx = [indice] if indice is not None and 0 <= indice < len(frames) else _indices(len(frames), max_cortes)
    return [frames[i] for i in idx], {"n_cortes_total": len(frames), "indices": idx, **_meta_dicom(ds)}


# ---------------------------------------------------------------- ZIP (serie DICOM / imágenes / NIfTI)
def _zip_archivo(data: bytes, max_cortes: int, indice):
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ArchivoNoSoportado("El ZIP está dañado")
    infos = [i for i in zf.infolist()
             if not i.is_dir() and not PurePosixPath(i.filename).name.startswith((".", "__"))]
    if not infos:
        raise ArchivoNoSoportado("El ZIP está vacío")
    if len(infos) > MAX_ZIP_ARCHIVOS or sum(i.file_size for i in infos) > MAX_BYTES_DESCOMPRIMIDO:
        raise ArchivoNoSoportado("El ZIP es demasiado grande")

    nifti = [i for i in infos if i.filename.lower().endswith((".nii", ".nii.gz"))]
    if nifti:
        return _nifti_archivo(zf.read(nifti[0]), nifti[0].filename, max_cortes, indice)
    imgs = sorted((i for i in infos if i.filename.lower().endswith(EXT_IMAGEN)), key=lambda i: i.filename)
    if imgs:
        idx = [indice] if indice is not None and 0 <= indice < len(imgs) else _indices(len(imgs), max_cortes)
        return ([_cargar_imagen(zf.read(imgs[i])) for i in idx],
                {"n_cortes_total": len(imgs), "indices": idx})

    pd = _pydicom()
    cabeceras = []
    for i in infos:
        try:
            ds = pd.dcmread(io.BytesIO(zf.read(i)), stop_before_pixels=True, force=True)
        except Exception:
            continue
        if not hasattr(ds, "Rows") or not hasattr(ds, "SOPInstanceUID"):
            continue
        pos = getattr(ds, "ImagePositionPatient", None)
        orden = float(pos[2]) if pos is not None and len(pos) >= 3 else float(getattr(ds, "InstanceNumber", 0) or 0)
        cabeceras.append((str(getattr(ds, "SeriesInstanceUID", "")), orden, i))
    if not cabeceras:
        raise ArchivoNoSoportado("El ZIP no contiene imágenes, NIfTI ni DICOM legibles")
    series: dict[str, list] = {}
    for uid, orden, info in cabeceras:
        series.setdefault(uid, []).append((orden, info))
    serie = sorted(max(series.values(), key=len), key=lambda t: t[0])  # la serie más larga, ordenada
    idx = [indice] if indice is not None and 0 <= indice < len(serie) else _indices(len(serie), max_cortes)
    cortes, meta = [], {}
    for k in idx:
        ds = pd.dcmread(io.BytesIO(zf.read(serie[k][1])), force=True)
        fr = _frames_dicom(ds)
        cortes.append(fr[len(fr) // 2])
        if not meta:
            meta = _meta_dicom(ds)
    return cortes, {"n_cortes_total": len(serie), "indices": idx, **meta}


# ---------------------------------------------------------------- NIfTI
def nifti_a_array(img) -> np.ndarray:
    """Imagen nibabel -> array (X,Y,Z) en orientación canónica (RAS+). Si es 4D toma el primer volumen."""
    import nibabel as nib
    arr = np.asarray(nib.as_closest_canonical(img).dataobj, dtype=np.float32)
    return arr[..., 0] if arr.ndim == 4 else arr


def corte_nifti(arr: np.ndarray, k: int, lo: float | None = None, hi: float | None = None) -> Image.Image:
    return _gris_pil(_a_u8(np.rot90(arr[:, :, k]), lo, hi))


def _nifti_archivo(data: bytes, nombre: str, max_cortes: int, indice):
    try:
        import nibabel as nib
    except ImportError:
        raise ArchivoNoSoportado("Este servidor no tiene instalado nibabel (necesario para leer NIfTI)")
    try:
        if data[:2] == b"\x1f\x8b":
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as g:
                data = g.read(MAX_BYTES_DESCOMPRIMIDO + 1)
            if len(data) > MAX_BYTES_DESCOMPRIMIDO:
                raise ArchivoNoSoportado("El volumen NIfTI es demasiado grande")
        try:
            img = nib.Nifti1Image.from_bytes(data)
        except Exception:
            img = nib.Nifti2Image.from_bytes(data)
        arr = nifti_a_array(img)
    except ArchivoNoSoportado:
        raise
    except Exception:
        raise ArchivoNoSoportado("No se pudo leer el volumen NIfTI")
    if arr.ndim != 3:
        raise ArchivoNoSoportado("El NIfTI debe ser un volumen 3D")
    lo, hi = np.percentile(arr, (1, 99.5))
    n = arr.shape[2]
    if indice is not None and 0 <= indice < n:
        idx = [indice]
    else:
        contenido = arr.reshape(-1, n).std(axis=0)
        validos = np.where(contenido > 0.15 * contenido.max())[0] if contenido.max() > 0 else np.arange(n)
        idx = [int(validos[i]) for i in _indices(len(validos), max_cortes, 0.0, 1.0)]
    return [corte_nifti(arr, k, lo, hi) for k in idx], {"n_cortes_total": n, "indices": idx}


# ---------------------------------------------------------------- API pública
def cargar_cortes(data: bytes, nombre: str = "", max_cortes: int = MAX_CORTES, indice: int | None = None):
    """Devuelve (lista de imágenes PIL RGB, meta). `indice` fuerza un corte concreto (volúmenes)."""
    formato = detectar_formato(nombre, data)
    if formato == "imagen":
        return [_cargar_imagen(data)], {"formato": "imagen", "n_cortes_total": 1, "indices": [0]}
    if formato == "dicom":
        cortes, meta = _dicom_archivo(data, max_cortes, indice)
    elif formato == "zip":
        cortes, meta = _zip_archivo(data, max_cortes, indice)
    else:
        cortes, meta = _nifti_archivo(data, nombre, max_cortes, indice)
    if not cortes:
        raise ArchivoNoSoportado("No se pudo extraer ningún corte del archivo")
    meta["formato"] = formato
    return cortes, meta


def una_imagen(data: bytes, nombre: str = "", indice: int | None = None) -> Image.Image:
    """Un solo corte (para entrenar): el indicado, o el central."""
    return cargar_cortes(data, nombre, max_cortes=1, indice=indice)[0][0]
