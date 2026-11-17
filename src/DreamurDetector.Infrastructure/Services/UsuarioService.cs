namespace DreamurDetector.Infrastructure.Services;

public sealed class UsuarioService(
    AppDbContext db,
    IPasswordHasher hasher,
    ICurrentUser current,
    IAuditoriaService audit) : IUsuarioService
{
    public async Task<PagedResult<UsuarioDto>> ListarAsync(UsuarioFiltro f, CancellationToken ct)
    {
        var q = db.Usuarios.AsNoTracking().Where(u => u.Persona.DeletedAt == null);
        if (!string.IsNullOrWhiteSpace(f.Rol)) q = q.Where(u => u.Rol == f.Rol);
        if (f.Activo is not null) q = q.Where(u => u.Activo == f.Activo);
        if (!string.IsNullOrWhiteSpace(f.Buscar))
        {
            var patron = DbExtensions.PatronILike(f.Buscar);
            q = q.Where(u =>
                EF.Functions.ILike(u.Persona.Nombres + " " + u.Persona.Apellidos, patron) ||
                u.Persona.Correos.Any(c => EF.Functions.ILike(c.Correo, patron)));
        }

        var page = await q
            .Include(u => u.Persona).ThenInclude(p => p.Correos)
            .OrderBy(u => u.Persona.Apellidos).ThenBy(u => u.Persona.Nombres)
            .PaginarAsync(f.Pagina, f.TamanoPagina, ct);
        return page.Mapear(ToDto);
    }

    public async Task<UsuarioDto> CrearAsync(CrearUsuarioRequest req, CancellationToken ct)
    {
        var correo = req.Correo.Trim().ToLowerInvariant();
        if (await db.Correos.AnyAsync(c => c.Correo == correo, ct))
            throw new ConflictException("Ya existe una cuenta registrada con ese correo.");
        if (!string.IsNullOrWhiteSpace(req.NumeroDocumento) && req.TipoDocumento is null)
            throw new ReglaNegocioException("Indique el tipo de documento junto con el número.");

        var persona = new Persona
        {
            Nombres = req.Nombres.Trim(), Apellidos = req.Apellidos.Trim(),
            TipoDocumento = req.TipoDocumento,
            NumeroDocumento = string.IsNullOrWhiteSpace(req.NumeroDocumento) ? null : req.NumeroDocumento.Trim(),
            Telefono = req.Telefono
        };
        persona.Correos.Add(new CorreoElectronico
        {
            PersonaId = persona.Id, Correo = correo, EsPrincipal = true, Verificado = true, VerificadoEn = DateTimeOffset.UtcNow
        });
        persona.Usuario = new Usuario { PersonaId = persona.Id, PasswordHash = hasher.Hash(req.Password), Rol = req.Rol };
        foreach (var c in persona.Correos) c.UsuarioId = persona.Usuario.Id;

        if (req.Rol == Roles.Medico)
            persona.Medico = new Medico { PersonaId = persona.Id, Matricula = req.Matricula, Especialidad = req.Especialidad };
        else
            persona.Administrador = new Administrador { PersonaId = persona.Id, Nivel = req.NivelAdmin ?? "admin" };

        db.Personas.Add(persona);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (ex.EsViolacionUnica())
        {
            throw new ConflictException("El correo, documento o matrícula ya están registrados.");
        }

        await audit.RegistrarAsync("usuario_creado", "usuarios", persona.Usuario.Id.ToString(), new { req.Rol }, null, ct);
        return Mapeos.ToDto(persona.Usuario, persona, correo, true);
    }

    public async Task<UsuarioDto> CambiarEstadoAsync(Guid usuarioId, bool activo, CancellationToken ct)
    {
        if (!activo && usuarioId == current.UsuarioId)
            throw new ReglaNegocioException("No puede desactivar su propia cuenta.");

        var u = await Cargar(usuarioId, ct);
        u.Activo = activo;
        await db.SaveChangesAsync(ct);
        await audit.RegistrarAsync(activo ? "usuario_activado" : "usuario_desactivado", "usuarios", usuarioId.ToString(), null, null, ct);
        return ToDto(u);
    }

    public async Task<UsuarioDto> DesbloquearAsync(Guid usuarioId, CancellationToken ct)
    {
        var u = await Cargar(usuarioId, ct);
        u.IntentosFallidos = 0;
        u.BloqueadoHasta = null;
        await db.SaveChangesAsync(ct);
        await audit.RegistrarAsync("usuario_desbloqueado", "usuarios", usuarioId.ToString(), null, null, ct);
        return ToDto(u);
    }

    private async Task<Usuario> Cargar(Guid id, CancellationToken ct) =>
        await db.Usuarios.Include(u => u.Persona).ThenInclude(p => p.Correos)
            .FirstOrDefaultAsync(u => u.Id == id && u.Persona.DeletedAt == null, ct)
        ?? throw new NotFoundException("Usuario no encontrado.");

    private static UsuarioDto ToDto(Usuario u)
    {
        var principal = u.Persona.Correos.FirstOrDefault(c => c.EsPrincipal) ?? u.Persona.Correos.FirstOrDefault();
        return Mapeos.ToDto(u, u.Persona, principal?.Correo, principal?.Verificado ?? false);
    }
}
