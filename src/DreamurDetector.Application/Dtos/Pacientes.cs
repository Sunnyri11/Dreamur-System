using System.ComponentModel.DataAnnotations;
using DreamurDetector.Application.Common;

namespace DreamurDetector.Application.Dtos;

public sealed class PacienteFiltro : PaginacionQuery
{
    /// <summary>Busca por nombre, código (PAC-...) o documento.</summary>
    public string? Buscar { get; set; }
}

public sealed record PacienteResumenDto(
    Guid PersonaId, string Codigo, string Nombres, string Apellidos, string? NumeroDocumento,
    string? Correo, string? Telefono, DateTimeOffset CreatedAt, Guid? UsuarioId, bool? Activo);

public sealed record PacienteDto(
    Guid PersonaId, string Codigo, string Nombres, string Apellidos, string? TipoDocumento, string? NumeroDocumento,
    DateOnly? FechaNacimiento, string? Sexo, string? Telefono, string? Direccion, string? Ciudad, string? Pais,
    string? Correo, string? GrupoSanguineo, string? Alergias, string? Antecedentes,
    string? ContactoEmergencia, string? TelefonoEmergencia,
    bool ConsentimientoTratamientoDatos, bool ConsentimientoUsoEntrenamiento, DateTimeOffset CreatedAt);

/// <summary>Actualización parcial: solo se modifican los campos enviados.</summary>
public sealed class ActualizarPacienteRequest
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
    [RegularExpression(Reglas.GrupoSanguineo)] public string? GrupoSanguineo { get; set; }
    [StringLength(1000)] public string? Alergias { get; set; }
    [StringLength(2000)] public string? Antecedentes { get; set; }
    [StringLength(150)] public string? ContactoEmergencia { get; set; }
    [StringLength(30)] public string? TelefonoEmergencia { get; set; }
}

public sealed class ConsentimientoRequest
{
    [Required, RegularExpression("^(tratamiento_datos|uso_entrenamiento)$")] public string Tipo { get; set; } = "";
    public bool Otorgado { get; set; }
}

public sealed record ConsentimientoDto(Guid Id, string Tipo, bool Otorgado, string VersionTexto, DateTimeOffset CreatedAt);

/// <summary>Alta de un paciente por parte de un médico (queda vinculado a ese médico).</summary>
public sealed class CrearPacienteMedicoRequest
{
    [Required, StringLength(100, MinimumLength = 2)] public string Nombres { get; set; } = "";
    [Required, StringLength(100, MinimumLength = 2)] public string Apellidos { get; set; } = "";
    [Required, EmailAddress, StringLength(254)] public string Correo { get; set; } = "";
    [Required, RegularExpression(Reglas.Password, ErrorMessage = Reglas.PasswordMensaje)] public string Password { get; set; } = "";
    [RegularExpression(Reglas.TipoDocumento)] public string? TipoDocumento { get; set; }
    [StringLength(30)] public string? NumeroDocumento { get; set; }
    public DateOnly? FechaNacimiento { get; set; }
    [RegularExpression(Reglas.Sexo)] public string? Sexo { get; set; }
    [StringLength(30)] public string? Telefono { get; set; }
    /// <summary>Debe ser true: el médico confirma que el paciente aceptó el tratamiento de sus datos.</summary>
    public bool ConfirmaConsentimientoDatos { get; set; }
}

public sealed class VincularPacienteRequest
{
    /// <summary>Código PAC-xxxxxx o número de documento del paciente.</summary>
    [Required, StringLength(30)] public string Codigo { get; set; } = "";
}
