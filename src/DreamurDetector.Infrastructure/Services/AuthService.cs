using System.Buffers.Text;
using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace DreamurDetector.Infrastructure.Services;

public sealed class AuthService(
    AppDbContext db,
    ITokenService tokens,
    IPasswordHasher hasher,
    IEmailSender email,
    IAuditoriaService audit,
    ICurrentUser current,
    IOptions<AuthOptions> authOptions,
    IOptions<AppOptions> appOptions,
    ILogger<AuthService> log) : IAuthService
{
    private readonly AuthOptions _auth = authOptions.Value;
    private readonly AppOptions _app = appOptions.Value;

    // ===================== REGISTRO =====================
    public async Task<AuthResponse?> RegistrarAsync(RegistroRequest req, CancellationToken ct)
    {
        if (!req.AceptaTratamientoDatos)
            throw new ReglaNegocioException("Debe aceptar el tratamiento de datos personales para crear la cuenta.");
        ValidarFechaNacimiento(req.FechaNacimiento);

        var correo = NormalizarCorreo(req.Correo);
        if (await db.Correos.AnyAsync(c => c.Correo == correo, ct))
            throw new ConflictException("Ya existe una cuenta registrada con ese correo.");

        var persona = new Persona
        {
            Nombres = req.Nombres.Trim(),
            Apellidos = req.Apellidos.Trim(),
            TipoDocumento = req.TipoDocumento,
            NumeroDocumento = string.IsNullOrWhiteSpace(req.NumeroDocumento) ? null : req.NumeroDocumento.Trim(),
            FechaNacimiento = req.FechaNacimiento,
            Sexo = req.Sexo,
            Telefono = req.Telefono
        };
        if (persona.NumeroDocumento is not null && persona.TipoDocumento is null)
            throw new ReglaNegocioException("Indique el tipo de documento junto con el número.");

        var usuario = new Usuario
        {
            PersonaId = persona.Id,
            PasswordHash = hasher.Hash(req.Password),
            Rol = Roles.Paciente,
            UltimoAcceso = DateTimeOffset.UtcNow
        };
        persona.Correos.Add(new CorreoElectronico { PersonaId = persona.Id, Correo = correo, EsPrincipal = true });
        persona.Usuario = usuario;
        foreach (var c in persona.Correos) c.UsuarioId = persona.Usuario.Id;
        persona.Paciente = new Paciente { PersonaId = persona.Id };
        db.Personas.Add(persona);

        db.Consentimientos.Add(new Consentimiento
        {
            PacienteId = persona.Id, Tipo = TiposConsentimiento.TratamientoDatos, Otorgado = true, Ip = current.Ip
        });
        db.Consentimientos.Add(new Consentimiento
        {
            PacienteId = persona.Id, Tipo = TiposConsentimiento.UsoEntrenamiento,
            Otorgado = req.AceptaUsoEntrenamiento, Ip = current.Ip
        });

        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (ex.EsViolacionUnica())
        {
            throw new ConflictException("El correo o el documento ya están registrados.");
        }

        await EnviarVerificacionAsync(usuario, persona, correo, ct);
        await audit.RegistrarAsync("registro", "usuarios", usuario.Id.ToString(), null, usuario.Id, ct);
        // Con confirmación obligatoria no se abre sesión: el paciente debe abrir el enlace que llega por correo (Brevo).
        if (_auth.RequerirCorreoVerificado) return null;
        return await EmitirSesionAsync(usuario, persona, correo, false, ct);
    }

    // ===================== LOGIN =====================
    public async Task<AuthResponse> LoginAsync(LoginRequest req, CancellationToken ct)
    {
        var correo = NormalizarCorreo(req.Correo);
        var ce = await db.Correos
            .Include(c => c.Persona).ThenInclude(p => p.Usuario)
            .FirstOrDefaultAsync(c => c.Correo == correo, ct);

        var usuario = ce?.Persona.Usuario;
        if (ce is null || usuario is null || ce.Persona.DeletedAt is not null)
        {
            hasher.Verify(req.Password, hasher.DummyHash); // iguala tiempos de respuesta
            await audit.RegistrarAsync("login_fallido", "usuarios", null, new { correo, motivo = "desconocido" }, null, ct);
            throw new NoAutenticadoException("Credenciales inválidas.");
        }

        var ahora = DateTimeOffset.UtcNow;
        if (usuario.BloqueadoHasta is { } hasta && hasta > ahora)
        {
            var minutos = Math.Max(1, (int)Math.Ceiling((hasta - ahora).TotalMinutes));
            throw new CuentaBloqueadaException($"Cuenta bloqueada por intentos fallidos. Intente de nuevo en {minutos} minuto(s).");
        }

        if (!hasher.Verify(req.Password, usuario.PasswordHash))
        {
            usuario.IntentosFallidos++;
            var bloqueada = usuario.IntentosFallidos >= _auth.MaxIntentosFallidos;
            if (bloqueada)
            {
                usuario.BloqueadoHasta = ahora.AddMinutes(_auth.BloqueoMinutos);
                usuario.IntentosFallidos = 0;
            }
            await db.SaveChangesAsync(ct);
            await audit.RegistrarAsync(bloqueada ? "cuenta_bloqueada" : "login_fallido", "usuarios",
                usuario.Id.ToString(), null, usuario.Id, ct);
            throw new NoAutenticadoException("Credenciales inválidas.");
        }

        if (!usuario.Activo) throw new ProhibidoException("La cuenta está desactivada. Contacte al administrador.");
        if (_auth.RequerirCorreoVerificado && !ce.Verificado)
            throw new CorreoNoVerificadoException();

        usuario.IntentosFallidos = 0;
        usuario.BloqueadoHasta = null;
        usuario.UltimoAcceso = ahora;
        await db.SaveChangesAsync(ct);
        await audit.RegistrarAsync("login", "usuarios", usuario.Id.ToString(), null, usuario.Id, ct);

        return await EmitirSesionAsync(usuario, ce.Persona, ce.Correo, ce.Verificado, ct);
    }

    // ===================== LOGOUT / ME =====================
    public async Task LogoutAsync(CancellationToken ct)
    {
        await RevocarSesionActualAsync(ct);
        await audit.RegistrarAsync("logout", "usuarios", current.UsuarioId?.ToString(), null, null, ct);
    }

    public async Task<UsuarioDto> MeAsync(CancellationToken ct)
    {
        var id = current.RequerirUsuarioId();
        var u = await db.Usuarios.AsNoTracking()
            .Include(x => x.Persona).ThenInclude(p => p.Correos)
            .FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NoAutenticadoException();

        var principal = u.Persona.Correos.FirstOrDefault(c => c.EsPrincipal) ?? u.Persona.Correos.FirstOrDefault();
        var roles = await RolesDisponiblesAsync(u, ct);
        var activo = current.Rol is { } r && roles.Contains(r) ? r : u.Rol;
        var codigo = roles.Contains(Roles.Paciente)
            ? await db.Pacientes.Where(p => p.PersonaId == u.PersonaId).Select(p => p.Codigo).FirstOrDefaultAsync(ct)
            : null;
        return Mapeos.ToDto(u, u.Persona, principal?.Correo, principal?.Verificado ?? false, codigo, activo, roles);
    }

    // ===================== MULTI-ROL =====================
    public async Task<AuthResponse> CambiarRolAsync(CambiarRolRequest req, CancellationToken ct)
    {
        var (u, correo, verificado) = await CargarUsuarioActualAsync(ct);
        var roles = await RolesDisponiblesAsync(u, ct);
        if (!roles.Contains(req.Rol))
            throw new ProhibidoException("Su cuenta no tiene ese perfil.");
        await RevocarSesionActualAsync(ct);
        await audit.RegistrarAsync("cambio_rol", "usuarios", u.Id.ToString(), new { de = current.Rol, a = req.Rol }, u.Id, ct);
        return await EmitirSesionAsync(u, u.Persona, correo, verificado, ct, req.Rol);
    }

    public async Task<AuthResponse> ActivarRolAsync(ActivarRolRequest req, CancellationToken ct)
    {
        var (u, correo, verificado) = await CargarUsuarioActualAsync(ct);
        var roles = await RolesDisponiblesAsync(u, ct);
        if (roles.Contains(req.Rol)) throw new ConflictException("Ya tiene ese perfil activado.");

        if (req.Rol == Roles.Paciente)
        {
            if (u.Rol == Roles.Paciente) throw new ConflictException("Ya tiene ese perfil activado.");
            if (!req.AceptaTratamientoDatos)
                throw new ReglaNegocioException("Debe aceptar el tratamiento de datos para activar el perfil de paciente.");
            db.Pacientes.Add(new Paciente { PersonaId = u.PersonaId });
            db.Consentimientos.Add(new Consentimiento
            {
                PacienteId = u.PersonaId, Tipo = TiposConsentimiento.TratamientoDatos, Otorgado = true, Ip = current.Ip
            });
            db.Consentimientos.Add(new Consentimiento
            {
                PacienteId = u.PersonaId, Tipo = TiposConsentimiento.UsoEntrenamiento,
                Otorgado = req.AceptaUsoEntrenamiento, Ip = current.Ip
            });
        }
        else // médico: solo un administrador puede tener además el perfil de médico
        {
            if (u.Rol != Roles.Admin)
                throw new ProhibidoException("Solo un administrador puede activar además el perfil de médico.");
            db.Medicos.Add(new Medico { PersonaId = u.PersonaId, Matricula = req.Matricula, Especialidad = req.Especialidad });
        }

        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (ex.EsViolacionUnica())
        {
            throw new ConflictException("La matrícula ya está registrada.");
        }
        await audit.RegistrarAsync("rol_activado", "usuarios", u.Id.ToString(), new { req.Rol }, u.Id, ct);
        await RevocarSesionActualAsync(ct);
        return await EmitirSesionAsync(u, u.Persona, correo, verificado, ct, req.Rol);
    }

    // ===================== CONTRASEÑAS =====================
    public async Task CambiarPasswordAsync(CambiarPasswordRequest req, CancellationToken ct)
    {
        var id = current.RequerirUsuarioId();
        var u = await db.Usuarios.FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NoAutenticadoException();

        if (!hasher.Verify(req.PasswordActual, u.PasswordHash))
            throw new ReglaNegocioException("La contraseña actual no es correcta.");
        if (hasher.Verify(req.PasswordNueva, u.PasswordHash))
            throw new ReglaNegocioException("La nueva contraseña debe ser distinta de la actual.");

        u.PasswordHash = hasher.Hash(req.PasswordNueva);
        await db.SaveChangesAsync(ct);
        await RevocarSesionActualAsync(ct); // obliga a iniciar sesión de nuevo
        await audit.RegistrarAsync("cambio_password", "usuarios", u.Id.ToString(), null, u.Id, ct);
    }

    public async Task SolicitarRestablecimientoAsync(OlvidePasswordRequest req, CancellationToken ct)
    {
        // Siempre responde igual (haya o no cuenta) para no revelar qué correos existen.
        var correo = NormalizarCorreo(req.Correo);
        var ce = await db.Correos
            .Include(c => c.Persona).ThenInclude(p => p.Usuario)
            .FirstOrDefaultAsync(c => c.Correo == correo, ct);
        var u = ce?.Persona.Usuario;
        if (ce is null || u is null || !u.Activo) return;

        var ahora = DateTimeOffset.UtcNow;
        var previos = await db.TokensVerificacion
            .Where(t => t.UsuarioId == u.Id && t.Tipo == TiposToken.RestablecerPassword && t.UsadoEn == null)
            .ToListAsync(ct);
        foreach (var t in previos) t.UsadoEn = ahora;

        var token = GenerarToken();
        db.TokensVerificacion.Add(new TokenVerificacion
        {
            UsuarioId = u.Id, Tipo = TiposToken.RestablecerPassword, TokenHash = HashToken(token),
            ExpiraEn = ahora.AddMinutes(_auth.RestablecerMinutos)
        });
        await db.SaveChangesAsync(ct);

        var link = $"{_app.FrontendUrl.TrimEnd('/')}/restablecer.html?token={token}";
        try
        {
            await email.EnviarAsync(ce.Correo, "Restablece tu contraseña - Dreamur-Detector",
                Plantillas.Restablecer(ce.Persona.Nombres, link, _auth.RestablecerMinutos), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "No se pudo enviar el correo de restablecimiento a {Correo}", ce.Correo);
        }
        await audit.RegistrarAsync("password_reset_solicitado", "usuarios", u.Id.ToString(), null, u.Id, ct);
    }

    public async Task RestablecerPasswordAsync(RestablecerPasswordRequest req, CancellationToken ct)
    {
        var ahora = DateTimeOffset.UtcNow;
        var hash = HashToken(req.Token.Trim());
        var t = await db.TokensVerificacion.FirstOrDefaultAsync(x =>
            x.TokenHash == hash && x.Tipo == TiposToken.RestablecerPassword && x.UsadoEn == null && x.ExpiraEn > ahora, ct)
            ?? throw new ReglaNegocioException("El enlace es inválido o ya expiró. Solicite uno nuevo.");

        var u = await db.Usuarios.FirstAsync(x => x.Id == t.UsuarioId, ct);
        u.PasswordHash = hasher.Hash(req.PasswordNueva);
        u.IntentosFallidos = 0;
        u.BloqueadoHasta = null;
        t.UsadoEn = ahora;
        await db.SaveChangesAsync(ct);
        await audit.RegistrarAsync("password_reset", "usuarios", u.Id.ToString(), null, u.Id, ct);
    }

    // ===================== VERIFICACIÓN DE CORREO =====================
    public async Task VerificarCorreoAsync(VerificarCorreoRequest req, CancellationToken ct)
    {
        var ahora = DateTimeOffset.UtcNow;
        var hash = HashToken(req.Token.Trim());
        var t = await db.TokensVerificacion.FirstOrDefaultAsync(x =>
            x.TokenHash == hash && x.Tipo == TiposToken.VerificarCorreo && x.UsadoEn == null && x.ExpiraEn > ahora, ct)
            ?? throw new ReglaNegocioException("El enlace de verificación es inválido o ya expiró.");

        var u = await db.Usuarios.Include(x => x.Persona).ThenInclude(p => p.Correos).FirstAsync(x => x.Id == t.UsuarioId, ct);
        var principal = u.Persona.Correos.FirstOrDefault(c => c.EsPrincipal) ?? u.Persona.Correos.First();
        principal.Verificado = true;
        principal.VerificadoEn = ahora;
        t.UsadoEn = ahora;
        await db.SaveChangesAsync(ct);
        await audit.RegistrarAsync("correo_verificado", "usuarios", u.Id.ToString(), null, u.Id, ct);
    }

    public async Task ReenviarVerificacionAsync(CancellationToken ct)
    {
        var id = current.RequerirUsuarioId();
        var u = await db.Usuarios.Include(x => x.Persona).ThenInclude(p => p.Correos)
            .FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NoAutenticadoException();
        var principal = u.Persona.Correos.FirstOrDefault(c => c.EsPrincipal) ?? u.Persona.Correos.First();
        if (principal.Verificado) throw new ReglaNegocioException("Su correo ya está verificado.");
        await EnviarVerificacionAsync(u, u.Persona, principal.Correo, ct);
    }

    public async Task ReenviarVerificacionPublicaAsync(ReenviarVerificacionRequest req, CancellationToken ct)
    {
        var correo = NormalizarCorreo(req.Correo);
        var ce = await db.Correos
            .Include(c => c.Persona).ThenInclude(p => p.Usuario)
            .FirstOrDefaultAsync(c => c.Correo == correo, ct);
        // Misma respuesta exista o no la cuenta (no se revela qué correos están registrados).
        if (ce is null || ce.Verificado || ce.Persona.Usuario is not { Activo: true } usuario) return;
        await EnviarVerificacionAsync(usuario, ce.Persona, ce.Correo, ct);
    }

    // ===================== Utilidades privadas =====================
    private async Task<AuthResponse> EmitirSesionAsync(Usuario u, Persona p, string correo, bool verificado, CancellationToken ct,
        string? rolActivo = null)
    {
        var roles = await RolesDisponiblesAsync(u, ct);
        var activo = rolActivo is not null && roles.Contains(rolActivo) ? rolActivo : u.Rol;
        var t = tokens.CrearAccessToken(new TokenSubject(u.Id, p.Id, activo, correo, $"{p.Nombres} {p.Apellidos}".Trim()));
        var codigo = roles.Contains(Roles.Paciente)
            ? await db.Pacientes.Where(x => x.PersonaId == p.Id).Select(x => x.Codigo).FirstOrDefaultAsync(ct)
            : null;
        var segundos = Math.Max(0, (int)(t.ExpiraEn - DateTimeOffset.UtcNow).TotalSeconds);
        return new AuthResponse(t.Token, "Bearer", t.ExpiraEn, segundos, Mapeos.ToDto(u, p, correo, verificado, codigo, activo, roles));
    }

    /// <summary>Perfiles que existen de verdad (tablas pacientes/medicos/administradores), del más alto al más bajo.</summary>
    private async Task<IReadOnlyList<string>> RolesDisponiblesAsync(Usuario u, CancellationToken ct)
    {
        var lista = new List<string>();
        if (await db.Administradores.AnyAsync(x => x.PersonaId == u.PersonaId, ct)) lista.Add(Roles.Admin);
        if (await db.Medicos.AnyAsync(x => x.PersonaId == u.PersonaId, ct)) lista.Add(Roles.Medico);
        if (await db.Pacientes.AnyAsync(x => x.PersonaId == u.PersonaId, ct)) lista.Add(Roles.Paciente);
        if (!lista.Contains(u.Rol)) lista.Insert(0, u.Rol);
        return lista;
    }

    private async Task<(Usuario U, string Correo, bool Verificado)> CargarUsuarioActualAsync(CancellationToken ct)
    {
        var id = current.RequerirUsuarioId();
        var u = await db.Usuarios.Include(x => x.Persona).ThenInclude(x => x.Correos)
            .FirstOrDefaultAsync(x => x.Id == id, ct) ?? throw new NoAutenticadoException();
        var c = u.Persona.Correos.FirstOrDefault(x => x.EsPrincipal) ?? u.Persona.Correos.FirstOrDefault();
        return (u, c?.Correo ?? "", c?.Verificado ?? false);
    }

    private async Task EnviarVerificacionAsync(Usuario u, Persona p, string correo, CancellationToken ct)
    {
        try
        {
            var token = GenerarToken();
            db.TokensVerificacion.Add(new TokenVerificacion
            {
                UsuarioId = u.Id, Tipo = TiposToken.VerificarCorreo, TokenHash = HashToken(token),
                ExpiraEn = DateTimeOffset.UtcNow.AddHours(_auth.VerificacionHoras)
            });
            await db.SaveChangesAsync(ct);
            var link = $"{_app.FrontendUrl.TrimEnd('/')}/verificar.html?token={token}";
            await email.EnviarAsync(correo, "Confirma tu cuenta - Dreamur-Detector", Plantillas.Verificacion(p.Nombres, link), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "No se pudo enviar el correo de verificación a {Correo}", correo);
        }
    }

    private async Task RevocarSesionActualAsync(CancellationToken ct)
    {
        if (current.Jti is { } jti && current.TokenExpiraEn is { } exp &&
            !await db.TokensRevocados.AnyAsync(t => t.Jti == jti, ct))
        {
            db.TokensRevocados.Add(new TokenRevocado { Jti = jti, UsuarioId = current.UsuarioId, ExpiraEn = exp });
            await db.SaveChangesAsync(ct);
        }
        // Limpieza: los jti ya vencidos no hacen falta (el JWT expirado se rechaza solo).
        var ahora = DateTimeOffset.UtcNow;
        await db.TokensRevocados.Where(t => t.ExpiraEn < ahora).ExecuteDeleteAsync(ct);
    }

    private static string NormalizarCorreo(string c) => c.Trim().ToLowerInvariant();

    private static void ValidarFechaNacimiento(DateOnly? f)
    {
        if (f is null) return;
        if (f.Value <= new DateOnly(1900, 1, 1) || f.Value > DateOnly.FromDateTime(DateTime.UtcNow))
            throw new ReglaNegocioException("La fecha de nacimiento no es válida.");
    }

    private static string GenerarToken() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));

    private static string HashToken(string token) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}

internal static class Plantillas
{
    private static string Marco(string titulo, string cuerpo) =>
        $"""
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f2937">
          <h2 style="color:#4f46e5">Dreamur-Detector</h2>
          <h3>{titulo}</h3>
          {cuerpo}
          <p style="font-size:12px;color:#6b7280">Si no solicitaste esto, ignora este mensaje.</p>
        </div>
        """;

    public static string Verificacion(string nombre, string link) =>
        Marco("Confirma tu cuenta",
            $"<p>Hola {WebUtility.HtmlEncode(nombre)}, gracias por registrarte. Confirma tu correo para activar tu cuenta e iniciar sesión.</p>" +
            $"<p><a href=\"{link}\" style=\"background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none\">Verificar correo</a></p>");

    public static string Restablecer(string nombre, string link, int minutos) =>
        Marco("Restablece tu contraseña",
            $"<p>Hola {WebUtility.HtmlEncode(nombre)}, usa este enlace para elegir una nueva contraseña. Vence en {minutos} minutos.</p>" +
            $"<p><a href=\"{link}\" style=\"background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none\">Cambiar contraseña</a></p>");
}
