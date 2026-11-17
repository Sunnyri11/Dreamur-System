using System.ComponentModel.DataAnnotations;

namespace DreamurDetector.Application.Dtos;

public static class Reglas
{
    public const string Password = @"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,100}$";
    public const string PasswordMensaje = "La contraseña debe tener entre 8 y 100 caracteres, con mayúscula, minúscula y número.";
    public const string TipoDocumento = "^(CI|DNI|PASAPORTE|OTRO)$";
    public const string Sexo = "^(F|M|otro|no_indica)$";
    public const string GrupoSanguineo = @"^(A|B|AB|O)[+-]$";
}

public sealed class RegistroRequest
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
    /// <summary>Obligatorio: consentimiento de tratamiento de datos.</summary>
    public bool AceptaTratamientoDatos { get; set; }
    /// <summary>Opcional: permite usar sus imágenes etiquetadas para reentrenar el modelo.</summary>
    public bool AceptaUsoEntrenamiento { get; set; }
}

public sealed class LoginRequest
{
    [Required, EmailAddress] public string Correo { get; set; } = "";
    [Required] public string Password { get; set; } = "";
}

public sealed class CambiarPasswordRequest
{
    [Required] public string PasswordActual { get; set; } = "";
    [Required, RegularExpression(Reglas.Password, ErrorMessage = Reglas.PasswordMensaje)] public string PasswordNueva { get; set; } = "";
}

public sealed class OlvidePasswordRequest
{
    [Required, EmailAddress] public string Correo { get; set; } = "";
}

public sealed class RestablecerPasswordRequest
{
    [Required] public string Token { get; set; } = "";
    [Required, RegularExpression(Reglas.Password, ErrorMessage = Reglas.PasswordMensaje)] public string PasswordNueva { get; set; } = "";
}

public sealed class ReenviarVerificacionRequest
{
    [Required, EmailAddress, StringLength(254)] public string Correo { get; set; } = "";
}

public sealed class VerificarCorreoRequest
{
    [Required] public string Token { get; set; } = "";
}

public sealed record UsuarioDto(
    Guid Id, Guid PersonaId, string Nombres, string Apellidos, string? Correo, bool CorreoVerificado,
    string Rol, bool Activo, DateTimeOffset? UltimoAcceso, string? CodigoPaciente,
    IReadOnlyList<string>? Roles = null);

public sealed class CambiarRolRequest
{
    [Required, RegularExpression("^(paciente|medico|admin)$")] public string Rol { get; set; } = "";
}

public sealed class ActivarRolRequest
{
    [Required, RegularExpression("^(paciente|medico)$", ErrorMessage = "Solo se puede activar el perfil de paciente o de médico.")]
    public string Rol { get; set; } = "";
    [StringLength(60)] public string? Matricula { get; set; }
    [StringLength(120)] public string? Especialidad { get; set; }
    public bool AceptaTratamientoDatos { get; set; }
    public bool AceptaUsoEntrenamiento { get; set; }
}

public sealed record AuthResponse(
    string AccessToken, string TokenType, DateTimeOffset ExpiraEn, int ExpiraEnSegundos, UsuarioDto Usuario);
