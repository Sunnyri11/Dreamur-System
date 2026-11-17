namespace DreamurDetector.Infrastructure.Services;

public sealed class SesionValidator(AppDbContext db) : ISesionValidator
{
    public async Task<bool> EsValidaAsync(Guid usuarioId, string jti, CancellationToken ct)
    {
        var estado = await db.Usuarios.AsNoTracking()
            .Where(u => u.Id == usuarioId)
            .Select(u => new { u.Activo, Revocado = db.TokensRevocados.Any(t => t.Jti == jti) })
            .FirstOrDefaultAsync(ct);

        return estado is { Activo: true, Revocado: false };
    }
}
