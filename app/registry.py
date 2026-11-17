"""Carga el modelo ACTIVO de cada modalidad (mri / tc) (según modelo_versiones en Neon) desde el bucket y lo mantiene en memoria.

El disco de Render es efímero: los pesos se bajan del bucket al arrancar / al cambiar de versión.
Solo se mantienen unos pocos modelos en memoria (MAX_EN_MEMORIA) para no agotar la RAM.
"""
import json
import logging
import threading
import time
from collections import OrderedDict

import torch
from xgboost import XGBClassifier

from . import db, storage
from .config import settings
from .model import DreamurNet, Predictor, XGBHead

log = logging.getLogger("dreamur.registry")
_lock = threading.Lock()
_cache: "OrderedDict[str, tuple[Predictor, float]]" = OrderedDict()
_prog = {"modelo": None, "id": None, "t": 0.0}
REVISAR_CADA = 60
MAX_EN_MEMORIA = 3


class ModeloNoDisponible(Exception):
    pass


def _cargar(row: dict) -> Predictor:
    ckpt = torch.load(storage.cached_path(row["pesos_red_key"]), map_location="cpu", weights_only=True)
    heads = ckpt["heads"]
    net = DreamurNet({h: len(c) for h, c in heads.items()}, backbone=ckpt.get("backbone", "resnet18"), pretrained=False)
    net.load_state_dict(ckpt["state_dict"])
    net.eval()
    xgb = {}
    for h, key in (row.get("pesos_xgb") or {}).items():
        meta = ckpt.get("xgb_meta", {}).get(h)
        if meta is None:
            continue
        m = XGBClassifier()
        m.load_model(str(storage.cached_path(key)))
        xgb[h] = XGBHead(m, meta["present"], len(heads[h]), meta["w"])
    log.info("Modelo %s v%s cargado", row["modalidad"], row["version"])
    return Predictor(net, heads, xgb, row["modalidad"], row["id"], row["version"])


def obtener(modalidad: str) -> Predictor:
    with _lock:
        hit = _cache.get(modalidad)
        if hit and time.time() - hit[1] < REVISAR_CADA:
            _cache.move_to_end(modalidad)
            return hit[0]
        with db.cursor() as cur:
            cur.execute("SELECT * FROM modelo_versiones WHERE modalidad=%s AND activo", (modalidad,))
            row = cur.fetchone()
        if row is None:
            raise ModeloNoDisponible(f"No hay un modelo activo para '{modalidad}'. Entrena uno primero.")
        if hit and hit[0].version_id == row["id"]:
            _cache[modalidad] = (hit[0], time.time())
            return hit[0]
        pred = _cargar(row)
        _cache[modalidad] = (pred, time.time())
        _cache.move_to_end(modalidad)
        while len(_cache) > MAX_EN_MEMORIA:
            _cache.popitem(last=False)
        return pred


def modelos_activos() -> list[dict]:
    with db.cursor() as cur:
        cur.execute("SELECT modalidad, version, heads, n_muestras, metricas->'referencia' AS referencia "
                    "FROM modelo_versiones WHERE activo ORDER BY modalidad")
        return cur.fetchall()


def invalidar(modalidad: str) -> None:
    with _lock:
        _cache.pop(modalidad, None)


def obtener_progresion():
    """Modelo de progresión activo (o None si aún no hay seguimientos etiquetados para entrenarlo)."""
    with _lock:
        if _prog["modelo"] is not None and time.time() - _prog["t"] < REVISAR_CADA:
            return _prog["modelo"], _prog["columnas"]
        with db.cursor() as cur:
            cur.execute("SELECT id, pesos_key, columnas FROM modelo_progresion WHERE activo")
            row = cur.fetchone()
        if row is None:
            _prog.update(modelo=None, id=None, t=time.time(), columnas=None)
            return None, None
        if _prog["id"] != row["id"]:
            m = XGBClassifier()
            m.load_model(str(storage.cached_path(row["pesos_key"])))
            _prog.update(modelo=m, id=row["id"], columnas=row["columnas"])
        _prog["t"] = time.time()
        return _prog["modelo"], _prog["columnas"]
