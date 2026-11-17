using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using DreamurDetector.Infrastructure.Email;
using DreamurDetector.Infrastructure.External;
using DreamurDetector.Infrastructure.Security;
using DreamurDetector.Infrastructure.Services;
using DreamurDetector.Infrastructure.Storage;

namespace DreamurDetector.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        // ---- Opciones ----
        services.AddOptions<JwtOptions>().Bind(config.GetSection(JwtOptions.Seccion))
            .Validate(o => !string.IsNullOrWhiteSpace(o.Key) && Encoding.UTF8.GetByteCount(o.Key) >= 32,
                "Jwt:Key es obligatoria y debe tener al menos 32 caracteres (variable de entorno Jwt__Key).")
            .Validate(o => o.ExpiraMinutos is > 0 and <= 1440, "Jwt:ExpiraMinutos debe estar entre 1 y 1440.")
            .ValidateOnStart();
        services.Configure<AuthOptions>(config.GetSection(AuthOptions.Seccion));
        services.Configure<AppOptions>(config.GetSection(AppOptions.Seccion));
        services.Configure<StorageOptions>(config.GetSection(StorageOptions.Seccion));
        services.Configure<DetectorOptions>(config.GetSection(DetectorOptions.Seccion));
        services.Configure<SeedOptions>(config.GetSection(SeedOptions.Seccion));
        services.Configure<EmailOptions>(config.GetSection(EmailOptions.Seccion));

        // ---- Base de datos (Neon / PostgreSQL) ----
        services.AddDbContext<AppDbContext>(o =>
            o.UseNpgsql(ConnectionStringHelper.Resolve(config), npg => npg.EnableRetryOnFailure(3)));

        // ---- Seguridad ----
        services.AddSingleton<IPasswordHasher, Pbkdf2PasswordHasher>();
        services.AddSingleton<ITokenService, JwtTokenService>();
        services.AddScoped<ISesionValidator, SesionValidator>();

        // ---- Servicios de aplicación ----
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IPacienteService, PacienteService>();
        services.AddScoped<IRadiografiaService, RadiografiaService>();
        services.AddScoped<IDeteccionService, DeteccionService>();
        services.AddScoped<IEtiquetaService, EtiquetaService>();
        services.AddScoped<IModeloService, ModeloService>();
        services.AddScoped<IUsuarioService, UsuarioService>();
        services.AddScoped<IAuditoriaService, AuditoriaService>();
        services.AddScoped<ICatalogoService, CatalogoService>();
        services.AddScoped<IPerfilService, PerfilService>();
        services.AddScoped<IMedicoService, MedicoService>();
        services.AddScoped<IEvolucionService, EvolucionService>();

        // ---- Almacenamiento de imágenes ----
        if (string.Equals(config["Storage:Provider"], "S3", StringComparison.OrdinalIgnoreCase))
            services.AddSingleton<IStorageService, S3StorageService>();
        else
            services.AddSingleton<IStorageService, LocalStorageService>();

        // ---- Correo ----
        // Prioridad: Brevo (API HTTPS) > SMTP > solo log (desarrollo).
        if (!string.IsNullOrWhiteSpace(config["Email:BrevoApiKey"]))
            services.AddHttpClient<IEmailSender, BrevoEmailSender>(http => http.Timeout = TimeSpan.FromSeconds(20));
        else if (!string.IsNullOrWhiteSpace(config["Email:Host"]))
            services.AddSingleton<IEmailSender, SmtpEmailSender>();
        else
            services.AddSingleton<IEmailSender, LogEmailSender>();

        // ---- Servicio ML (Dreamur-Detector) ----
        services.AddHttpClient<IDetectorClient, DetectorClient>((sp, http) =>
        {
            var o = sp.GetRequiredService<IOptions<DetectorOptions>>().Value;
            http.BaseAddress = new Uri(o.BaseUrl.TrimEnd('/') + "/");
            http.Timeout = TimeSpan.FromSeconds(o.TimeoutSegundos);
            if (!string.IsNullOrWhiteSpace(o.ApiKey)) http.DefaultRequestHeaders.Add("X-Api-Key", o.ApiKey);
        });

        return services;
    }
}
