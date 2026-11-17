using System.Text;
using System.Threading.RateLimiting;
using DreamurDetector.Api.Middleware;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Authorization;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;

namespace DreamurDetector.Api.Extensions;

public static class ServiceCollectionExtensions
{
    // ------------------------------------------------------------------ Controllers
    public static IServiceCollection AddApiControllers(this IServiceCollection services)
    {
        services.AddControllers(o =>
        {
            // Seguro por defecto: todo endpoint exige sesión salvo que lleve [AllowAnonymous].
            var politica = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
            o.Filters.Add(new AuthorizeFilter(politica));
        });
        return services;
    }

    // ------------------------------------------------------------------ JWT
    public static IServiceCollection AddJwtAuthentication(this IServiceCollection services, IConfiguration config)
    {
        var jwt = config.GetSection(JwtOptions.Seccion).Get<JwtOptions>() ?? new JwtOptions();
        if (string.IsNullOrWhiteSpace(jwt.Key) || Encoding.UTF8.GetByteCount(jwt.Key) < 32)
            throw new InvalidOperationException(
                "Jwt:Key es obligatoria y debe tener al menos 32 caracteres (variable de entorno Jwt__Key).");

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(o =>
            {
                o.MapInboundClaims = false; // conserva los nombres cortos: sub, role, jti...
                o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = jwt.Issuer,
                    ValidateAudience = true,
                    ValidAudience = jwt.Audience,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.Zero, // el token vence exactamente a las 4 h
                    NameClaimType = "name",
                    RoleClaimType = "role"
                };
                o.Events = new JwtBearerEvents
                {
                    // Rechaza tokens de usuarios desactivados o con logout.
                    OnTokenValidated = async ctx =>
                    {
                        var sub = ctx.Principal?.FindFirst("sub")?.Value;
                        var jti = ctx.Principal?.FindFirst("jti")?.Value;
                        var validador = ctx.HttpContext.RequestServices.GetRequiredService<ISesionValidator>();
                        if (!Guid.TryParse(sub, out var usuarioId) || string.IsNullOrEmpty(jti) ||
                            !await validador.EsValidaAsync(usuarioId, jti, ctx.HttpContext.RequestAborted))
                        {
                            ctx.Fail("Sesión cerrada o usuario inactivo.");
                        }
                    },
                    OnChallenge = async ctx =>
                    {
                        ctx.HandleResponse();
                        await ProblemWriter.EscribirAsync(ctx.HttpContext, 401,
                            "Token ausente, inválido o vencido. Inicie sesión nuevamente.", "no_autenticado");
                    },
                    OnForbidden = ctx =>
                        ProblemWriter.EscribirAsync(ctx.HttpContext, 403,
                            "No tiene permisos para realizar esta acción.", "prohibido")
                };
            });

        services.AddAuthorization();
        return services;
    }

    // ------------------------------------------------------------------ CORS
    public static IServiceCollection AddCorsPolicy(this IServiceCollection services, IConfiguration config)
    {
        // CORS PÚBLICO por defecto: cualquier página puede llamar a la API.
        // Es seguro aquí porque la autenticación va en el encabezado Authorization (JWT), no en cookies:
        // un sitio ajeno no puede usar la sesión de nadie sin tener el token.
        // Para restringirlo: Cors__Restringir=true y Cors__Origins=https://a.com,https://b.com
        var restringir = config.GetValue("Cors:Restringir", false);
        var origenes = (config["Cors:Origins"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        services.AddCors(o => o.AddPolicy("Default", p =>
        {
            if (restringir && origenes.Length > 0 && !origenes.Contains("*")) p.WithOrigins(origenes);
            else p.AllowAnyOrigin();
            p.AllowAnyHeader().AllowAnyMethod()
             .WithExposedHeaders("X-Correlation-Id", "Content-Disposition")
             .SetPreflightMaxAge(TimeSpan.FromHours(1));
        }));
        return services;
    }

    // ------------------------------------------------------------------ Rate limiting
    public static IServiceCollection AddApiRateLimiting(this IServiceCollection services)
    {
        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.OnRejected = async (ctx, ct) =>
                await ProblemWriter.EscribirAsync(ctx.HttpContext, 429,
                    "Demasiadas solicitudes. Espere un momento e intente de nuevo.", "limite_excedido");

            // Límite general por IP.
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
                RateLimitPartition.GetFixedWindowLimiter(Ip(ctx), _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 200, Window = TimeSpan.FromMinutes(1), QueueLimit = 0
                }));

            // Más estricto para login / registro / recuperación de contraseña (fuerza bruta).
            o.AddPolicy("auth", ctx =>
                RateLimitPartition.GetFixedWindowLimiter(Ip(ctx), _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0
                }));
        });
        return services;
    }

    private static string Ip(HttpContext ctx) => ctx.Connection.RemoteIpAddress?.ToString() ?? "desconocida";

    // ------------------------------------------------------------------ Swagger
    public static IServiceCollection AddSwaggerDocs(this IServiceCollection services)
    {
        services.AddEndpointsApiExplorer();
        services.AddSwaggerGen(c =>
        {
            c.SwaggerDoc("v1", new OpenApiInfo
            {
                Title = "Dreamur-Detector API",
                Version = "v1",
                Description =
                    "Backend de apoyo a la detección de tumores cerebrales (MRI/TC). " +
                    "Para probar: POST /api/auth/login, copie el accessToken (válido 4 horas) y pulse «Authorize»."
            });

            c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
            {
                Type = SecuritySchemeType.Http,
                Scheme = "bearer",
                BearerFormat = "JWT",
                In = ParameterLocation.Header,
                Name = "Authorization",
                Description = "Pegue solo el token JWT (sin la palabra Bearer)."
            });
            c.AddSecurityRequirement(document => new OpenApiSecurityRequirement
            {
                [new OpenApiSecuritySchemeReference("Bearer", document)] = []
            });

            foreach (var xml in Directory.GetFiles(AppContext.BaseDirectory, "DreamurDetector.*.xml"))
                c.IncludeXmlComments(xml, includeControllerXmlComments: true);
        });
        return services;
    }
}
