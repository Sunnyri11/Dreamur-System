namespace DreamurDetector.Infrastructure.Services;

public sealed class DeteccionService(
    AppDbContext db,
    IStorageService storage,
    IDetectorClient detector,
    ICurrentUser current,
    IAuditoriaService audit) : IDeteccionService
{
    public async Task<DeteccionDto> AnalizarAsync(Guid radiografiaId, CancellationToken ct)
    {
        var usuarioId = current.RequerirUsuarioId();
        var r = await db.RadiografiaAccesibleAsync(current, radiografiaId, ct, incluirArchivo: true);
        if (r.Archivo is null) throw new ReglaNegocioException("La radiografía no tiene archivo asociado.");

        DetectorResultado resultado;
        await using (var stream = await storage.DescargarAsync(r.Archivo.StorageKey, ct))
        {
            resultado = await detector.PredecirAsync(
                stream, Path.GetFileName(r.Archivo.StorageKey), r.Archivo.Mime, Regiones.Cerebro, ct);
        }

        // Imagen no reconocida como MRI/TC cerebral: el resultado de tumor no es interpretable.
        var codigoTipo = resultado.ImagenValida ? resultado.TipoTumor : CodigosTumor.SinTumor;
        if (string.IsNullOrWhiteSpace(codigoTipo))
            throw new ServicioExternoException("El servicio de detección no devolvió 'tipo_tumor'.");
        var tipo = await db.TiposTumor.AsNoTracking().FirstOrDefaultAsync(t => t.Codigo == codigoTipo, ct)
            ?? throw new ServicioExternoException(
                $"El modelo devolvió un tipo de tumor que no existe en el catálogo: '{codigoTipo}'.");

        // Modelo usado: el que reporta el servicio ML, o en su defecto el activo.
        var modeloId = await db.ModeloVersiones.AsNoTracking()
            .Where(m => m.Modalidad == r.Modalidad &&
                        (resultado.ModeloVersion != null ? m.Version == resultado.ModeloVersion : m.Activo))
            .OrderByDescending(m => m.Activo).ThenByDescending(m => m.Version)
            .Select(m => (int?)m.Id)
            .FirstOrDefaultAsync(ct);

        var d = new Deteccion
        {
            RadiografiaId = r.Id,
            ArchivoId = r.Archivo.Id,
            Modalidad = r.Modalidad,
            NCortes = 1,
            ModeloVersionId = modeloId,
            TipoTumor = tipo.Codigo,
            TieneTumor = resultado.ImagenValida && tipo.Codigo != CodigosTumor.SinTumor,
            Confianza = Math.Clamp(resultado.Confianza, 0f, 1f),
            Probabilidades = JsonHelper.Escribir(resultado.Probabilidades),
            ImagenValida = resultado.ImagenValida,
            TipoImagen = resultado.TipoImagen,
            Mensaje = resultado.Mensaje,
            SolicitadoPor = usuarioId
        };
        var orden = 0;
        IReadOnlyList<DetectorZona> zonasAGuardar = resultado.ImagenValida ? resultado.Zonas : Array.Empty<DetectorZona>();
        foreach (var z in zonasAGuardar)
        {
            d.Zonas.Add(new DeteccionZona
            {
                DeteccionId = d.Id, Orden = orden++,
                X = Math.Clamp(z.X, 0f, 1f), Y = Math.Clamp(z.Y, 0f, 1f),
                Ancho = Math.Clamp(z.Ancho, 0f, 1f), Alto = Math.Clamp(z.Alto, 0f, 1f),
                Puntaje = z.Puntaje
            });
        }
        db.Detecciones.Add(d);
        if (r.Estado == EstadosRadiografia.Subida) r.Estado = EstadosRadiografia.Analizada;
        await db.SaveChangesAsync(ct);

        await audit.RegistrarAsync("deteccion", "detecciones", d.Id.ToString(),
            new { radiografiaId = r.Id, d.TipoTumor, d.Confianza, d.ImagenValida, d.TipoImagen }, null, ct);
        return Mapeos.ToDto(d, tipo.Nombre);
    }

    public async Task<IReadOnlyList<DeteccionDto>> HistorialAsync(Guid radiografiaId, CancellationToken ct)
    {
        await db.RadiografiaAccesibleAsync(current, radiografiaId, ct);
        var lista = await db.Detecciones.AsNoTracking()
            .Include(d => d.Zonas)
            .Where(d => d.RadiografiaId == radiografiaId)
            .OrderByDescending(d => d.CreatedAt)
            .ToListAsync(ct);
        var nombres = await NombresTiposAsync(ct);
        return lista.Select(d => Mapeos.ToDto(d, nombres.GetValueOrDefault(d.TipoTumor))).ToList();
    }

    public async Task<DeteccionDto> ObtenerAsync(Guid id, CancellationToken ct)
    {
        var d = await db.Detecciones.AsNoTracking()
            .Include(x => x.Zonas)
            .Include(x => x.Radiografia)
            .FirstOrDefaultAsync(x => x.Id == id && x.Radiografia.DeletedAt == null, ct)
            ?? throw new NotFoundException("Detección no encontrada.");
        await db.ValidarAccesoAsync(current, d.Radiografia, ct);
        var nombres = await NombresTiposAsync(ct);
        return Mapeos.ToDto(d, nombres.GetValueOrDefault(d.TipoTumor));
    }

    private async Task<Dictionary<string, string>> NombresTiposAsync(CancellationToken ct) =>
        await db.TiposTumor.AsNoTracking().ToDictionaryAsync(t => t.Codigo, t => t.Nombre, ct);
}
