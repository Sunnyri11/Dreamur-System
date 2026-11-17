namespace DreamurDetector.Infrastructure.Services;

/// <summary>Perfil del propio usuario autenticado (paciente, médico o administrador): ver y editar sus datos.</summary>
public sealed class PerfilService(AppDbContext db, ICurrentUser current, IAuditoriaService audit) : IPerfilService
{
    public async Task<PerfilDto> ObtenerAsync(CancellationToken ct)
    {
        var u = await CargarAsync(current.RequerirUsuarioId(), seguimiento: false, ct);
        return ToDto(u, Activo(u));
    }

    private string Activo(Usuario u) => current.Rol ?? u.Rol;

    public async Task<PerfilDto> ActualizarAsync(ActualizarPerfilRequest r, CancellationToken ct)
    {
        var u = await CargarAsync(current.RequerirUsuarioId(), seguimiento: true, ct);
        var per = u.Persona;
        var rolActivo = Activo(u);

        if (r.FechaNacimiento is { } fn &&
            (fn <= new DateOnly(1900, 1, 1) || fn > DateOnly.FromDateTime(DateTime.UtcNow)))
            throw new ReglaNegocioException("La fecha de nacimiento no es válida.");

        // null = no cambia; "" = borrar (solo campos opcionales).
        if (r.Nombres is not null) per.Nombres = r.Nombres.Trim();
        if (r.Apellidos is not null) per.Apellidos = r.Apellidos.Trim();
        if (r.TipoDocumento is not null) per.TipoDocumento = Texto(r.TipoDocumento);
        if (r.NumeroDocumento is not null) per.NumeroDocumento = Texto(r.NumeroDocumento);
        if (r.FechaNacimiento is not null) per.FechaNacimiento = r.FechaNacimiento;
        if (r.Sexo is not null) per.Sexo = Texto(r.Sexo);
        if (r.Telefono is not null) per.Telefono = Texto(r.Telefono);
        if (r.Direccion is not null) per.Direccion = Texto(r.Direccion);
        if (r.Ciudad is not null) per.Ciudad = Texto(r.Ciudad);
        if (r.Pais is not null) per.Pais = Texto(r.Pais)?.ToUpperInvariant();

        if (per.NumeroDocumento is not null && per.TipoDocumento is null)
            throw new ReglaNegocioException("Indique el tipo de documento junto con el número.");

        // Los campos de otro rol se ignoran.
        if (rolActivo == Roles.Paciente && per.Paciente is { } pac)
        {
            if (r.GrupoSanguineo is not null) pac.GrupoSanguineo = Texto(r.GrupoSanguineo);
            if (r.Alergias is not null) pac.Alergias = Texto(r.Alergias);
            if (r.Antecedentes is not null) pac.Antecedentes = Texto(r.Antecedentes);
            if (r.ContactoEmergencia is not null) pac.ContactoEmergencia = Texto(r.ContactoEmergencia);
            if (r.TelefonoEmergencia is not null) pac.TelefonoEmergencia = Texto(r.TelefonoEmergencia);
        }
        else if (rolActivo == Roles.Medico && per.Medico is { } med)
        {
            if (r.Matricula is not null) med.Matricula = Texto(r.Matricula);
            if (r.Especialidad is not null) med.Especialidad = Texto(r.Especialidad);
        }

        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (ex.EsViolacionUnica())
        {
            throw new ConflictException("Ya existe otra persona con ese documento o matrícula.");
        }

        await audit.RegistrarAsync("perfil_actualizado", "usuarios", u.Id.ToString(), null, null, ct);
        return ToDto(u, rolActivo);
    }

    // ---------- privados ----------
    private async Task<Usuario> CargarAsync(Guid usuarioId, bool seguimiento, CancellationToken ct)
    {
        IQueryable<Usuario> q = db.Usuarios
            .Include(x => x.Persona).ThenInclude(p => p.Correos)
            .Include(x => x.Persona).ThenInclude(p => p.Paciente)
            .Include(x => x.Persona).ThenInclude(p => p.Medico)
            .Include(x => x.Persona).ThenInclude(p => p.Administrador);
        if (!seguimiento) q = q.AsNoTracking();

        return await q.FirstOrDefaultAsync(x => x.Id == usuarioId && x.Persona.DeletedAt == null, ct)
               ?? throw new NoAutenticadoException();
    }

    private static string? Texto(string valor) => string.IsNullOrWhiteSpace(valor) ? null : valor.Trim();

    private static PerfilDto ToDto(Usuario u, string rolActivo)
    {
        var per = u.Persona;
        var correo = per.Correos.FirstOrDefault(c => c.EsPrincipal) ?? per.Correos.FirstOrDefault();
        var pac = rolActivo == Roles.Paciente ? per.Paciente : null;
        var med = rolActivo == Roles.Medico ? per.Medico : null;
        var adm = rolActivo == Roles.Admin ? per.Administrador : null;

        return new PerfilDto(
            u.Id, per.Id, rolActivo, u.Activo, u.UltimoAcceso, u.CreatedAt,
            per.Nombres, per.Apellidos, per.TipoDocumento, per.NumeroDocumento, per.FechaNacimiento,
            per.Sexo, per.Telefono, per.Direccion, per.Ciudad, per.Pais,
            correo?.Correo, correo?.Verificado ?? false,
            pac?.Codigo, pac?.GrupoSanguineo, pac?.Alergias, pac?.Antecedentes,
            pac?.ContactoEmergencia, pac?.TelefonoEmergencia,
            med?.Matricula, med?.Especialidad,
            adm?.Nivel);
    }
}
