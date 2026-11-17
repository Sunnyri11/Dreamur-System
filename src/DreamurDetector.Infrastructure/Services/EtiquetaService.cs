namespace DreamurDetector.Infrastructure.Services;

/// <summary>Diagnóstico confirmado: es lo único que alimenta el reentrenamiento del modelo.</summary>
public sealed class EtiquetaService(AppDbContext db, ICurrentUser current, IAuditoriaService audit) : IEtiquetaService
{
    public async Task<EtiquetaDto> ObtenerAsync(Guid radiografiaId, CancellationToken ct)
    {
        await db.RadiografiaAccesibleAsync(current, radiografiaId, ct);
        var e = await db.Etiquetas.AsNoTracking().FirstOrDefaultAsync(x => x.RadiografiaId == radiografiaId, ct)
            ?? throw new NotFoundException("La radiografía aún no tiene etiqueta confirmada.");
        return Mapeos.ToDto(e);
    }

    public async Task<EtiquetaDto> GuardarAsync(Guid radiografiaId, EtiquetaRequest req, CancellationToken ct)
    {
        var usuarioId = current.RequerirUsuarioId();
        var r = await db.RadiografiaAccesibleAsync(current, radiografiaId, ct);
        var tipo = await db.TipoTumorCerebroAsync(req.TipoTumor.Trim(), ct);

        var fuente = r.Origen == Origenes.Dataset ? FuentesEtiqueta.DatasetInicial : FuentesEtiqueta.RevisionMedica;
        var e = await db.Etiquetas.FirstOrDefaultAsync(x => x.RadiografiaId == radiografiaId, ct);
        if (e is null)
        {
            e = new Etiqueta { RadiografiaId = radiografiaId };
            db.Etiquetas.Add(e);
        }
        e.TipoTumor = tipo.Codigo;
        e.TieneTumor = tipo.Codigo != CodigosTumor.SinTumor;
        e.Fuente = fuente;
        e.RevisadoPor = usuarioId;
        e.Comentario = string.IsNullOrWhiteSpace(req.Comentario) ? null : req.Comentario.Trim();
        r.Estado = EstadosRadiografia.Revisada;

        await db.SaveChangesAsync(ct);
        await audit.RegistrarAsync("etiqueta_guardada", "etiquetas", radiografiaId.ToString(),
            new { e.TipoTumor, e.Fuente }, null, ct);
        return Mapeos.ToDto(e);
    }

    public async Task EliminarAsync(Guid radiografiaId, CancellationToken ct)
    {
        var r = await db.RadiografiaAccesibleAsync(current, radiografiaId, ct);
        var e = await db.Etiquetas.FirstOrDefaultAsync(x => x.RadiografiaId == radiografiaId, ct)
            ?? throw new NotFoundException("La radiografía no tiene etiqueta.");
        db.Etiquetas.Remove(e);

        var tieneDetecciones = await db.Detecciones.AnyAsync(d => d.RadiografiaId == radiografiaId, ct);
        r.Estado = tieneDetecciones ? EstadosRadiografia.Analizada : EstadosRadiografia.Subida;
        await db.SaveChangesAsync(ct);
        await audit.RegistrarAsync("etiqueta_eliminada", "etiquetas", radiografiaId.ToString(), null, null, ct);
    }
}
