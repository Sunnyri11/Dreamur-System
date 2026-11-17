using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using DreamurDetector.Application.Common;

namespace DreamurDetector.Application.Dtos;

// ---------- Usuarios (admin) ----------
public sealed class CrearUsuarioRequest
{
    [Required, StringLength(100, MinimumLength = 2)] public string Nombres { get; set; } = "";
    [Required, StringLength(100, MinimumLength = 2)] public string Apellidos { get; set; } = "";
    [Required, EmailAddress, StringLength(254)] public string Correo { get; set; } = "";
    [Required, RegularExpression(Reglas.Password, ErrorMessage = Reglas.PasswordMensaje)] public string Password { get; set; } = "";
    [Required, RegularExpression("^(medico|admin)$")] public string Rol { get; set; } = "medico";
    [RegularExpression(Reglas.TipoDocumento)] public string? TipoDocumento { get; set; }
    [StringLength(30)] public string? NumeroDocumento { get; set; }
    [StringLength(30)] public string? Telefono { get; set; }
    [StringLength(50)] public string? Matricula { get; set; }
    [StringLength(100)] public string? Especialidad { get; set; }
    [RegularExpression("^(admin|superadmin)$")] public string? NivelAdmin { get; set; }
}

public sealed class CambiarEstadoUsuarioRequest
{
    public bool Activo { get; set; }
}

public sealed class UsuarioFiltro : PaginacionQuery
{
    public string? Buscar { get; set; }
    [RegularExpression("^(paciente|medico|admin)$")] public string? Rol { get; set; }
    public bool? Activo { get; set; }
}

// ---------- Modelos / entrenamientos ----------
public sealed record ModeloVersionDto(
    int Id, string Region, int Version, string Arquitectura, string[] Tipos, int? NMuestras,
    JsonElement? Metricas, bool Activo, DateTimeOffset CreatedAt);

public sealed record EntrenamientoDto(
    int Id, string Region, string Estado, int? NMuestras, int? ModeloVersionId, string? Error,
    string? DisparadoPor, DateTimeOffset IniciadoEn, DateTimeOffset? FinalizadoEn);

/// <summary>Callback que envía el servicio ML al terminar un entrenamiento.</summary>
public sealed class CompletarEntrenamientoRequest
{
    [Required, RegularExpression("^(completado|error)$")] public string Estado { get; set; } = "";
    public int? ModeloVersionId { get; set; }
    public int? NMuestras { get; set; }
    [StringLength(2000)] public string? Error { get; set; }
}

// ---------- Auditoría ----------
public sealed record AuditoriaDto(
    long Id, Guid? UsuarioId, string Accion, string? Entidad, string? EntidadId, string? Ip,
    JsonElement? Detalle, DateTimeOffset CreatedAt, string? UsuarioNombre);

public sealed class AuditoriaFiltro : PaginacionQuery
{
    public string? Accion { get; set; }
    public Guid? UsuarioId { get; set; }
    public DateTimeOffset? Desde { get; set; }
    public DateTimeOffset? Hasta { get; set; }
}

// ---------- Médicos (admin) ----------
public sealed class MedicoFiltro : PaginacionQuery
{
    public string? Buscar { get; set; }
}

public sealed record MedicoDto(
    Guid UsuarioId, Guid PersonaId, string Nombres, string Apellidos, string? Correo,
    string? Matricula, string? Especialidad, bool Activo, DateTimeOffset? UltimoAcceso,
    int TotalPacientes, DateTimeOffset CreadoEn);
