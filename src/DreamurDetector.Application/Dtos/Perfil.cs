using System.ComponentModel.DataAnnotations;

namespace DreamurDetector.Application.Dtos;

/// <summary>Perfil completo del usuario autenticado. Los campos de otros roles vienen null.</summary>
public sealed record PerfilDto(
    Guid UsuarioId, Guid PersonaId, string Rol, bool Activo, DateTimeOffset? UltimoAcceso, DateTimeOffset CreadoEn,
    string Nombres, string Apellidos, string? TipoDocumento, string? NumeroDocumento, DateOnly? FechaNacimiento,
    string? Sexo, string? Telefono, string? Direccion, string? Ciudad, string? Pais,
    string? Correo, bool CorreoVerificado,
    string? CodigoPaciente, string? GrupoSanguineo, string? Alergias, string? Antecedentes,
    string? ContactoEmergencia, string? TelefonoEmergencia,
    string? Matricula, string? Especialidad,
    string? NivelAdmin);

/// <summary>Actualización parcial: null = no cambia; cadena vacía = borrar el valor. Los campos de otro rol se ignoran.</summary>
public sealed class ActualizarPerfilRequest
{
    [StringLength(100, MinimumLength = 2)] public string? Nombres { get; set; }
    [StringLength(100, MinimumLength = 2)] public string? Apellidos { get; set; }
    [RegularExpression(Reglas.TipoDocumento)] public string? TipoDocumento { get; set; }
    [StringLength(30)] public string? NumeroDocumento { get; set; }
    public DateOnly? FechaNacimiento { get; set; }
    [RegularExpression(Reglas.Sexo)] public string? Sexo { get; set; }
    [StringLength(30)] public string? Telefono { get; set; }
    [StringLength(250)] public string? Direccion { get; set; }
    [StringLength(100)] public string? Ciudad { get; set; }
    [StringLength(2, MinimumLength = 2)] public string? Pais { get; set; }
    // Paciente
    [RegularExpression(Reglas.GrupoSanguineo)] public string? GrupoSanguineo { get; set; }
    [StringLength(1000)] public string? Alergias { get; set; }
    [StringLength(2000)] public string? Antecedentes { get; set; }
    [StringLength(150)] public string? ContactoEmergencia { get; set; }
    [StringLength(30)] public string? TelefonoEmergencia { get; set; }
    // Médico
    [StringLength(50)] public string? Matricula { get; set; }
    [StringLength(100)] public string? Especialidad { get; set; }
}
