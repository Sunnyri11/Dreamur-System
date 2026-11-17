using System.Text.Json;

namespace DreamurDetector.Api.Middleware;

/// <summary>Escribe errores como application/problem+json (RFC 9457) de forma uniforme.</summary>
public static class ProblemWriter
{
    private static readonly JsonSerializerOptions Opts = new(JsonSerializerDefaults.Web);

    public static async Task EscribirAsync(HttpContext ctx, int status, string detalle, string? codigo = null)
    {
        if (ctx.Response.HasStarted) return;

        var pd = new ProblemDetails
        {
            Status = status,
            Title = Titulo(status),
            Detail = detalle,
            Instance = ctx.Request.Path
        };
        pd.Extensions["traceId"] = ctx.TraceIdentifier;
        if (codigo is not null) pd.Extensions["code"] = codigo;

        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/problem+json";
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(pd, Opts));
    }

    private static string Titulo(int status) => status switch
    {
        400 => "Solicitud inválida",
        401 => "No autenticado",
        403 => "Acceso denegado",
        404 => "No encontrado",
        409 => "Conflicto",
        423 => "Cuenta bloqueada",
        429 => "Demasiadas solicitudes",
        502 => "Error en servicio externo",
        _ => status >= 500 ? "Error interno del servidor" : "Error"
    };
}
