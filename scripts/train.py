"""Entrena el modelo de una modalidad (MRI o TC) de tumores cerebrales. Recomendado en tu PC con GPU o en Colab.

Uso:  python -m scripts.train --modalidad mri --epochs 8
"""
import argparse

from app import taxonomy as tx
from app import training


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modalidad", default="mri", choices=tx.MODALIDADES)
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--activar", choices=["auto", "si", "no"], default="auto")
    a = ap.parse_args()
    training.train(a.modalidad, epochs=a.epochs, batch_size=a.batch_size, disparado_por="cli", activar=a.activar)


if __name__ == "__main__":
    main()
