"""Modelo de Dreamur-Detector v2 (PyTorch).

  imagen -> CNN (ResNet preentrenada) -> embedding -> cuello MLP (red neuronal) -> varias cabezas:
            tipo / malignidad / grado / grado_oms
  XGBoost (sobre el mismo embedding) refuerza las cabezas 'tipo' y 'malignidad'; la mezcla se elige en validación.
  Grad-CAM sobre la última capa convolucional -> mapa de calor -> zonas.
Un estudio con varios cortes (TC/MRI) se resume con los cortes más sospechosos.
"""
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models, transforms

from . import taxonomy as tx

IMG = 224
_MEAN, _STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]

# Resize directo (sin recortar) para que las cajas normalizadas (0-1) coincidan con la imagen original.
TF_EVAL = transforms.Compose([transforms.Resize((IMG, IMG)), transforms.ToTensor(), transforms.Normalize(_MEAN, _STD)])
TF_TRAIN = transforms.Compose([
    transforms.Resize((IMG, IMG)),
    transforms.RandomHorizontalFlip(),
    transforms.RandomAffine(degrees=10, translate=(0.05, 0.05), scale=(0.92, 1.08)),
    transforms.ColorJitter(brightness=0.15, contrast=0.15),
    transforms.ToTensor(),
    transforms.Normalize(_MEAN, _STD),
])

_BACKBONES = {
    "resnet18": (models.resnet18, models.ResNet18_Weights, 512),
    "resnet50": (models.resnet50, models.ResNet50_Weights, 2048),
}
TOP_K_CORTES = 3


class DreamurNet(nn.Module):
    def __init__(self, heads: dict, backbone: str = "resnet18", pretrained: bool = True):
        """heads: {nombre_cabeza: n_clases}"""
        super().__init__()
        fn, weights, dim = _BACKBONES[backbone]
        r = fn(weights=weights.DEFAULT if pretrained else None)
        self.backbone = nn.Sequential(r.conv1, r.bn1, r.relu, r.maxpool, r.layer1, r.layer2, r.layer3, r.layer4)
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.neck = nn.Sequential(nn.Linear(dim, 256), nn.ReLU(inplace=True), nn.Dropout(0.3))
        self.heads = nn.ModuleDict({k: nn.Linear(256, n) for k, n in heads.items()})
        self.dim = dim

    def features_map(self, x):
        return self.backbone(x)

    def embed(self, x):
        return self.pool(self.features_map(x)).flatten(1)

    def logits_from_embed(self, emb):
        z = self.neck(emb)
        return {k: h(z) for k, h in self.heads.items()}

    def forward(self, x):
        return self.logits_from_embed(self.embed(x))


def gradcam(net: DreamurNet, x: torch.Tensor, head: str, idx: int) -> np.ndarray:
    """Mapa de calor [0,1] IMGxIMG para la clase `idx` de la cabeza `head`. x: 1x3xHxW."""
    net.eval()
    with torch.enable_grad():
        x = x.clone().requires_grad_(True)
        fm = net.features_map(x)
        fm.retain_grad()
        logits = net.logits_from_embed(net.pool(fm).flatten(1))[head]
        net.zero_grad(set_to_none=True)
        logits[0, idx].backward()
        w = fm.grad.mean(dim=(2, 3), keepdim=True)
        cam = torch.relu((w * fm).sum(dim=1, keepdim=True))
        cam = F.interpolate(cam, size=x.shape[-2:], mode="bilinear", align_corners=False)[0, 0]
        cam = cam - cam.min()
        m = cam.max()
        cam = cam / m if m > 0 else cam
    return cam.detach().cpu().numpy()


class XGBHead:
    """XGBoost de una cabeza. Las clases ausentes en el entrenamiento se reubican en su columna original."""

    def __init__(self, model, present: list, n_clases: int, w: float):
        self.model, self.present, self.n, self.w = model, list(present), n_clases, float(w)

    def predict_proba(self, emb: np.ndarray) -> np.ndarray:
        p = self.model.predict_proba(emb)
        out = np.zeros((len(emb), self.n), dtype=np.float32)
        out[:, self.present] = p
        return out


class Predictor:
    """Modelo cargado en memoria: red + XGBoost + clases de cada cabeza."""

    def __init__(self, net, heads: dict, xgb: dict, modalidad: str, version_id: int, version: int):
        self.net, self.heads, self.xgb = net, heads, xgb  # heads: {nombre: [clases]}
        self.modalidad, self.version_id, self.version = modalidad, version_id, version

    def _probs(self, x: torch.Tensor) -> dict:
        with torch.no_grad():
            emb = self.net.embed(x)
            logits = self.net.logits_from_embed(emb)
        probs = {h: torch.softmax(l, 1).numpy() for h, l in logits.items()}
        for h, xg in self.xgb.items():
            if h in probs and xg.w > 0:
                probs[h] = (1 - xg.w) * probs[h] + xg.w * xg.predict_proba(emb.numpy())
        return probs

    def _salida(self, h: str, p: np.ndarray) -> dict:
        i = int(np.argmax(p))
        cls = self.heads[h]
        return {"clase": cls[i], "confianza": float(min(1.0, max(0.0, p[i]))),
                "probabilidades": {c: float(v) for c, v in zip(cls, p)}}

    def predecir(self, imgs: list) -> dict:
        """imgs: lista de cortes PIL (1 para una imagen suelta, varios para un volumen)."""
        x = torch.stack([TF_EVAL(i.convert("RGB")) for i in imgs])
        probs = self._probs(x)
        tipos = self.heads["tipo"]
        pt = probs["tipo"]
        # Qué tan sospechoso es cada corte: 1 - P(sin tumor)  (si no hay clase 'sin_tumor': la prob. máxima)
        score = 1 - pt[:, tipos.index(tx.SIN_TUMOR)] if tx.SIN_TUMOR in tipos else pt.max(1)
        orden = np.argsort(-score)
        top = orden[:TOP_K_CORTES]
        rep = int(orden[0])
        agg = {h: p[top].mean(0) for h, p in probs.items()}

        tipo = self._salida("tipo", agg["tipo"])
        tumor = tx.es_tumor(tipo["clase"])
        out = {"tipo": tipo, "malignidad": None, "prob_maligno": None, "grado": None, "grado_oms": None,
               "corte_representativo": rep, "n_cortes": len(imgs)}

        # --- malignidad ---
        if not tumor:
            m = {"clase": tx.MALIGNIDAD_POR_TIPO.get(tipo["clase"], "no_tumoral"), "confianza": tipo["confianza"],
                 "probabilidades": None, "fuente": "conocimiento_general"}
            out["malignidad"], out["prob_maligno"] = m, 0.0
        elif "malignidad" in agg:
            m = self._salida("malignidad", agg["malignidad"])
            m["fuente"] = "modelo"
            out["malignidad"], out["prob_maligno"] = m, float(m["probabilidades"].get("maligno", 0.0))
        elif tipo["clase"] in tx.MALIGNIDAD_POR_TIPO:
            m = {"clase": tx.MALIGNIDAD_POR_TIPO[tipo["clase"]], "confianza": tipo["confianza"],
                 "probabilidades": None, "fuente": "conocimiento_general"}
            out["malignidad"] = m
        # prob. de malignidad si no hay cabeza: suma de las probabilidades de tipos malignos conocidos
        if out["prob_maligno"] is None and all(c in tx.MALIGNIDAD_POR_TIPO for c in tipos):
            out["prob_maligno"] = float(sum(v for c, v in tipo["probabilidades"].items()
                                            if tx.MALIGNIDAD_POR_TIPO[c] == "maligno"))
        # --- grado (solo si hay tumor y el modelo aprendió esa cabeza) ---
        for h in tx.HEADS_GRADO:
            if tumor and h in agg:
                out[h] = self._salida(h, agg[h])

        out["cam"] = gradcam(self.net, x[rep:rep + 1], "tipo", tipos.index(tipo["clase"]))
        out["probabilidades_por_cabeza"] = {h: {c: float(v) for c, v in zip(self.heads[h], agg[h])} for h in agg}
        return out
