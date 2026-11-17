namespace DreamurDetector.Infrastructure.Services;

public sealed class AuditoriaService(AppDbContext db, ICurrentUser current, ILogger<AuditoriaService> log) : IAuditoriaService
{
    public async Task RegistrarAsync(string accion, string? entidad = null, string? entidadId = null,
        object? detalle = null, Guid? usuarioId = null, CancellationToken ct = default)
    {
        try
        {
            db.Auditoria.Add(new Auditoria
            {
                UsuarioId = usuarioId ?? current.UsuarioId,
                Accion = accion,
                Entidad = entidad,
                EntidadId = entidadId,
                Ip = current.Ip,
                Detalle = JsonHelper.Escribir(detalle)
            });
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // La auditoría nunca debe tumbar la operación principal.
            log.LogWarning(ex, "No se pudo registrar auditoría: {Accion}", accion);
        }
    }

    public async Task<PagedResult<AuditoriaDto>> ListarAsync(AuditoriaFiltro f, CancellationToken ct)
    {
        var q = db.Auditoria.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(f.Accion)) q = q.Where(a => a.Accion == f.Accion);
        if (f.UsuarioId is not null) q = q.Where(a => a.UsuarioId == f.UsuarioId);
        if (f.Desde is not null) q = q.Where(a => a.CreatedAt >= f.Desde);
        if (f.Hasta is not null) q = q.Where(a => a.CreatedAt <= f.Hasta);

        var page = await q.OrderByDescending(a => a.CreatedAt).PaginarAsync(f.Pagina, f.TamanoPagina, ct);

        // Segunda consulta: nombre de los usuarios que aparecen en esta página.
        var ids = page.Items.Where(a => a.UsuarioId != null).Select(a => a.UsuarioId!.Value).Distinct().ToList();
        var nombres = ids.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.Usuarios.AsNoTracking()
                .Where(u => ids.Contains(u.Id))
                .Select(u => new { u.Id, u.Persona.Nombres, u.Persona.Apellidos })
                .ToDictionaryAsync(x => x.Id, x => (x.Nombres + " " + x.Apellidos).Trim(), ct);

        return page.Mapear(a => new AuditoriaDto(a.Id, a.UsuarioId, a.Accion, a.Entidad, a.EntidadId, a.Ip,
            JsonHelper.Leer(a.Detalle), a.CreatedAt,
            a.UsuarioId is Guid uid && nombres.TryGetValue(uid, out var nombre) ? nombre : null));
    }
}
