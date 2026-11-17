"""Configuración leída del entorno (.env en local, variables de entorno en Render).

Nada de claves en el código: todo viene de variables de entorno.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


class _Settings:
    @staticmethod
    def _req(name: str) -> str:
        v = os.environ.get(name)
        if not v:
            raise RuntimeError(f"Falta la variable de entorno {name}")
        return v

    # --- obligatorias ---
    @property
    def database_url(self) -> str:
        return self._req("DATABASE_URL")

    @property
    def ml_api_key(self) -> str:
        return self._req("ML_API_KEY")

    @property
    def s3_endpoint(self) -> str:
        return self._req("S3_ENDPOINT")

    @property
    def s3_bucket(self) -> str:
        return self._req("S3_BUCKET")

    @property
    def s3_access_key_id(self) -> str:
        return self._req("S3_ACCESS_KEY_ID")

    @property
    def s3_secret_access_key(self) -> str:
        return self._req("S3_SECRET_ACCESS_KEY")

    # --- opcionales ---
    @property
    def s3_region(self) -> str:
        return os.environ.get("S3_REGION", "auto")

    @property
    def cache_dir(self) -> Path:
        return Path(os.environ.get("CACHE_DIR", "./cache"))

    @property
    def gemma_api_key(self) -> str | None:
        return os.environ.get("GEMMA_API_KEY") or None

    @property
    def gemma_model(self) -> str:
        return os.environ.get("GEMMA_MODEL", "gemma-3-27b-it")

    @property
    def backbone(self) -> str:
        return os.environ.get("BACKBONE", "resnet18")  # resnet18 | resnet50

    @property
    def max_cortes(self) -> int:
        return int(os.environ.get("MAX_CORTES", "12"))

    @property
    def max_bytes_estudio(self) -> int:
        return int(os.environ.get("MAX_MB_ESTUDIO", "200")) * 1024 * 1024

    @property
    def reentrenar_habilitado(self) -> bool:
        return os.environ.get("ALLOW_RETRAIN_ENDPOINT", "1") == "1"


settings = _Settings()
