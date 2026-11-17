namespace DreamurDetector.Infrastructure.Services;

public sealed class PacienteService(
    AppDbContext db,
    ICurrentUser current,
    IAuditoriaService audit,
    IPasswordHasher hasher) : IPacienteService
{
    public async Task<PagedResult<PacienteResumenDto>> ListarAsync(PacienteFiltro f, CancellationToken ct)
    {
        var q = db.Pacientes.AsNoTracking().Where(p => p.Persona.DeletedAt == null);

        // Médico: solo sus pacientes vinculados. Admin: todos.
        if (current.Rol == Roles.Medico)
        {
            var medicoId = current.RequerirPersonaId();
            q = q.Where(p => db.MedicoPacientes.Any(mp => mp.MedicoId == medicoId && mp.PacienteId == p.PersonaId));
        }

        if (!string.IsNullOrWhiteSpace(f.Buscar))
        {
            var patron = DbExtensions.PatronILike(f.Buscar);
            q = q.Where(p =>
                EF.Functions.ILike(p.Persona.Nombres + " " + p.Persona.Apellidos, patron) ||
                EF.Functions.ILike(p.Codigo, patron) ||
                (p.Persona.NumeroDocumento != null && EF.Functions.ILike(p.Persona.NumeroDocumento, patron)));
        }

        return await q.OrderBy(p => p.Persona.Apellidos).ThenBy(p => p.Persona.Nombres)
            .Select(p => new PacienteResumenDto(
                p.PersonaId, p.Codigo, p.Persona.Nombres, p.Persona.Apellidos, p.Persona.NumeroDocumento,
                p.Persona.Correos.Where(c => c.EsPrincipal).Select(c => c.Correo).FirstOrDefault(),
                p.Persona.Telefono, p.CreatedAt,
                p.Persona.Usuario != null ? (Guid?)p.Persona.Usuario.Id : null,
                p.Persona.Usuario != null ? (bool?)p.Persona.Usuario.Activo : null))
            .PaginarAsync(f.Pagina, f.TamanoPagina, ct);
    }

    public async Task<PacienteDto> ObtenerAsync(Guid personaId, CancellationToken ct)
    {
        await ValidarAccesoAsync(personaId, ct);
        var p = await db.Pacientes.AsNoTracking()
            .Include(x => x.Persona).ThenInclude(x => x.Correos)
            .FirstOrDefaultAsync(x => x.PersonaId == personaId && x.Persona.DeletedAt == null, ct)
            ?? throw new NotFoundException("Paciente no encontrado.");
        return await ToDtoAsync(p, ct);
    }

    public async Task<PacienteDto> ActualizarAsync(Guid personaId, ActualizarPacienteRequest r, CancellationToken ct)
    {
        // El administrador solo edita su propio perfil (PATCH /api/perfil); el resto de roles, según su acceso.
        if (current.EsAdmin)
            throw new ProhibidoException("El administrador solo puede editar su propio perfil.");
        await ValidarAccesoAsync(personaId, ct);

        var p = await db.Pacientes
            .Include(x => x.Persona).ThenInclude(x => x.Correos)
            .FirstOrDefaultAsync(x => x.PersonaId == personaId && x.Persona.DeletedAt == null, ct)
            ?? throw new NotFoundException("Paciente no encontrado.");

        if (r.FechaNacimiento is { } fn &&
            (fn <= new DateOnly(1900, 1, 1) || fn > DateOnly.FromDateTime(DateTime.UtcNow)))
            throw new ReglaNegocioException("La fecha de nacimiento no es válida.");

        var per = p.Persona;
        if (r.Nombres is not null) per.Nombres = r.Nombres.Trim();
        if (r.Apellidos is not null) per.Apellidos = r.Apellidos.Trim();
        if (r.TipoDocumento is not null) per.TipoDocumento = r.TipoDocumento;
        if (r.NumeroDocumento is not null) per.NumeroDocumento = string.IsNullOrWhiteSpace(r.NumeroDocumento) ? null : r.NumeroDocumento.Trim();
        if (r.FechaNacimiento is not null) per.FechaNacimiento = r.FechaNacimiento;
        if (r.Sexo is not null) per.Sexo = r.Sexo;
        if (r.Telefono is not null) per.Telefono = r.Telefono;
        if (r.Direccion is not null) per.Direccion = r.Direccion;
        if (r.Ciudad is not null) per.Ciudad = r.Ciudad;
        if (r.Pais is not null) per.Pais = r.Pais.ToUpperInvariant();
        if (r.GrupoSanguineo is not null) p.GrupoSanguineo = r.GrupoSanguineo;
        if (r.Alergias is not null) p.Alergias = r.Alergias;
        if (r.Antecedentes is not null) p.Antecedentes = r.Antecedentes;
        if (r.ContactoEmergencia is not null) p.ContactoEmergencia = r.ContactoEmergencia;
        if (r.TelefonoEmergencia is not null) p.TelefonoEmergencia = r.TelefonoEmergencia;

        if (per.NumeroDocumento is not null && per.TipoDocumento is null)
            throw new ReglaNegocioException("Indique el tipo de documento junto con el número.");

        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (ex.EsViolacionUnica())
        {
            throw new ConflictException("Ya existe otra persona con ese documento.");
        }

        await audit.RegistrarAsync("paciente_actualizado", "pacientes", personaId.ToString(), null, null, ct);
        return await ToDtoAsync(p, ct);
    }

    public async Task<IReadOnlyList<ConsentimientoDto>> ListarConsentimientosAsync(Guid personaId, CancellationToken ct)
    {
        await ValidarAccesoAsync(personaId, ct);
        return await db.Consentimientos.AsNoTracking()
            .Where(c => c.PacienteId == personaId)
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new ConsentimientoDto(c.Id, c.Tipo, c.Otorgado, c.VersionTexto, c.CreatedAt))
            .ToListAsync(ct);
    }

    public async Task<ConsentimientoDto> RegistrarConsentimientoAsync(ConsentimientoRequest r, CancellationToken ct)
    {
        if (current.Rol != Roles.Paciente)
            throw new ProhibidoException("Solo el propio paciente puede registrar sus consentimientos.");
        var pacienteId = current.RequerirPersonaId();
        if (!await db.Pacientes.AnyAsync(p => p.PersonaId == pacienteId, ct))
            throw new NotFoundException("Paciente no encontrado.");

        var c = new Consentimiento { PacienteId = pacienteId, Tipo = r.Tipo, Otorgado = r.Otorgado, Ip = current.Ip };
        db.Consentimientos.Add(c);
        await db.SaveChangesAsync(ct);
        await audit.RegistrarAsync("consentimiento", "consentimientos", c.Id.ToString(),
            new { r.Tipo, r.Otorgado }, null, ct);
        return new ConsentimientoDto(c.Id, c.Tipo, c.Otorgado, c.VersionTexto, c.CreatedAt);
    }

    // ---------- Médico <-> paciente ----------
    public async Task<PacienteDto> CrearPorMedicoAsync(CrearPacienteMedicoRequest r, CancellationToken ct)
    {
        if (current.Rol != Roles.Medico)
            throw new ProhibidoException("Solo un médico puede registrar pacientes desde su panel.");
        if (!r.ConfirmaConsentimientoDatos)
            throw new ReglaNegocioException("Debe confirmar que el paciente aceptó el tratamiento de sus datos personales.");
        var medicoId = current.RequerirPersonaId();

        if (r.FechaNacimiento is { } fn &&
            (fn <= new DateOnly(1900, 1, 1) || fn > DateOnly.FromDateTime(DateTime.UtcNow)))
            throw new ReglaNegocioException("La fecha de nacimiento no es válida.");
        var numeroDoc = string.IsNullOrWhiteSpace(r.NumeroDocumento) ? null : r.NumeroDocumento.Trim();
        if (numeroDoc is not null && r.TipoDocumento is null)
            throw new ReglaNegocioException("Indique el tipo de documento junto con el número.");

        var correo = r.Correo.Trim().ToLowerInvariant();
        if (await db.Correos.AnyAsync(c => c.Correo == correo, ct))
            throw new ConflictException("Ya existe una cuenta registrada con ese correo.");

        var persona = new Persona
        {
            Nombres = r.Nombres.Trim(),
            Apellidos = r.Apellidos.Trim(),
            TipoDocumento = r.TipoDocumento,
            NumeroDocumento = numeroDoc,
            FechaNacimiento = r.FechaNacimiento,
            Sexo = r.Sexo,
            Telefono = r.Telefono
        };
        persona.Correos.Add(new CorreoElectronico
        {
            PersonaId = persona.Id, Correo = correo, EsPrincipal = true, Verificado = true, VerificadoEn = DateTimeOffset.UtcNow
        });
        persona.Usuario = new Usuario { PersonaId = persona.Id, PasswordHash = hasher.Hash(r.Password), Rol = Roles.Paciente };
        foreach (var c in persona.Correos) c.UsuarioId = persona.Usuario.Id;
        persona.Paciente = new Paciente { PersonaId = persona.Id };
        db.Personas.Add(persona);

        db.Consentimientos.Add(new Consentimiento
        {
            PacienteId = persona.Id, Tipo = TiposConsentimiento.TratamientoDatos, Otorgado = true, Ip = current.Ip
        });
        db.Consentimientos.Add(new Consentimiento
        {
            PacienteId = persona.Id, Tipo = TiposConsentimiento.UsoEntrenamiento, Otorgado = false, Ip = current.Ip
        });
        db.MedicoPacientes.Add(new MedicoPaciente { MedicoId = medicoId, PacienteId = persona.Id });

        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (ex.EsViolacionUnica())
        {
            throw new ConflictException("El correo o el documento ya están registrados.");
        }

        await audit.RegistrarAsync("paciente_creado_por_medico", "pacientes", persona.Id.ToString(), null, null, ct);
        return await ObtenerAsync(persona.Id, ct);
    }

    public async Task<PacienteDto> VincularAsync(VincularPacienteRequest r, CancellationToken ct)
    {
        if (current.Rol != Roles.Medico)
            throw new ProhibidoException("Solo un médico puede vincular pacientes.");
        var medicoId = current.RequerirPersonaId();

        var valor = r.Codigo.Trim();
        var valorMayus = valor.ToUpperInvariant();
        var encontrados = await db.Pacientes.AsNoTracking()
            .Where(p => p.Persona.DeletedAt == null &&
                        (p.Codigo == valorMayus ||
                         (p.Persona.NumeroDocumento != null && p.Persona.NumeroDocumento.ToUpper() == valorMayus)))
            .Select(p => p.PersonaId)
            .Take(2)
            .ToListAsync(ct);

        if (encontrados.Count == 0)
            throw new NotFoundException("No se encontró un paciente con ese código o documento.");
        if (encontrados.Count > 1)
            throw new ReglaNegocioException("Varios pacientes comparten ese documento. Use el código PAC-xxxxxx.");
        var pacienteId = encontrados[0];

        if (!await db.MedicoPacientes.AnyAsync(x => x.MedicoId == medicoId && x.PacienteId == pacienteId, ct))
        {
            db.MedicoPacientes.Add(new MedicoPaciente { MedicoId = medicoId, PacienteId = pacienteId });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (ex.EsViolacionUnica())
            {
                // Vínculo creado en paralelo: es idempotente, no hay nada más que hacer.
            }
            await audit.RegistrarAsync("paciente_vinculado", "pacientes", pacienteId.ToString(), null, null, ct);
        }

        return await ObtenerAsync(pacienteId, ct);
    }

    public async Task DesvincularAsync(Guid pacienteId, CancellationToken ct)
    {
        if (current.Rol != Roles.Medico)
            throw new ProhibidoException("Solo un médico puede desvincular pacientes.");
        var medicoId = current.RequerirPersonaId();

        var borrados = await db.MedicoPacientes
            .Where(x => x.MedicoId == medicoId && x.PacienteId == pacienteId)
            .ExecuteDeleteAsync(ct);
        if (borrados == 0) throw new NotFoundException("El paciente no está vinculado a su cuenta.");

        await audit.RegistrarAsync("paciente_desvinculado", "pacientes", pacienteId.ToString(), null, null, ct);
    }

    // ---------- privados ----------
    private async Task ValidarAccesoAsync(Guid personaId, CancellationToken ct)
    {
        if (!await db.PuedeAccederPacienteAsync(current, personaId, ct))
            throw new ProhibidoException();
    }

    private async Task<PacienteDto> ToDtoAsync(Paciente p, CancellationToken ct)
    {
        var consentimientos = await db.Consentimientos.AsNoTracking()
            .Where(c => c.PacienteId == p.PersonaId)
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync(ct);
        bool Vigente(string tipo) => consentimientos.FirstOrDefault(c => c.Tipo == tipo)?.Otorgado ?? false;

        var per = p.Persona;
        var correo = per.Correos.FirstOrDefault(c => c.EsPrincipal)?.Correo;
        return new PacienteDto(
            p.PersonaId, p.Codigo, per.Nombres, per.Apellidos, per.TipoDocumento, per.NumeroDocumento,
            per.FechaNacimiento, per.Sexo, per.Telefono, per.Direccion, per.Ciudad, per.Pais, correo,
            p.GrupoSanguineo, p.Alergias, p.Antecedentes, p.ContactoEmergencia, p.TelefonoEmergencia,
            Vigente(TiposConsentimiento.TratamientoDatos), Vigente(TiposConsentimiento.UsoEntrenamiento), p.CreatedAt);
    }
}
