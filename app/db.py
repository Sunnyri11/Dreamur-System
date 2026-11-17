"""Conexión a Neon (PostgreSQL)."""
import time
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from .config import settings


def connect() -> psycopg.Connection:
    # Neon puede estar "dormido" (scale-to-zero): reintentamos un par de veces.
    ultimo = None
    for intento in range(3):
        try:
            # prepare_threshold=None: el pooler de Neon (pgbouncer) no lleva bien las sentencias preparadas.
            return psycopg.connect(
                settings.database_url, row_factory=dict_row, prepare_threshold=None, connect_timeout=15
            )
        except psycopg.OperationalError as e:
            ultimo = e
            time.sleep(1.5 * (intento + 1))
    raise ultimo


@contextmanager
def cursor():
    """Una transacción: commit al salir bien, rollback si hay excepción."""
    with connect() as conn:
        with conn.cursor() as cur:
            yield cur
