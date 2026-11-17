"""Entrenamiento de Dreamur-Detector (tumores cerebrales; un modelo por MODALIDAD: mri / tc).

Lee de Neon las muestras entrenables de la modalidad (v_muestras_entrenables: datasets + casos de pacientes con
consentimiento y diagnóstico confirmado), baja las imágenes del bucket y entrena:
   1) CNN ResNet + cuello MLP con varias cabezas (tipo, malignidad, grado, grado_oms). Las etiquetas que el dataset
      no trae valen -1 y esa cabeza no aprende de esa imagen (pérdida enmascarada).
   2) XGBoost sobre los embeddings para 'tipo' y 'malignidad'.
   3) elige el peso de la mezcla red/XGBoost en validación.
Los pesos van al bucket y se crea una fila en modelo_versiones.

División sin fuga de datos: se separa por paciente/caso (grupo_ref). Las muestras con split_origen='test'
(p. ej. la carpeta Testing de Kaggle) forman el conjunto de PRUEBA; si no hay, se aparta ~10% por grupos.
"""
import copy
import logging
import os
import tempfile
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import psycopg
import torch
import torch.nn as nn
from psycopg.types.json import Jsonb
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score, log_loss,
                             precision_recall_fscore_support, roc_auc_score)
from sklearn.model_selection import StratifiedGroupKFold, train_test_split
from torch.utils.data import DataLoader, Dataset
from xgboost import XGBClassifier

from . import db, readers, storage
from . import taxonomy as tx
from .config import settings
from .model import IMG, TF_EVAL, TF_TRAIN, DreamurNet, XGBHead

log = logging.getLogger("dreamur.train")
MIN_POR_CLASE = 5          # imágenes mínimas por tipo para entrenar
MIN_ETIQ_CABEZA = 30       # etiquetas mínimas para que malignidad/grado/grado_oms tengan cabeza propia
HEADS_XGB = ("tipo", "malignidad")


class EntrenamientoEnCurso(Exception):
    pass


class _DS(Dataset):
    def __init__(self, items, tf):
        self.items, self.tf = items, tf  # items: (ruta, corte_clave, [y por cabeza])

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        ruta, corte, y = self.items[i]
        img = readers.una_imagen(Path(ruta).read_bytes(), Path(ruta).name, corte)
        return self.tf(img), torch.tensor(y, dtype=torch.long)


def _loader(items, tf, batch_size, shuffle):
    return DataLoader(_DS(items, tf), batch_size=batch_size, shuffle=shuffle, num_workers=0 if os.name == "nt" else 2)


def _pasada(net, loader, heads, device):
    """Devuelve (probs por cabeza, embeddings, y[N, n_cabezas])."""
    net.eval()
    ps = {h: [] for h in heads}
    es, ys = [], []
    with torch.no_grad():
        for x, y in loader:
            emb = net.embed(x.to(device))
            for h, l in net.logits_from_embed(emb).items():
                ps[h].append(torch.softmax(l, 1).cpu().numpy())
            es.append(emb.cpu().numpy())
            ys.append(y.numpy())
    return {h: np.concatenate(v) for h, v in ps.items()}, np.concatenate(es), np.concatenate(ys)


def _metricas(y, proba, clases):
    n = len(clases)
    pred = proba.argmax(1)
    p, r, f, _ = precision_recall_fscore_support(y, pred, labels=list(range(n)), zero_division=0)
    m = {
        "accuracy": float(accuracy_score(y, pred)),
        "f1_macro": float(f1_score(y, pred, average="macro", labels=list(range(n)), zero_division=0)),
        "log_loss": float(log_loss(y, proba, labels=list(range(n)))),
        "confusion": confusion_matrix(y, pred, labels=list(range(n))).tolist(),
        "por_clase": {clases[i]: {"precision": float(p[i]), "recall": float(r[i]), "f1": float(f[i])} for i in range(n)},
        "n": int(len(y)),
    }
    if "maligno" in clases:  # AUC maligno vs resto: la métrica clave para "¿es maligno?"
        k = clases.index("maligno")
        if 0 < (y == k).sum() < len(y):
            m["auc_maligno"] = float(roc_auc_score(y == k, proba[:, k]))
    return m


def _metricas_cabezas(probs, y, heads, orden):
    """orden: lista de TODAS las cabezas, en el orden de las columnas de y."""
    out = {}
    for h in heads:
        j = orden.index(h)
        mk = y[:, j] >= 0
        if mk.any():
            out[h] = _metricas(y[mk, j], probs[h][mk], heads[h])
    return out


def _pesos_clase(y, n):
    c = np.bincount(y, minlength=n)
    k = max(int((c > 0).sum()), 1)
    return np.where(c > 0, len(y) / (k * np.maximum(c, 1)), 0.0).astype(np.float32)


def _f1_medio(probs, y, heads):
    fs = []
    for j, h in enumerate(heads):
        mk = y[:, j] >= 0
        if mk.sum() >= 2:
            fs.append(f1_score(y[mk, j], probs[h][mk].argmax(1), average="macro", labels=list(range(len(heads[h]))), zero_division=0))
    return float(np.mean(fs)) if fs else 0.0


def _entrenar_red(net, ltr, lva, ytr, heads, epochs, device, progress):
    names = list(heads)
    crit = {h: nn.CrossEntropyLoss(weight=torch.tensor(_pesos_clase(ytr[ytr[:, j] >= 0, j], len(heads[h])), device=device),
                                   label_smoothing=0.05)
            for j, h in enumerate(names) if (ytr[:, j] >= 0).any()}
    opt = torch.optim.AdamW([{"params": net.backbone.parameters(), "lr": 1e-4},
                             {"params": list(net.neck.parameters()) + list(net.heads.parameters()), "lr": 1e-3}],
                            weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    mejor, estado, sin_mejora = -1.0, None, 0
    for ep in range(1, epochs + 1):
        net.train()
        perdida, n = 0.0, 0
        for x, y in ltr:
            x, y = x.to(device), y.to(device)
            logits = net(x)
            loss, usadas = 0.0, 0
            for j, h in enumerate(names):
                mk = y[:, j] >= 0
                if h in crit and mk.any():
                    loss = loss + crit[h](logits[h][mk], y[mk, j])
                    usadas += 1
            if usadas == 0:
                continue
            opt.zero_grad()
            loss.backward()
            opt.step()
            perdida += float(loss) * len(y)
            n += len(y)
        sched.step()
        pv, _, yv = _pasada(net, lva, heads, device)
        f1 = _f1_medio(pv, yv, heads)
        progress(f"  época {ep}/{epochs}  loss={perdida / max(n, 1):.4f}  val_f1_medio={f1:.4f}")
        if f1 > mejor:
            mejor, estado, sin_mejora = f1, copy.deepcopy(net.state_dict()), 0
        else:
            sin_mejora += 1
            if sin_mejora >= 3:
                progress("  sin mejora en 3 épocas: parada temprana")
                break
    net.load_state_dict(estado)
    return net


def _dividir_grupos(idx, y, grupos, n_splits, seed=42):
    """(entrenamiento, apartado) por grupos y estratificado por tipo; con respaldo si hay pocos grupos."""
    idx = np.asarray(idx)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            tr, ap = next(iter(StratifiedGroupKFold(n_splits, shuffle=True, random_state=seed).split(idx, y[idx], grupos[idx])))
        return idx[tr], idx[ap]
    except ValueError:
        tr, ap = train_test_split(idx, test_size=1 / n_splits, stratify=y[idx], random_state=seed)
        return tr, ap


def _abrir_entrenamiento(modalidad, disparado_por) -> int:
    with db.cursor() as cur:
        cur.execute("UPDATE entrenamientos SET estado='error', error='abandonado (sin finalizar tras 6 h)', "
                    "finalizado_en=now() WHERE modalidad=%s AND estado='en_curso' AND iniciado_en < now() - interval '6 hours'",
                    (modalidad,))
        try:
            cur.execute("INSERT INTO entrenamientos (modalidad, disparado_por) VALUES (%s,%s) RETURNING id", (modalidad, disparado_por))
        except psycopg.errors.UniqueViolation:
            raise EntrenamientoEnCurso(f"Ya hay un entrenamiento en curso para '{modalidad}'")
        return cur.fetchone()["id"]


def en_curso(modalidad) -> bool:
    with db.cursor() as cur:
        cur.execute("SELECT 1 FROM entrenamientos WHERE modalidad=%s AND estado='en_curso'", (modalidad,))
        return cur.fetchone() is not None


def estado_reciente(modalidad, n=5):
    with db.cursor() as cur:
        cur.execute("SELECT id, estado, n_muestras, modelo_version_id, error, iniciado_en, finalizado_en "
                    "FROM entrenamientos WHERE modalidad=%s ORDER BY id DESC LIMIT %s", (modalidad, n))
        return cur.fetchall()


def train(modalidad, epochs=8, batch_size=32, disparado_por="manual", activar="auto", progress=print):
    """activar: 'auto' (si no es peor que el activo), 'si' o 'no'. Devuelve un resumen de la versión creada."""
    tx.validar_modalidad(modalidad)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    progress(f"Modalidad: {modalidad} · dispositivo: {device}")
    ent_id = _abrir_entrenamiento(modalidad, disparado_por)
    try:
        return _train(modalidad, epochs, batch_size, activar, ent_id, device, progress)
    except Exception as e:
        log.exception("Entrenamiento fallido")
        with db.cursor() as cur:
            cur.execute("UPDATE entrenamientos SET estado='error', error=%s, finalizado_en=now() WHERE id=%s", (str(e)[:1000], ent_id))
        raise


def _train(modalidad, epochs, batch_size, activar, ent_id, device, progress):
    with db.cursor() as cur:
        cur.execute("SELECT * FROM v_muestras_entrenables WHERE modalidad=%s", (modalidad,))
        rows = cur.fetchall()
    if not rows:
        raise ValueError(f"No hay muestras etiquetadas para '{modalidad}'. Ejecuta primero scripts/ingest.py")

    tipos = sorted({r["tipo_tumor"] for r in rows})
    if len(tipos) < 2:
        raise ValueError(f"Se necesitan al menos 2 tipos distintos, hay: {tipos}")
    heads = {"tipo": tipos}
    cols = {"malignidad": tx.MALIGNIDAD, "grado": tx.GRADO, "grado_oms": tx.GRADO_OMS}
    for h, vocab in cols.items():
        vals = [r[h] for r in rows if r[h] is not None]
        if len(vals) >= MIN_ETIQ_CABEZA and len(set(vals)) >= 2:
            heads[h] = vocab
    names = list(heads)

    y = np.full((len(rows), len(names)), -1, dtype=np.int64)
    for i, r in enumerate(rows):
        for j, h in enumerate(names):
            v = r["tipo_tumor"] if h == "tipo" else r[h]
            if v is not None:
                y[i, j] = heads[h].index(v)
    ytipo = y[:, 0]
    grupos = np.array([r["grupo_ref"] or str(r["paciente_id"] or r["estudio_id"]) for r in rows])
    split = np.array([r["split_origen"] or "" for r in rows])
    resumen = {h: int((y[:, j] >= 0).sum()) for j, h in enumerate(names)}
    progress(f"{len(rows)} imágenes · cabezas y nº de etiquetas: {resumen} · tipos: {tipos}")

    idx_te = np.where(split == "test")[0]
    resto = np.where(split != "test")[0]
    if len(idx_te) == 0:
        resto, idx_te = _dividir_grupos(resto, ytipo, grupos, 10)
        progress("Sin carpeta 'test' en los datos: se apartó ~10% por grupos como prueba.")
    if (split[resto] == "val").any():
        idx_va, idx_tr = resto[split[resto] == "val"], resto[split[resto] != "val"]
    else:
        idx_tr, idx_va = _dividir_grupos(resto, ytipo, grupos, 7)
    for c, i in zip(tipos, range(len(tipos))):
        if (ytipo[idx_tr] == i).sum() < MIN_POR_CLASE:
            raise ValueError(f"El tipo '{c}' tiene menos de {MIN_POR_CLASE} imágenes de entrenamiento")
    progress(f"entrenamiento={len(idx_tr)} validación={len(idx_va)} prueba={len(idx_te)}")

    progress("Descargando imágenes del bucket (solo la primera vez)...")
    with ThreadPoolExecutor(8) as ex:
        rutas = list(ex.map(storage.cached_path, [r["storage_key"] for r in rows]))
    items = [(rutas[i], rows[i]["corte_clave"], y[i].tolist()) for i in range(len(rows))]
    sel = lambda ix: [items[i] for i in ix]  # noqa: E731
    ld = lambda ix, tf=TF_EVAL, sh=False: _loader(sel(ix), tf, batch_size, sh)  # noqa: E731

    net = DreamurNet({h: len(c) for h, c in heads.items()}, backbone=settings.backbone, pretrained=True).to(device)
    progress(f"Entrenando CNN ({settings.backbone}) + red neuronal multi-cabeza...")
    net = _entrenar_red(net, ld(idx_tr, TF_TRAIN, True), ld(idx_va), y[idx_tr], heads, epochs, device, progress)

    progress("Calculando embeddings y entrenando XGBoost...")
    p_tr, e_tr, _ = _pasada(net, ld(idx_tr), heads, device)
    p_va, e_va, y_va = _pasada(net, ld(idx_va), heads, device)
    p_te, e_te, y_te = _pasada(net, ld(idx_te), heads, device)

    xgbs, xmeta = {}, {}
    mezcla_va, mezcla_te, px_va, px_te = dict(p_va), dict(p_te), {}, {}
    for j, h in enumerate(names):
        if h not in HEADS_XGB:
            continue
        mt, mv = y[idx_tr, j] >= 0, y_va[:, j] >= 0
        present = sorted(set(y[idx_tr, j][mt].tolist()))
        if len(present) < 2 or mv.sum() < 2:
            continue
        remap = {c: k for k, c in enumerate(present)}
        yt = np.array([remap[c] for c in y[idx_tr, j][mt]])
        keep = np.array([c in remap for c in y_va[mv, j]])
        yv_x = np.array([remap[c] for c in y_va[mv, j][keep]])
        if len(yv_x) < 2:
            continue
        m = XGBClassifier(n_estimators=400, max_depth=4, learning_rate=0.05, subsample=0.8, colsample_bytree=0.5,
                          early_stopping_rounds=30, tree_method="hist", n_jobs=2)
        m.fit(e_tr[mt], yt, sample_weight=_pesos_clase(yt, len(present))[yt], eval_set=[(e_va[mv][keep], yv_x)], verbose=False)
        xg = XGBHead(m, present, len(heads[h]), 0.0)
        px_va[h], px_te[h] = xg.predict_proba(e_va), xg.predict_proba(e_te)

        def _mix(w, pn, px):
            z = (1 - w) * pn + w * px
            return z / np.maximum(z.sum(1, keepdims=True), 1e-9)
        vm = np.where(mv)[0][keep]
        w = min([0.0, 0.25, 0.5, 0.75, 1.0], key=lambda k: log_loss(
            y_va[vm, j], _mix(k, p_va[h][vm], px_va[h][vm]), labels=list(range(len(heads[h])))))
        xg.w = w
        xgbs[h], xmeta[h] = xg, {"present": present, "w": w}
        mezcla_va[h], mezcla_te[h] = _mix(w, p_va[h], px_va[h]), _mix(w, p_te[h], px_te[h])
        progress(f"  XGBoost en '{h}': peso en la mezcla = {w}")

    def _bloque(pn, mz, px, yy):
        r = {h: {"red": m} for h, m in _metricas_cabezas(pn, yy, heads, names).items()}
        for h, m in _metricas_cabezas(mz, yy, heads, names).items():
            r[h]["mezcla"] = m
        for h, m in _metricas_cabezas(px, yy, {k: heads[k] for k in px}, names).items():
            r[h]["xgb"] = m
        return r

    metricas = {"modalidad": modalidad, "backbone": settings.backbone, "heads": heads, "etiquetas_por_cabeza": resumen,
                "xgb": {h: m for h, m in xmeta.items()},
                "val": _bloque(p_va, mezcla_va, px_va, y_va), "test": _bloque(p_te, mezcla_te, px_te, y_te)}
    ref_f1 = metricas["test"]["tipo"]["mezcla"]["f1_macro"] if "tipo" in metricas["test"] else 0.0
    metricas["referencia"] = {"split": "test", "f1_macro": ref_f1}
    progress(f"PRUEBA · tipo: F1 macro={ref_f1:.4f} accuracy={metricas['test']['tipo']['mezcla']['accuracy']:.4f}")
    if "malignidad" in metricas["test"] and "auc_maligno" in metricas["test"]["malignidad"]["mezcla"]:
        progress(f"PRUEBA · malignidad: AUC maligno={metricas['test']['malignidad']['mezcla']['auc_maligno']:.4f}")

    with db.cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(version),0)+1 AS v FROM modelo_versiones WHERE modalidad=%s", (modalidad,))
        version = cur.fetchone()["v"]
    base = f"modelos/{modalidad}/v{version}"
    k_red = f"{base}/net.pt"
    k_xgb = {h: f"{base}/xgb_{h}.json" for h in xgbs}
    with tempfile.TemporaryDirectory() as tmp:
        net.cpu()
        torch.save({"state_dict": net.state_dict(), "heads": heads, "backbone": settings.backbone, "xgb_meta": xmeta,
                    "modalidad": modalidad, "img_size": IMG}, Path(tmp) / "net.pt")
        storage.upload_file(Path(tmp) / "net.pt", k_red)
        for h, xg in xgbs.items():
            xg.model.save_model(str(Path(tmp) / f"xgb_{h}.json"))
            storage.upload_file(Path(tmp) / f"xgb_{h}.json", k_xgb[h])

    with db.cursor() as cur:
        cur.execute("SELECT id, metricas FROM modelo_versiones WHERE modalidad=%s AND activo", (modalidad,))
        actual = cur.fetchone()
        if activar == "si" or actual is None:
            activo = True
        elif activar == "no":
            activo = False
        else:
            ref_old = (actual["metricas"] or {}).get("referencia") or {}
            activo = ref_old.get("split") != "test" or ref_f1 >= ref_old.get("f1_macro", 0) - 0.005
        if activo:
            cur.execute("UPDATE modelo_versiones SET activo=FALSE WHERE modalidad=%s AND activo", (modalidad,))
        cur.execute(
            "INSERT INTO modelo_versiones (modalidad, version, arquitectura, heads, pesos_red_key, pesos_xgb, n_muestras, "
            "metricas, activo) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (modalidad, version, f"{settings.backbone}+mlp+xgboost", Jsonb(heads), k_red, Jsonb(k_xgb), len(rows),
             Jsonb(metricas), activo))
        mv_id = cur.fetchone()["id"]
        cur.execute("UPDATE entrenamientos SET estado='completado', n_muestras=%s, modelo_version_id=%s, finalizado_en=now() WHERE id=%s",
                    (len(rows), mv_id, ent_id))
    progress(f"Modelo {modalidad} v{version} guardado ({'ACTIVO' if activo else 'inactivo: no mejoró al actual'}).")
    return {"id": mv_id, "version": version, "activo": activo, "metricas": metricas}
