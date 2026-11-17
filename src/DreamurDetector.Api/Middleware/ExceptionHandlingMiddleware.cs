namespace DreamurDetector.Api.Middleware;

/// <summary>Convierte excepciones de aplicación en respuestas HTTP coherentes; oculta detalles internos en producción.</summary>
public sealed class ExceptionHandlingMiddleware(
    RequestDelegate next,
    ILogger<ExceptionHandlingMiddleware> log,
    IHostEnvironment env)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        try
        {
            await next(ctx);
        }
        catch (AppException ex)
        {
            if (ex.StatusCode >= 500) log.LogError(ex, "Error de aplicación {Status}", ex.StatusCode);
            await ProblemWriter.EscribirAsync(ctx, ex.StatusCode, ex.Message, ex.Code);
        }
        catch (OperationCanceledException) when (ctx.RequestAborted.IsCancellationRequested)
        {
            ctx.Response.StatusCode = 499; // el cliente cerró la conexión
        }
        catch (BadHttpRequestException ex)
        {
            await ProblemWriter.EscribirAsync(ctx, ex.StatusCode, "Solicitud mal formada o demasiado grande.", "solicitud_invalida");
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Excepción no controlada en {Metodo} {Ruta}", ctx.Request.Method, ctx.Request.Path);
            await ProblemWriter.EscribirAsync(ctx, 500,
                env.IsDevelopment() ? ex.ToString() : "Ocurrió un error interno. Si persiste, informe el traceId.",
                "error_interno");
        }
    }
}
