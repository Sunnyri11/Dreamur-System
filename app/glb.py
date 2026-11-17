"""Exportador GLB (glTF 2.0 binario) mínimo y sin dependencias, con geometría cuantizada.

Usa la extensión KHR_mesh_quantization (soportada por three.js, Babylon, model-viewer):
  - posiciones: int16 normalizado (6 bytes en vez de 12) -> el modelo debe caber en [-1, 1]
  - normales:   int8 normalizado  (3 bytes en vez de 12)
  - índices:    uint16 (uint32 solo si hay más de 65 535 vértices)
Resultado: ~12 bytes por vértice + 6 por triángulo. El brillo del tumor usa KHR_materials_emissive_strength
(opcional: si un visor no la entiende, simplemente se ve con menos brillo).
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field

import numpy as np


@dataclass
class Malla:
    nombre: str
    vertices: np.ndarray            # (N,3) float, dentro de [-1,1], sistema interno (x der, y anterior, z arriba)
    caras: np.ndarray               # (M,3) enteros
    normales: np.ndarray            # (N,3) float, unitarias
    color: tuple[float, float, float, float]   # RGBA lineal
    metalico: float = 0.0
    rugosidad: float = 0.6
    emisivo: tuple[float, float, float] = (0.0, 0.0, 0.0)
    emisivo_fuerza: float = 1.0
    transparente: bool = False
    extras: dict = field(default_factory=dict)


def a_gltf(p: np.ndarray) -> np.ndarray:
    """(x der, y anterior, z arriba) -> glTF (X, Y arriba, Z frente). Es una rotación (sin espejo)."""
    return np.stack([-p[:, 0], p[:, 2], p[:, 1]], axis=1)


def construir_glb(mallas: list[Malla]) -> bytes:
    binario = bytearray()
    vistas, accesores, mallas_json, nodos, materiales = [], [], [], [], []
    extensiones = {"KHR_mesh_quantization"}

    def agregar_vista(datos: bytes, destino: int, stride: int | None = None) -> int:
        while len(binario) % 4:
            binario.append(0)
        vista = {"buffer": 0, "byteOffset": len(binario), "byteLength": len(datos), "target": destino}
        if stride:
            vista["byteStride"] = stride
        binario.extend(datos)
        vistas.append(vista)
        return len(vistas) - 1

    for i, m in enumerate(mallas):
        pos = a_gltf(np.asarray(m.vertices, np.float64))
        nor = a_gltf(np.asarray(m.normales, np.float64))
        if np.abs(pos).max() > 1.0 + 1e-6:
            raise ValueError(f"La malla '{m.nombre}' sale de [-1,1]; no cabe en int16 normalizado")
        n = len(pos)

        q_pos = np.zeros((n, 4), np.int16)
        q_pos[:, :3] = np.round(pos * 32767).astype(np.int16)
        q_nor = np.zeros((n, 4), np.int8)
        q_nor[:, :3] = np.round(nor * 127).astype(np.int8)

        usa32 = n > 65535
        indices = np.asarray(m.caras, np.uint32 if usa32 else np.uint16).reshape(-1)
        if indices.max() >= n:
            raise ValueError("Índice fuera de rango")

        v_pos = agregar_vista(q_pos.tobytes(), 34962, 8)
        v_nor = agregar_vista(q_nor.tobytes(), 34962, 4)
        v_idx = agregar_vista(indices.tobytes(), 34963)

        a_pos = len(accesores)
        accesores.append({"bufferView": v_pos, "componentType": 5122, "normalized": True, "count": n,
                          "type": "VEC3", "min": q_pos[:, :3].min(axis=0).tolist(),
                          "max": q_pos[:, :3].max(axis=0).tolist()})
        a_nor = len(accesores)
        accesores.append({"bufferView": v_nor, "componentType": 5120, "normalized": True, "count": n,
                          "type": "VEC3"})
        a_idx = len(accesores)
        accesores.append({"bufferView": v_idx, "componentType": 5125 if usa32 else 5123,
                          "count": int(indices.size), "type": "SCALAR"})

        material = {"name": m.nombre,
                    "pbrMetallicRoughness": {"baseColorFactor": [round(float(c), 4) for c in m.color],
                                             "metallicFactor": m.metalico, "roughnessFactor": m.rugosidad},
                    "doubleSided": False}
        if any(m.emisivo):
            material["emissiveFactor"] = [round(float(c), 4) for c in m.emisivo]
            if m.emisivo_fuerza != 1.0:
                material["extensions"] = {"KHR_materials_emissive_strength": {"emissiveStrength": m.emisivo_fuerza}}
                extensiones.add("KHR_materials_emissive_strength")
        if m.transparente:
            material["alphaMode"] = "BLEND"
        materiales.append(material)

        mallas_json.append({"name": m.nombre, "primitives": [{
            "attributes": {"POSITION": a_pos, "NORMAL": a_nor}, "indices": a_idx, "material": i, "mode": 4}]})
        nodo = {"name": m.nombre, "mesh": i}
        if m.extras:
            nodo["extras"] = m.extras
        nodos.append(nodo)

    gltf = {
        "asset": {"version": "2.0", "generator": "Dreamur-Generate_Model"},
        "extensionsUsed": sorted(extensiones),
        "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodos)))}],
        "nodes": nodos, "meshes": mallas_json, "materials": materiales,
        "accessors": accesores, "bufferViews": vistas,
        "buffers": [{"byteLength": len(binario)}],
    }
    texto = json.dumps(gltf, separators=(",", ":")).encode()
    json_bytes = texto + b" " * ((-len(texto)) % 4)
    bin_bytes = bytes(binario) + b"\x00" * ((-len(binario)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    return (struct.pack("<4sII", b"glTF", 2, total)
            + struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
            + struct.pack("<I4s", len(bin_bytes), b"BIN\x00") + bin_bytes)
