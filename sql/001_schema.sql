-- Dreamur-Detector (SOLO TUMORES CEREBRALES) · esquema para Neon (PostgreSQL). Idempotente.
-- Pensado para una base NUEVA (o una rama nueva de Neon).
-- Las imágenes/estudios y los pesos de los modelos viven en el bucket R2; aquí solo se guarda su ruta.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS 'BEGIN NEW.updated_at = now(); RETURN NEW; END' LANGUAGE plpgsql;

-- ============ PERSONAS / ACCESO ============
CREATE TABLE IF NOT EXISTS personas (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombres           TEXT NOT NULL,
    apellidos         TEXT NOT NULL,
    tipo_documento    TEXT CHECK (tipo_documento IN ('CI','DNI','PASAPORTE','OTRO')),
    numero_documento  TEXT,
    fecha_nacimiento  DATE CHECK (fecha_nacimiento > DATE '1900-01-01'),
    sexo              TEXT CHECK (sexo IN ('F','M','otro','no_indica')),
    telefono          TEXT,
    direccion         TEXT,
    ciudad            TEXT,
    pais              TEXT DEFAULT 'BO',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_personas_documento
    ON personas (tipo_documento, numero_documento) WHERE numero_documento IS NOT NULL;

CREATE TABLE IF NOT EXISTS correos_electronicos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id    UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    correo        CITEXT NOT NULL UNIQUE,
    es_principal  BOOLEAN NOT NULL DEFAULT FALSE,
    verificado    BOOLEAN NOT NULL DEFAULT FALSE,
    verificado_en TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_correo_principal ON correos_electronicos (persona_id) WHERE es_principal;

CREATE TABLE IF NOT EXISTS usuarios (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id        UUID NOT NULL UNIQUE REFERENCES personas(id) ON DELETE CASCADE,
    password_hash     TEXT NOT NULL,
    rol               TEXT NOT NULL CHECK (rol IN ('paciente','medico','admin')),
    activo            BOOLEAN NOT NULL DEFAULT TRUE,
    intentos_fallidos INT NOT NULL DEFAULT 0,
    bloqueado_hasta   TIMESTAMPTZ,
    ultimo_acceso     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokens_verificacion (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL CHECK (tipo IN ('verificar_correo','restablecer_password')),
    token_hash  TEXT NOT NULL,
    expira_en   TIMESTAMPTZ NOT NULL,
    usado_en    TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS seq_codigo_paciente;
CREATE TABLE IF NOT EXISTS pacientes (
    persona_id          UUID PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
    codigo              TEXT NOT NULL UNIQUE
                        DEFAULT ('PAC-' || lpad(nextval('seq_codigo_paciente')::text, 6, '0')),
    grupo_sanguineo     TEXT CHECK (grupo_sanguineo IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    alergias            TEXT,
    antecedentes        TEXT,
    contacto_emergencia TEXT,
    telefono_emergencia TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS medicos (
    persona_id    UUID PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
    matricula     TEXT UNIQUE,
    especialidad  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS administradores (
    persona_id  UUID PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
    nivel       TEXT NOT NULL DEFAULT 'admin' CHECK (nivel IN ('admin','superadmin')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consentimientos (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id  UUID NOT NULL REFERENCES pacientes(persona_id) ON DELETE CASCADE,
    tipo         TEXT NOT NULL CHECK (tipo IN ('tratamiento_datos','uso_entrenamiento')),
    otorgado     BOOLEAN NOT NULL,
    version_texto TEXT NOT NULL DEFAULT 'v1',
    ip           TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_consent_paciente ON consentimientos (paciente_id, tipo, created_at DESC);

-- ============ HISTORIAL CLÍNICO DEL PACIENTE (NUEVO) ============
-- Eventos que cambian la evolución de un tumor cerebral (una cirugía puede reducirlo; no es "mejoría espontánea").
-- El servicio de IA los lee para contextualizar la evolución entre estudios.
CREATE TABLE IF NOT EXISTS eventos_clinicos (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id  UUID NOT NULL REFERENCES pacientes(persona_id) ON DELETE CASCADE,
    tipo         TEXT NOT NULL CHECK (tipo IN ('diagnostico','cirugia','quimioterapia','radioterapia',
                                               'tratamiento_hormonal','inmunoterapia','medicacion','sintoma','otro')),
    descripcion  TEXT,
    fecha        DATE NOT NULL,
    creado_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_eventos_paciente ON eventos_clinicos (paciente_id, fecha);

-- ============ CATÁLOGOS ============
CREATE TABLE IF NOT EXISTS tipos_tumor (
    codigo             TEXT PRIMARY KEY,
    nombre             TEXT NOT NULL,
    descripcion        TEXT,
    es_tumor           BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE: normal o hallazgo no tumoral (quiste, cálculo)
    naturaleza_general TEXT                             -- conocimiento general por tipo, NO una predicción
);

-- De dónde viene cada dataset (licencia y cita: obligatorias al publicar resultados).
CREATE TABLE IF NOT EXISTS dataset_fuentes (
    codigo     TEXT PRIMARY KEY,
    nombre     TEXT NOT NULL,
    url        TEXT,
    licencia   TEXT,
    citacion   TEXT,
    notas      TEXT
);

-- ============ ESTUDIOS CEREBRALES (imagen, serie DICOM, volumen NIfTI...) ============
-- Hay un modelo por modalidad: 'mri' (resonancia) y 'tc' (tomografía).
CREATE TABLE IF NOT EXISTS estudios (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id     UUID REFERENCES pacientes(persona_id) ON DELETE RESTRICT,
    subida_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    origen          TEXT NOT NULL CHECK (origen IN ('paciente','personal','dataset')),
    dataset_fuente  TEXT REFERENCES dataset_fuentes(codigo),
    grupo_ref       TEXT,            -- paciente/caso del dataset (evita fuga de datos al dividir train/test)
    split_origen    TEXT CHECK (split_origen IN ('train','val','test')),
    modalidad       TEXT NOT NULL CHECK (modalidad IN ('mri','tc')),
    secuencia       TEXT CHECK (secuencia IN ('t1','t1c','t2','flair','otra')),   -- solo MRI; informativa
    fecha_estudio   DATE,
    notas           TEXT,
    estado          TEXT NOT NULL DEFAULT 'subido' CHECK (estado IN ('subido','analizado','revisado')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CHECK (origen = 'dataset' OR paciente_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_estudios_paciente ON estudios (paciente_id, fecha_estudio);
CREATE INDEX IF NOT EXISTS ix_estudios_modalidad ON estudios (modalidad, estado);
CREATE INDEX IF NOT EXISTS ix_estudios_grupo    ON estudios (grupo_ref, fecha_estudio) WHERE grupo_ref IS NOT NULL;

-- Archivo(s) del estudio en el bucket. El ORIGINAL se guarda tal cual (jpg/png/dicom/nifti/zip);
-- el servicio de IA lo decodifica al analizar.
CREATE TABLE IF NOT EXISTS estudio_archivos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estudio_id      UUID NOT NULL REFERENCES estudios(id) ON DELETE CASCADE,
    orden           INT NOT NULL DEFAULT 0,
    formato         TEXT NOT NULL CHECK (formato IN ('imagen','dicom','nifti','zip')),
    nombre_original TEXT,
    storage_key     TEXT NOT NULL UNIQUE,
    sha256          CHAR(64) NOT NULL,
    mime            TEXT,
    ancho INT, alto INT, tam_bytes BIGINT,
    corte_clave     INT,             -- corte que muestra la lesión (volúmenes); NULL = la IA elige
    UNIQUE (estudio_id, orden)
);
CREATE INDEX IF NOT EXISTS ix_archivo_sha ON estudio_archivos (sha256);

-- ============ MEMORIA DE DREAMUR-DETECTOR ============
CREATE TABLE IF NOT EXISTS modelo_versiones (
    id            SERIAL PRIMARY KEY,
    modalidad     TEXT NOT NULL CHECK (modalidad IN ('mri','tc')),
    version       INT NOT NULL,
    arquitectura  TEXT NOT NULL,
    heads         JSONB NOT NULL,                -- {"tipo":[...], "malignidad":[...], "grado":[...], "grado_oms":[...]}
    pesos_red_key TEXT NOT NULL,
    pesos_xgb     JSONB,                         -- {"tipo":"modelos/...", "malignidad":"modelos/..."}
    n_muestras    INT,
    metricas      JSONB,
    activo        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (modalidad, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_modelo_activo ON modelo_versiones (modalidad) WHERE activo;

CREATE TABLE IF NOT EXISTS entrenamientos (
    id                 SERIAL PRIMARY KEY,
    modalidad          TEXT NOT NULL CHECK (modalidad IN ('mri','tc')),
    estado             TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso','completado','error')),
    n_muestras         INT,
    modelo_version_id  INT REFERENCES modelo_versiones(id) ON DELETE SET NULL,
    error              TEXT,
    disparado_por      TEXT,
    iniciado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalizado_en      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_entrenamiento_en_curso ON entrenamientos (modalidad) WHERE estado = 'en_curso';

-- Modelo que estima la progresión a partir del HISTORIAL del paciente (se entrena cuando hay seguimientos etiquetados).
CREATE TABLE IF NOT EXISTS modelo_progresion (
    id          SERIAL PRIMARY KEY,
    version     INT NOT NULL UNIQUE,
    pesos_key   TEXT NOT NULL,
    columnas    JSONB NOT NULL,
    n_muestras  INT,
    metricas    JSONB,
    activo      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_progresion_activo ON modelo_progresion ((TRUE)) WHERE activo;

-- ============ RESULTADOS ============
CREATE TABLE IF NOT EXISTS detecciones (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estudio_id         UUID NOT NULL REFERENCES estudios(id) ON DELETE CASCADE,
    archivo_id         UUID REFERENCES estudio_archivos(id) ON DELETE SET NULL,   -- archivo del corte representativo
    modelo_version_id  INT REFERENCES modelo_versiones(id) ON DELETE SET NULL,
    modalidad          TEXT NOT NULL CHECK (modalidad IN ('mri','tc')),
    tiene_tumor        BOOLEAN NOT NULL,
    tipo_tumor         TEXT NOT NULL REFERENCES tipos_tumor(codigo),
    malignidad         TEXT CHECK (malignidad IN ('no_tumoral','benigno','maligno')),
    malignidad_fuente  TEXT CHECK (malignidad_fuente IN ('modelo','conocimiento_general')),
    prob_maligno       REAL CHECK (prob_maligno BETWEEN 0 AND 1),
    grado              TEXT CHECK (grado IN ('bajo','alto')),
    grado_oms          TEXT CHECK (grado_oms IN ('I','II','III','IV')),
    confianza          REAL NOT NULL CHECK (confianza BETWEEN 0 AND 1),
    probabilidades     JSONB,           -- por cabeza: {"tipo":{...}, "malignidad":{...}, "grado":{...}, ...}
    n_cortes           INT NOT NULL DEFAULT 1,
    corte_representativo INT,
    area_zonas         REAL,            -- suma de áreas normalizadas de las zonas (0-1): proxy de tamaño para seguir el crecimiento
    solicitado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    overlay_key        TEXT,
    informe            JSONB,
    evolucion          JSONB,           -- comparación con el historial del paciente
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_det_estudio ON detecciones (estudio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS detecciones_zonas (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deteccion_id  UUID NOT NULL REFERENCES detecciones(id) ON DELETE CASCADE,
    orden         INT NOT NULL,
    x REAL NOT NULL CHECK (x BETWEEN 0 AND 1),
    y REAL NOT NULL CHECK (y BETWEEN 0 AND 1),
    ancho REAL NOT NULL CHECK (ancho BETWEEN 0 AND 1),
    alto  REAL NOT NULL CHECK (alto  BETWEEN 0 AND 1),
    puntaje REAL
);

-- Diagnóstico confirmado (o del dataset): es lo único que alimenta el aprendizaje.
-- Las columnas opcionales se dejan en NULL cuando el dataset NO trae ese dato (nunca se inventan).
CREATE TABLE IF NOT EXISTS etiquetas (
    estudio_id     UUID PRIMARY KEY REFERENCES estudios(id) ON DELETE CASCADE,
    tiene_tumor    BOOLEAN NOT NULL,
    tipo_tumor     TEXT NOT NULL REFERENCES tipos_tumor(codigo),
    malignidad     TEXT CHECK (malignidad IN ('no_tumoral','benigno','maligno')),
    grado          TEXT CHECK (grado IN ('bajo','alto')),
    grado_oms      TEXT CHECK (grado_oms IN ('I','II','III','IV')),
    histologia     TEXT,
    molecular      JSONB,            -- marcadores si el dataset los trae, p. ej. {"idh":"mutado","mgmt":"metilado"} (solo se guardan)
    progresion     BOOLEAN,          -- ¿progresó respecto al estudio anterior? (p. ej. RANO / criterio médico)
    fuente         TEXT NOT NULL CHECK (fuente IN ('dataset_inicial','revision_medica')),
    revisado_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    comentario     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ SISTEMA ============
CREATE TABLE IF NOT EXISTS configuracion (
    clave        TEXT PRIMARY KEY,
    valor        TEXT NOT NULL,
    descripcion  TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auditoria (
    id          BIGSERIAL PRIMARY KEY,
    usuario_id  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    accion      TEXT NOT NULL,
    entidad     TEXT,
    entidad_id  TEXT,
    ip          TEXT,
    detalle     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_auditoria_fecha ON auditoria (created_at DESC);

-- ============ VISTAS ============
CREATE OR REPLACE VIEW v_consentimiento_vigente AS
SELECT DISTINCT ON (paciente_id, tipo) paciente_id, tipo, otorgado, created_at
FROM consentimientos ORDER BY paciente_id, tipo, created_at DESC;

-- Muestras que pueden usarse para entrenar: datasets, o pacientes con consentimiento y diagnóstico confirmado.
-- Se usa el primer archivo del estudio (orden 0).
CREATE OR REPLACE VIEW v_muestras_entrenables AS
SELECT e.id AS estudio_id, a.id AS archivo_id, e.modalidad, e.secuencia, e.grupo_ref, e.split_origen,
       e.paciente_id, e.fecha_estudio,
       l.tipo_tumor, l.tiene_tumor, l.malignidad, l.grado, l.grado_oms, l.progresion,
       a.storage_key, a.formato, a.corte_clave
FROM estudios e
JOIN etiquetas l ON l.estudio_id = e.id
JOIN estudio_archivos a ON a.estudio_id = e.id AND a.orden = 0
WHERE e.deleted_at IS NULL AND (
    e.origen = 'dataset' OR EXISTS (
        SELECT 1 FROM v_consentimiento_vigente c
        WHERE c.paciente_id = e.paciente_id AND c.tipo = 'uso_entrenamiento' AND c.otorgado));

-- ============ TRIGGERS updated_at ============
DROP TRIGGER IF EXISTS trg_personas_upd ON personas;
CREATE TRIGGER trg_personas_upd BEFORE UPDATE ON personas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_usuarios_upd ON usuarios;
CREATE TRIGGER trg_usuarios_upd BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_pacientes_upd ON pacientes;
CREATE TRIGGER trg_pacientes_upd BEFORE UPDATE ON pacientes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_estudios_upd ON estudios;
CREATE TRIGGER trg_estudios_upd BEFORE UPDATE ON estudios FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_etiquetas_upd ON etiquetas;
CREATE TRIGGER trg_etiquetas_upd BEFORE UPDATE ON etiquetas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_configuracion_upd ON configuracion;
CREATE TRIGGER trg_configuracion_upd BEFORE UPDATE ON configuracion FOR EACH ROW EXECUTE FUNCTION set_updated_at();
