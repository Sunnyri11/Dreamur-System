namespace DreamurDetector.Infrastructure.Services;

public sealed class ModeloService(
    AppDbContext db,
    IDetectorClient detector,
    ICurrentUser current,
    IAuditoriaService audit) : IModeloService
{
    public async Task<IReadOnlyList<ModeloVersionDto>> ListarVersionesAsync(CancellationToken ct)
    {
        var lista = await db.ModeloVersiones.AsNoTracking()
            .Where(m => m.Modalidad == Modalidades.MriCerebro)
            .OrderByDescending(m => m.Version)
            .ToListAsync(ct);
        return lista.Select(m => Mapeos.ToDto(m)).ToList();
    }

    public async Task<ModeloVersionDto> ObtenerActivoAsync(CancellationToken ct)
    {
        var m = await db.ModeloVersiones.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Modalidad == Modalidades.MriCerebro && x.Activo, ct)
            ?? throw new NotFoundException("No hay un modelo de cerebro activo.");
        return Mapeos.ToDto(m);
    }

    public async Task<ModeloVersionDto> ActivarAsync(int id, CancellationToken ct)
    {
        var m = await db.ModeloVersiones.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.Modalidad == Modalidades.MriCerebro, ct)
            ?? throw new NotFoundException("Versión de modelo no encontrada.");

        // El índice único ux_modelo_activo exige desactivar la anterior ANTES de activar la nueva,
        // por eso son dos UPDATE dentro de una transacción (con la estrategia de reintentos de Npgsql).
        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await db.ModeloVersiones
                .Where(x => x.Modalidad == Modalidades.MriCerebro && x.Activo && x.Id != id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.Activo, false), ct);
            await db.ModeloVersiones
                .Where(x => x.Id == id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.Activo, true), ct);
            await tx.CommitAsync(ct);
        });

        await audit.RegistrarAsync("modelo_activado", "modelo_versiones", id.ToString(), new { m.Version }, null, ct);
        return Mapeos.ToDto(await db.ModeloVersiones.AsNoTracking().FirstAsync(x => x.Id == id, ct));
    }

    public async Task<PagedResult<EntrenamientoDto>> ListarEntrenamientosAsync(PaginacionQuery p, CancellationToken ct)
    {
        var page = await db.Entrenamientos.AsNoTracking()
            .Where(e => e.Modalidad == Modalidades.MriCerebro)
            .OrderByDescending(e => e.IniciadoEn)
            .PaginarAsync(p.Pagina, p.TamanoPagina, ct);
        return page.Mapear(x => Mapeos.ToDto(x));
    }

    public async Task<EntrenamientoDto> IniciarEntrenamientoAsync(CancellationToken ct)
    {
        if (await db.Entrenamientos.AnyAsync(e => e.Modalidad == Modalidades.MriCerebro && e.Estado == EstadosEntrenamiento.EnCurso, ct))
            throw new ConflictException("Ya hay un entrenamiento de cerebro en curso.");

        // Muestras entrenables = etiquetas del dataset inicial + las de pacientes con consentimiento vigente
        // (misma regla que la vista v_etiquetas_entrenables, restringida a cerebro).
        var muestras = await db.Etiquetas.AsNoTracking().CountAsync(e =>
            e.Radiografia.DeletedAt == null &&
            (e.Radiografia.Origen == Origenes.Dataset ||
             db.Consentimientos
                 .Where(c => c.PacienteId == e.Radiografia.PacienteId && c.Tipo == TiposConsentimiento.UsoEntrenamiento)
                 .OrderByDescending(c => c.CreatedAt)
                 .Select(c => c.Otorgado)
                 .FirstOrDefault()), ct);
        if (muestras == 0)
            throw new ReglaNegocioException("No hay muestras etiquetadas disponibles para entrenar.");

        var nuevo = new Entrenamiento
        {
            Modalidad = Modalidades.MriCerebro,
            NMuestras = muestras,
            DisparadoPor = current.UsuarioId?.ToString()
        };
        db.Entrenamientos.Add(nuevo);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (ex.EsViolacionUnica())
        {
            throw new ConflictException("Ya hay un entrenamiento de cerebro en curso.");
        }

        try
        {
            await detector.IniciarEntrenamientoAsync(nuevo.Id, Regiones.Cerebro, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            nuevo.Estado = EstadosEntrenamiento.Error;
            nuevo.Error = Recortar(ex.Message);
            nuevo.FinalizadoEn = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }

        await audit.RegistrarAsync("entrenamiento_iniciado", "entrenamientos", nuevo.Id.ToString(), new { muestras }, null, ct);
        return Mapeos.ToDto(nuevo);
    }

    public async Task<EntrenamientoDto> CompletarEntrenamientoAsync(int id, CompletarEntrenamientoRequest req, CancellationToken ct)
    {
        var ent = await db.Entrenamientos.FirstOrDefaultAsync(x => x.Id == id, ct)
            ?? throw new NotFoundException("Entrenamiento no encontrado.");
        if (ent.Estado != EstadosEntrenamiento.EnCurso)
            throw new ConflictException("El entrenamiento ya no está en curso.");

        if (req.Estado == EstadosEntrenamiento.Completado)
        {
            if (req.ModeloVersionId is null)
                throw new ReglaNegocioException("Falta modeloVersionId para un entrenamiento completado.");
            if (!await db.ModeloVersiones.AnyAsync(m => m.Id == req.ModeloVersionId, ct))
                throw new ReglaNegocioException("modeloVersionId no existe.");
            ent.ModeloVersionId = req.ModeloVersionId;
        }
        else
        {
            ent.Error = Recortar(req.Error ?? "Error no especificado.");
        }

        ent.Estado = req.Estado;
        if (req.NMuestras is not null) ent.NMuestras = req.NMuestras;
        ent.FinalizadoEn = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await audit.RegistrarAsync("entrenamiento_" + req.Estado, "entrenamientos", id.ToString(), null, null, ct);
        return Mapeos.ToDto(ent);
    }

    private static string Recortar(string s) => s.Length <= 500 ? s : s[..500];
}
