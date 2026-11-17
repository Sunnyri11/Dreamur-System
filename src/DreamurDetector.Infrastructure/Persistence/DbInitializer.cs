using System.Reflection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace DreamurDetector.Infrastructure.Persistence;

public static class DbInitializer
{
    /// <summary>
    /// Al arrancar: aplica db/actualizar_tablas.sql (solo CREATE/ADD ... IF NOT EXISTS: no borra ni reemplaza datos,
    /// así que el entrenamiento de Dreamur-Detector se conserva) y crea el administrador inicial si no existe ninguno.
    /// </summary>
    public static async Task InicializarBaseDeDatosAsync(this IServiceProvider services, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;
        var log = sp.GetRequiredService<ILoggerFactory>().CreateLogger("DbInitializer");
        var config = sp.GetRequiredService<IConfiguration>();
        var db = sp.GetRequiredService<AppDbContext>();

        try
        {
            if (config.GetValue("Database:AplicarScriptsExtra", true))
            {
                var asm = typeof(DbInitializer).Assembly;
                var recurso = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith("actualizar_tablas.sql"));
                if (recurso is not null)
                {
                    using var reader = new StreamReader(asm.GetManifestResourceStream(recurso)!);
                    var sql = await reader.ReadToEndAsync(ct);
                    await db.Database.ExecuteSqlRawAsync(sql, ct);
                    log.LogInformation("Script db/actualizar_tablas.sql aplicado (solo crea lo que falta).");
                }
            }

            await CrearAdminInicialAsync(sp, db, log, ct);
        }
        catch (Exception ex)
        {
            log.LogCritical(ex, "No se pudo inicializar la base de datos. ¿La conexión a Neon es correcta?");
            throw;
        }
    }

    private static async Task CrearAdminInicialAsync(IServiceProvider sp, AppDbContext db, ILogger log, CancellationToken ct)
    {
        var seed = sp.GetRequiredService<IOptions<SeedOptions>>().Value;
        if (string.IsNullOrWhiteSpace(seed.AdminCorreo) || string.IsNullOrWhiteSpace(seed.AdminPassword)) return;
        if (await db.Usuarios.AnyAsync(u => u.Rol == Roles.Admin, ct)) return;

        var hasher = sp.GetRequiredService<IPasswordHasher>();
        var correo = seed.AdminCorreo.Trim().ToLowerInvariant();
        if (await db.Correos.AnyAsync(c => c.Correo == correo, ct))
        {
            log.LogWarning("Seed: el correo {Correo} ya existe y no es admin; no se crea el administrador inicial.", correo);
            return;
        }

        var persona = new Persona { Nombres = seed.AdminNombres, Apellidos = seed.AdminApellidos };
        persona.Correos.Add(new CorreoElectronico
        {
            PersonaId = persona.Id, Correo = correo, EsPrincipal = true, Verificado = true, VerificadoEn = DateTimeOffset.UtcNow
        });
        persona.Usuario = new Usuario { PersonaId = persona.Id, PasswordHash = hasher.Hash(seed.AdminPassword), Rol = Roles.Admin };
        foreach (var c in persona.Correos) c.UsuarioId = persona.Usuario.Id;
        persona.Administrador = new Administrador { PersonaId = persona.Id, Nivel = "superadmin" };
        db.Personas.Add(persona);
        await db.SaveChangesAsync(ct);
        log.LogInformation("Administrador inicial creado: {Correo}", correo);
    }
}
