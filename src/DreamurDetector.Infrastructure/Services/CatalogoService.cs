namespace DreamurDetector.Infrastructure.Services;

public sealed class CatalogoService(AppDbContext db) : ICatalogoService
{
    public async Task<IReadOnlyList<TipoTumorDto>> ListarTiposTumorAsync(CancellationToken ct) =>
        await db.TiposTumor.AsNoTracking()
                        .OrderBy(t => t.Nombre)
            .Select(t => new TipoTumorDto(t.Codigo, "cerebro", t.Nombre, t.Descripcion))
            .ToListAsync(ct);
}
