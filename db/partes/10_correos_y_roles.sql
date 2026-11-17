-- ============ CORREOS: un usuario puede tener varios; un correo pertenece a UNA sola persona ============
-- correos_electronicos.correo ya es UNIQUE (citext): un correo no puede repetirse entre personas.
-- Se añade usuario_id y una FK compuesta (usuario_id, persona_id) hacia usuarios, que garantiza que el correo
-- pertenece al usuario Y a su misma persona (no hace falta un trigger).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_usuarios_id_persona') THEN
        ALTER TABLE usuarios ADD CONSTRAINT ux_usuarios_id_persona UNIQUE (id, persona_id);
    END IF;

    ALTER TABLE correos_electronicos ADD COLUMN IF NOT EXISTS usuario_id UUID;

    -- Solo completa filas antiguas sin dueño (no toca las que ya lo tienen).
    UPDATE correos_electronicos c SET usuario_id = u.id
      FROM usuarios u WHERE u.persona_id = c.persona_id AND c.usuario_id IS NULL;

    IF NOT EXISTS (SELECT 1 FROM correos_electronicos WHERE usuario_id IS NULL) THEN
        ALTER TABLE correos_electronicos ALTER COLUMN usuario_id SET NOT NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_correo_usuario') THEN
        ALTER TABLE correos_electronicos
            ADD CONSTRAINT fk_correo_usuario FOREIGN KEY (usuario_id, persona_id)
            REFERENCES usuarios (id, persona_id) ON DELETE CASCADE;
    END IF;
END
$$;
CREATE INDEX IF NOT EXISTS ix_correos_usuario ON correos_electronicos (usuario_id);
-- Un solo correo principal por usuario.
CREATE UNIQUE INDEX IF NOT EXISTS ux_correo_principal_usuario ON correos_electronicos (usuario_id) WHERE es_principal;

-- ============ ROLES ============
-- usuarios.rol es el rol MÁS ALTO de la cuenta:
--   paciente = solo paciente (nunca puede ser médico ni administrador)
--   medico   = médico y también puede ser paciente
--   admin    = administrador y también puede ser médico y paciente
-- Los perfiles (pacientes / medicos / administradores) cuelgan de la persona. Reglas:
CREATE OR REPLACE FUNCTION trg_validar_perfil_rol() RETURNS trigger AS $f$
DECLARE r TEXT;
BEGIN
    SELECT rol INTO r FROM usuarios WHERE persona_id = NEW.persona_id;
    IF TG_TABLE_NAME = 'medicos' AND (r IS NULL OR r NOT IN ('medico','admin')) THEN
        RAISE EXCEPTION 'Una cuenta de paciente no puede ser médico' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_TABLE_NAME = 'administradores' AND (r IS NULL OR r <> 'admin') THEN
        RAISE EXCEPTION 'Solo una cuenta de administrador puede tener perfil de administrador' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END
$f$ LANGUAGE plpgsql;

-- Se comprueba al confirmar la transacción, para que persona, usuario y perfil puedan insertarse en cualquier orden.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ctg_medicos_rol' AND NOT tgisinternal) THEN
        CREATE CONSTRAINT TRIGGER ctg_medicos_rol AFTER INSERT ON medicos
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_validar_perfil_rol();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ctg_administradores_rol' AND NOT tgisinternal) THEN
        CREATE CONSTRAINT TRIGGER ctg_administradores_rol AFTER INSERT ON administradores
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_validar_perfil_rol();
    END IF;
END
$$;

-- Un paciente nunca asciende a médico o administrador (ni cambiando el rol de su cuenta).
CREATE OR REPLACE FUNCTION trg_bloquear_ascenso_paciente() RETURNS trigger AS $f$
BEGIN
    IF OLD.rol = 'paciente' AND NEW.rol <> 'paciente' THEN
        RAISE EXCEPTION 'Un paciente no puede convertirse en médico ni en administrador' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$f$ LANGUAGE plpgsql;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_usuarios_sin_ascenso' AND NOT tgisinternal) THEN
        CREATE TRIGGER trg_usuarios_sin_ascenso BEFORE UPDATE OF rol ON usuarios
            FOR EACH ROW EXECUTE FUNCTION trg_bloquear_ascenso_paciente();
    END IF;
END
$$;
