namespace DreamurDetector.Domain.Entities;

// Entidades mapeadas 1:1 contra schema.sql (PostgreSQL / Neon).

public class Persona
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public string Nombres { get; set; } = "";
    public string Apellidos { get; set; } = "";
    public string? TipoDocumento { get; set; }
    public string? NumeroDocumento { get; set; }
    public DateOnly? FechaNacimiento { get; set; }
    public string? Sexo { get; set; }
    public string? Telefono { get; set; }
    public string? Direccion { get; set; }
    public string? Ciudad { get; set; }
    public string? Pais { get; set; } = "BO";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DeletedAt { get; set; }

    public ICollection<CorreoElectronico> Correos { get; set; } = new List<CorreoElectronico>();
    public Usuario? Usuario { get; set; }
    public Paciente? Paciente { get; set; }
    public Medico? Medico { get; set; }
    public Administrador? Administrador { get; set; }
}

public class CorreoElectronico
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid PersonaId { get; set; }
    /// <summary>Usuario dueño del correo (un usuario puede tener varios; un correo es de una sola persona).</summary>
    public Guid? UsuarioId { get; set; }
    public string Correo { get; set; } = "";
    public bool EsPrincipal { get; set; }
    public bool Verificado { get; set; }
    public DateTimeOffset? VerificadoEn { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Persona Persona { get; set; } = null!;
}

public class Usuario
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid PersonaId { get; set; }
    public string PasswordHash { get; set; } = "";
    public string Rol { get; set; } = Roles.Paciente;
    public bool Activo { get; set; } = true;
    public int IntentosFallidos { get; set; }
    public DateTimeOffset? BloqueadoHasta { get; set; }
    public DateTimeOffset? UltimoAcceso { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Persona Persona { get; set; } = null!;
}

public class TokenVerificacion
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid UsuarioId { get; set; }
    public string Tipo { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public DateTimeOffset ExpiraEn { get; set; }
    public DateTimeOffset? UsadoEn { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Tabla extra (db/002_extras.sql): JWT cerrados con logout antes de expirar.</summary>
public class TokenRevocado
{
    public string Jti { get; set; } = "";
    public Guid? UsuarioId { get; set; }
    public DateTimeOffset ExpiraEn { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Paciente
{
    public Guid PersonaId { get; set; }
    /// <summary>Lo genera la base de datos (PAC-000001).</summary>
    public string Codigo { get; set; } = null!;
    public string? GrupoSanguineo { get; set; }
    public string? Alergias { get; set; }
    public string? Antecedentes { get; set; }
    public string? ContactoEmergencia { get; set; }
    public string? TelefonoEmergencia { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Persona Persona { get; set; } = null!;
}

public class Medico
{
    public Guid PersonaId { get; set; }
    public string? Matricula { get; set; }
    public string? Especialidad { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Persona Persona { get; set; } = null!;
}

public class Administrador
{
    public Guid PersonaId { get; set; }
    public string Nivel { get; set; } = "admin";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Persona Persona { get; set; } = null!;
}

public class Consentimiento
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid PacienteId { get; set; }
    public string Tipo { get; set; } = "";
    public bool Otorgado { get; set; }
    public string VersionTexto { get; set; } = "v1";
    public string? Ip { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class TipoTumor
{
    public string Codigo { get; set; } = "";
    public string Nombre { get; set; } = "";
    public string? Descripcion { get; set; }
    public bool EsTumor { get; set; }
    public string? NaturalezaGeneral { get; set; }
}

public class Radiografia
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? PacienteId { get; set; }
    public Guid? SubidaPor { get; set; }
    public string Origen { get; set; } = Origenes.Paciente;
    public string Modalidad { get; set; } = Modalidades.MriCerebro;
    public DateOnly? FechaEstudio { get; set; }
    public string? Notas { get; set; }
    public string Estado { get; set; } = EstadosRadiografia.Subida;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DeletedAt { get; set; }

    public Paciente? Paciente { get; set; }
    public RadiografiaArchivo? Archivo { get; set; }
    public Etiqueta? Etiqueta { get; set; }
    public ICollection<Deteccion> Detecciones { get; set; } = new List<Deteccion>();
}

public class RadiografiaArchivo
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid RadiografiaId { get; set; }
    public int Orden { get; set; }
    public string Formato { get; set; } = "imagen";
    public string? NombreOriginal { get; set; }
    public string StorageKey { get; set; } = "";
    public string Sha256 { get; set; } = "";
    public string Mime { get; set; } = "image/jpeg";
    public int? Ancho { get; set; }
    public int? Alto { get; set; }
    public long? TamBytes { get; set; }

    public Radiografia Radiografia { get; set; } = null!;
}

public class ModeloVersion
{
    public int Id { get; set; }
    public string Modalidad { get; set; } = Modalidades.MriCerebro;
    public int Version { get; set; }
    public string Arquitectura { get; set; } = "resnet18+mlp+xgboost";
    /// <summary>JSONB serializado, p. ej. {"tipo":["glioma","meningioma",...]}.</summary>
    public string Heads { get; set; } = "{}";
    public string? PesosRedKey { get; set; }
    /// <summary>JSONB serializado.</summary>
    public string? PesosXgb { get; set; }
    public int? NMuestras { get; set; }
    /// <summary>JSONB serializado.</summary>
    public string? Metricas { get; set; }
    public bool Activo { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Entrenamiento
{
    public int Id { get; set; }
    public string Modalidad { get; set; } = Modalidades.MriCerebro;
    public string Estado { get; set; } = EstadosEntrenamiento.EnCurso;
    public int? NMuestras { get; set; }
    public int? ModeloVersionId { get; set; }
    public string? Error { get; set; }
    public string? DisparadoPor { get; set; }
    public DateTimeOffset IniciadoEn { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinalizadoEn { get; set; }
}

public class Deteccion
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid RadiografiaId { get; set; }
    public Guid? ArchivoId { get; set; }
    public int? ModeloVersionId { get; set; }
    public string Modalidad { get; set; } = Modalidades.MriCerebro;
    public bool TieneTumor { get; set; }
    public string TipoTumor { get; set; } = "";
    public string? Malignidad { get; set; }
    public string? MalignidadFuente { get; set; }
    public float? ProbMaligno { get; set; }
    public float Confianza { get; set; }
    public int NCortes { get; set; } = 1;
    /// <summary>JSONB serializado.</summary>
    public string? Probabilidades { get; set; }
    /// <summary>false = la IA no reconoció una imagen cerebral válida (MRI/TC).</summary>
    public bool ImagenValida { get; set; } = true;
    public string? TipoImagen { get; set; }
    public string? Mensaje { get; set; }
    public Guid? SolicitadoPor { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Radiografia Radiografia { get; set; } = null!;
    public ICollection<DeteccionZona> Zonas { get; set; } = new List<DeteccionZona>();
}

public class DeteccionZona
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid DeteccionId { get; set; }
    public int Orden { get; set; }
    public float X { get; set; }
    public float Y { get; set; }
    public float Ancho { get; set; }
    public float Alto { get; set; }
    public float? Puntaje { get; set; }
}

public class Etiqueta
{
    public Guid RadiografiaId { get; set; }
    public bool TieneTumor { get; set; }
    public string TipoTumor { get; set; } = "";
    public string Fuente { get; set; } = FuentesEtiqueta.RevisionMedica;
    public Guid? RevisadoPor { get; set; }
    public string? Comentario { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Radiografia Radiografia { get; set; } = null!;
}

public class Auditoria
{
    public long Id { get; set; }
    public Guid? UsuarioId { get; set; }
    public string Accion { get; set; } = "";
    public string? Entidad { get; set; }
    public string? EntidadId { get; set; }
    public string? Ip { get; set; }
    /// <summary>JSONB serializado.</summary>
    public string? Detalle { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Vínculo médico-paciente (tabla extra db/002_extras.sql).</summary>
public class MedicoPaciente
{
    public Guid MedicoId { get; set; }
    public Guid PacienteId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
