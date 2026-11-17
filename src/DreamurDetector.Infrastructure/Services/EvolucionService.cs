namespace DreamurDetector.Infrastructure.Services;

/// <summary>Serie temporal de resultados de un paciente (una fila por radiografía, con su última detección).</summary>
public sealed class EvolucionService(AppDbContext db, ICurrentUser current) : IEvolucionService
{
    public async Task<EvolucionDto> ObtenerAsync(Guid pacienteId, CancellationToken ct)
    {
        if (!await db.PuedeAccederPacienteAsync(current, pacienteId, ct))
            throw new ProhibidoException();
        if (!await db.Pacientes.AnyAsync(p => p.PersonaId == pacienteId, ct))
            throw new NotFoundException("Paciente no encontrado.");

        var radiografias = await db.Radiografias.AsNoTracking()
            .Include(r => r.Etiqueta)
            .Where(r => r.PacienteId == pacienteId && r.DeletedAt == null)
            .ToListAsync(ct);
        var ids = radiografias.Select(r => r.Id).ToList();

        var detecciones = await db.Detecciones.AsNoTracking()
            .Include(d => d.Zonas)
            .Where(d => ids.Contains(d.RadiografiaId))
            .ToListAsync(ct);
        var ultimas = detecciones
            .GroupBy(d => d.RadiografiaId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(d => d.CreatedAt).First());

        var nombres = await db.TiposTumor.AsNoTracking().ToDictionaryAsync(t => t.Codigo, t => t.Nombre, ct);

        var filas = new List<(DateTimeOffset Fecha, DateTimeOffset Subida, EvolucionItemDto Dto)>();
        foreach (var r in radiografias)
        {
            if (!ultimas.TryGetValue(r.Id, out var det)) continue;

            var fecha = r.FechaEstudio is DateOnly fe
                ? new DateTimeOffset(DateTime.SpecifyKind(fe.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc))
                : r.CreatedAt;
            var area = det.ImagenValida ? Math.Min(1f, det.Zonas.Sum(z => z.Ancho * z.Alto)) : 0f;

            filas.Add((fecha, r.CreatedAt, new EvolucionItemDto(
                r.Id, det.Id, r.FechaEstudio, r.CreatedAt, r.Modalidad,
                det.ImagenValida, det.TipoImagen, det.TieneTumor, det.TipoTumor,
                nombres.GetValueOrDefault(det.TipoTumor), det.Confianza, area,
                det.ImagenValida ? det.Zonas.Count : 0,
                r.Etiqueta?.TipoTumor, r.Etiqueta?.Fuente)));
        }

        var items = filas.OrderBy(x => x.Fecha).ThenBy(x => x.Subida).Select(x => x.Dto).ToList();
        return new EvolucionDto(
            pacienteId,
            radiografias.Count,
            items.Count,
            items.Count(i => i.ImagenValida),
            items.Count(i => !i.ImagenValida),
            items);
    }
}
