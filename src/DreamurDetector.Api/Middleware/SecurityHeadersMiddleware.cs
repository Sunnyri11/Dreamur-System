namespace DreamurDetector.Api.Middleware;

/// <summary>Cabeceras de seguridad básicas. Datos médicos: las respuestas de /api nunca se cachean.</summary>
public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext ctx)
    {
        ctx.Response.OnStarting(() =>
        {
            var h = ctx.Response.Headers;
            h["X-Content-Type-Options"] = "nosniff";
            h["X-Frame-Options"] = "DENY";
            h["Referrer-Policy"] = "no-referrer";
            if (ctx.Request.Path.StartsWithSegments("/api"))
            {
                h["Cache-Control"] = "no-store";
                h["Pragma"] = "no-cache";
            }
            return Task.CompletedTask;
        });
        return next(ctx);
    }
}
