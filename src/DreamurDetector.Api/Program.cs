using DreamurDetector.Api.Extensions;
using DreamurDetector.Api.Middleware;
using DreamurDetector.Api.Security;
using DreamurDetector.Infrastructure;
using DreamurDetector.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Render (y la mayoría de PaaS) inyecta el puerto en la variable PORT.
var puerto = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(puerto))
    builder.WebHost.UseUrls($"http://0.0.0.0:{puerto}");

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddApiControllers();
builder.Services.AddJwtAuthentication(builder.Configuration);
builder.Services.AddCorsPolicy(builder.Configuration);
builder.Services.AddApiRateLimiting();
builder.Services.AddSwaggerDocs();

var app = builder.Build();

// Crea tokens_revocados + catálogo (idempotente) y el administrador inicial (Seed:*).
await app.Services.InicializarBaseDeDatosAsync();

app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<SecurityHeadersMiddleware>();

if (app.Configuration.GetValue("Swagger:Habilitado", true))
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "Dreamur-Detector API v1");
        c.RoutePrefix = "swagger";
        c.DocumentTitle = "Dreamur-Detector API";
        c.EnablePersistAuthorization();
        c.DisplayRequestDuration();
    });
}

app.UseCors("Default");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.MapGet("/", () => Results.Redirect("/swagger")).AllowAnonymous().ExcludeFromDescription();

// Liveness: no toca la base de datos (así los health checks de Render no mantienen despierto a Neon).
app.MapGet("/health", () => Results.Ok(new { status = "ok", time = DateTimeOffset.UtcNow }))
    .AllowAnonymous().WithTags("Sistema");

// Readiness: verifica la conexión a Neon.
app.MapGet("/health/ready", async (AppDbContext db, CancellationToken ct) =>
{
    var ok = await db.Database.CanConnectAsync(ct);
    return ok
        ? Results.Ok(new { status = "ok", database = "ok" })
        : Results.Json(new { status = "degraded", database = "down" }, statusCode: StatusCodes.Status503ServiceUnavailable);
}).AllowAnonymous().WithTags("Sistema");

app.Run();
