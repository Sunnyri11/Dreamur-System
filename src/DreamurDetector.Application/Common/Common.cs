using System.ComponentModel.DataAnnotations;

namespace DreamurDetector.Application.Common;

// ---------- Excepciones de aplicación (las traduce ExceptionHandlingMiddleware) ----------

public class AppException(int statusCode, string message, string? code = null, Exception? inner = null)
    : Exception(message, inner)
{
    public int StatusCode { get; } = statusCode;
    public string? Code { get; } = code;
}

public sealed class NotFoundException(string message) : AppException(404, message, "no_encontrado");
public sealed class ConflictException(string message) : AppException(409, message, "conflicto");
public sealed class ReglaNegocioException(string message) : AppException(400, message, "regla_negocio");
public sealed class NoAutenticadoException(string message = "No autenticado.") : AppException(401, message, "no_autenticado");
public sealed class ProhibidoException(string message = "No tiene permisos para realizar esta acción.") : AppException(403, message, "prohibido");
public sealed class CorreoNoVerificadoException(string message = "Debe confirmar su correo electrónico antes de iniciar sesión.")
    : AppException(403, message, "correo_no_verificado");
public sealed class CuentaBloqueadaException(string message) : AppException(423, message, "cuenta_bloqueada");
public sealed class ServicioExternoException(string message, Exception? inner = null) : AppException(502, message, "servicio_externo", inner);

// ---------- Usuario actual (lo implementa la capa Api leyendo el JWT) ----------

public interface ICurrentUser
{
    bool EstaAutenticado { get; }
    Guid? UsuarioId { get; }
    Guid? PersonaId { get; }
    string? Rol { get; }
    string? Jti { get; }
    DateTimeOffset? TokenExpiraEn { get; }
    string? Ip { get; }

    bool EsAdmin => Rol == Domain.Roles.Admin;
    bool EsStaff => Rol is Domain.Roles.Medico or Domain.Roles.Admin;

    Guid RequerirUsuarioId() => UsuarioId ?? throw new NoAutenticadoException();
    Guid RequerirPersonaId() => PersonaId ?? throw new NoAutenticadoException();
}

// ---------- Paginación ----------

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Pagina, int TamanoPagina, int Total)
{
    public int TotalPaginas => TamanoPagina <= 0 ? 0 : (int)Math.Ceiling(Total / (double)TamanoPagina);
}

public class PaginacionQuery
{
    [Range(1, int.MaxValue)] public int Pagina { get; set; } = 1;
    [Range(1, 100)] public int TamanoPagina { get; set; } = 20;
}

public sealed record MensajeResponse(string Mensaje);
