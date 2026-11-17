-- Dreamur-Detector · 003_modelos_3d.sql
-- Modelos 3D generados por Dreamur-Generate_Model. Idempotente: solo CREATE ... IF NOT EXISTS.
-- No borra ni modifica datos. El archivo .glb vive en el bucket; aquí solo se guarda su ruta (storage_key).
-- Es OPCIONAL: un paciente puede tener 0, 1 o varios modelos. Si no se genera, no existe fila.
-- Se enlaza a detecciones (que existe en schema.sql y en el esquema real de Neon con estudios)
-- y a pacientes, sin depender de radiografias/estudios.

CREATE TABLE IF NOT EXISTS modelos_3d (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id        UUID NOT NULL REFERENCES pacientes(persona_id) ON DELETE CASCADE,
    deteccion_id       UUID REFERENCES detecciones(id) ON DELETE SET NULL,
    generado_por       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    storage_key        TEXT NOT NULL UNIQUE,          -- modelos3d/<paciente_id>/<id>.glb
    formato            TEXT NOT NULL DEFAULT 'glb' CHECK (formato IN ('glb')),
    sha256             CHAR(64) NOT NULL,
    tam_bytes          INT NOT NULL CHECK (tam_bytes > 0),
    n_triangulos_cerebro INT,
    n_triangulos_tumor   INT,                         -- NULL si no hay tumor (modelo solo del cerebro)
    tipo_tumor         TEXT REFERENCES tipos_tumor(codigo),
    version_generador  TEXT NOT NULL DEFAULT 'v1',
    parametros         JSONB,                         -- zona (x,y,ancho,alto), escala, semilla, color del tumor
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_modelos3d_paciente  ON modelos_3d (paciente_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_modelos3d_deteccion ON modelos_3d (deteccion_id);
