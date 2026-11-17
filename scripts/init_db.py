"""Prepara Neon: aplica el esquema (solo cerebro), siembra tipos_tumor y dataset_fuentes.

Uso:  python -m scripts.init_db            # usa sql/001_schema.sql
Usa una base NUEVA (o una rama nueva de Neon). Es idempotente.
"""
import argparse
from pathlib import Path

from app import db
from app import taxonomy as tx
from datasets.adapters import FUENTES

RAIZ = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema", default=str(RAIZ / "sql" / "001_schema.sql"))
    a = ap.parse_args()
    with db.cursor() as cur:
        cur.execute(Path(a.schema).read_text(encoding="utf-8"))
        print("esquema aplicado")
        for codigo, (nombre, es_tumor, naturaleza, desc) in tx.TIPOS.items():
            cur.execute(
                "INSERT INTO tipos_tumor (codigo, nombre, descripcion, es_tumor, naturaleza_general) VALUES (%s,%s,%s,%s,%s) "
                "ON CONFLICT (codigo) DO UPDATE SET nombre=EXCLUDED.nombre, descripcion=EXCLUDED.descripcion, "
                "es_tumor=EXCLUDED.es_tumor, naturaleza_general=EXCLUDED.naturaleza_general",
                (codigo, nombre, desc, es_tumor, naturaleza))
        for codigo, f in FUENTES.items():
            cur.execute(
                "INSERT INTO dataset_fuentes (codigo, nombre, url, licencia, citacion, notas) VALUES (%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (codigo) DO UPDATE SET nombre=EXCLUDED.nombre, url=EXCLUDED.url, licencia=EXCLUDED.licencia, "
                "citacion=EXCLUDED.citacion, notas=EXCLUDED.notas",
                (codigo, f["nombre"], f.get("url"), f.get("licencia"), f.get("citacion"), f.get("notas")))
    print(f"Listo: {len(tx.TIPOS)} tipos y {len(FUENTES)} fuentes de datos sembrados.")


if __name__ == "__main__":
    main()
