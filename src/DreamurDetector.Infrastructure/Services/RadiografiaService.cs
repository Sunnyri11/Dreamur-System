using System.Security.Cryptography;

namespace DreamurDetector.Infrastructure.Services;

public sealed class RadiografiaService(
    AppDbContext db,
    IStorageService storage,
    ICurrentUser current,
    IAuditoriaService audit,
    IOptions<StorageOptions> storageOptions,
    ILogger<RadiografiaService> log) : IRadiografiaService
{
    private readonly StorageOptions _storage = storageOptions.Value;

    public async Task<RadiografiaDto> SubirAsync(SubirRadiografiaRequest req, ArchivoSubido archivo, CancellationToken ct)
    {
        var usuarioId = current.RequerirUsuarioId();

        if (!Modalidades.Cerebro.Contains(req.Modalidad))
            throw new ReglaNegocioException("Modalidad inválida. Use 'mri' o 'tc'.");
        if (archivo.Length <= 0) throw new ReglaNegocioException("El archivo está vacío.");
        if (archivo.Length > _storage.MaxFileMb * 1024L * 1024L)
            throw new ReglaNegocioException($"El archivo supera el máximo de {_storage.MaxFileMb} MB.");

        // ---- Origen y paciente según el rol ----
        string origen;
        Guid? pacienteId;
        if (current.Rol == Roles.Paciente)
        {
            if (req.EsDataset) throw new ProhibidoException("Solo un administrador puede cargar al dataset.");
            origen = Origenes.Paciente;
            pacienteId = current.RequerirPersonaId();
        }
        else if (req.EsDataset)
        {
            if (!current.EsAdmin) throw new ProhibidoException("Solo un administrador puede cargar al dataset.");
            origen = Origenes.Dataset;
            pacienteId = null;
        }
        else
        {
            if (req.PacienteId is null) throw new ReglaNegocioException("Debe indicar el paciente (pacienteId).");
            origen = Origenes.Personal;
            pacienteId = req.PacienteId;
            if (!await db.Pacientes.AnyAsync(p => p.PersonaId == pacienteId, ct))
                throw new NotFoundException("Paciente no encontrado.");
            // Un médico solo sube imágenes de los pacientes vinculados a él.
            if (!await db.PuedeAccederPacienteAsync(current, pacienteId.Value, ct))
                throw new ProhibidoException("El paciente no está vinculado a su cuenta.");
        }

        TipoTumor? tipoDataset = null;
        if (origen == Origenes.Dataset && !string.IsNullOrWhiteSpace(req.TipoTumorDataset))
            tipoDataset = await db.TipoTumorCerebroAsync(req.TipoTumorDataset.Trim(), ct);

        // ---- Leer y validar el archivo ----
        using var ms = new MemoryStream();
        await archivo.Contenido.CopyToAsync(ms, ct);
        var bytes = ms.ToArray();
        var (mime, ext) = DetectarImagen(bytes)
            ?? throw new ReglaNegocioException("El archivo debe ser una imagen JPEG, PNG o WEBP válida.");
        var sha = Convert.ToHexStringLower(SHA256.HashData(bytes));

        var duplicada = await db.RadiografiaArchivos.AnyAsync(a =>
            a.Sha256 == sha && a.Radiografia.DeletedAt == null && a.Radiografia.PacienteId == pacienteId, ct);
        if (duplicada) throw new ConflictException("Esta imagen ya fue cargada anteriormente.");

        // ---- Guardar ----
        var r = new Radiografia
        {
            PacienteId = pacienteId, SubidaPor = usuarioId, Origen = origen,
            Modalidad = req.Modalidad, FechaEstudio = req.FechaEstudio,
            Notas = string.IsNullOrWhiteSpace(req.Notas) ? null : req.Notas.Trim()
        };
        var key = $"radiografias/cerebro/{DateTime.UtcNow:yyyy}/{r.Id}{ext}";
        r.Archivo = new RadiografiaArchivo
        {
            RadiografiaId = r.Id, Orden = 0, Formato = "imagen", NombreOriginal = archivo.NombreArchivo,
            StorageKey = key, Sha256 = sha, Mime = mime, TamBytes = bytes.Length
        };
        if (tipoDataset is not null)
        {
            r.Etiqueta = new Etiqueta
            {
                RadiografiaId = r.Id, TipoTumor = tipoDataset.Codigo,
                TieneTumor = tipoDataset.Codigo != CodigosTumor.SinTumor,
                Fuente = FuentesEtiqueta.DatasetInicial, RevisadoPor = usuarioId
            };
            r.Estado = EstadosRadiografia.Revisada;
        }

        ms.Position = 0;
        await storage.SubirAsync(key, ms, mime, ct);
        try
        {
            db.Radiografias.Add(r);
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            try { await storage.EliminarAsync(key, CancellationToken.None); }
            catch (Exception ex) { log.LogWarning(ex, "No se pudo limpiar el archivo huérfano {Key}", key); }
            throw;
        }

        await audit.RegistrarAsync("radiografia_subida", "radiografias", r.Id.ToString(),
            new { r.Origen, r.Modalidad, sha256 = sha }, null, ct);
        return await ObtenerAsync(r.Id, ct);
    }

    public async Task<PagedResult<RadiografiaDto>> ListarAsync(RadiografiaFiltro f, CancellationToken ct)
    {
        var q = db.Radiografias.AsNoTracking().Where(r => r.DeletedAt == null);

        if (current.Rol == Roles.Paciente)
        {
            var yo = current.RequerirPersonaId();
            q = q.Where(r => r.PacienteId == yo);
        }
        else if (current.Rol == Roles.Medico)
        {
            var medicoId = current.RequerirPersonaId();
            if (f.PacienteId is Guid pid)
            {
                if (!await db.PuedeAccederPacienteAsync(current, pid, ct))
                    throw new ProhibidoException("El paciente no está vinculado a su cuenta.");
                q = q.Where(r => r.PacienteId == pid);
            }
            else
            {
                q = q.Where(r => db.MedicoPacientes.Any(mp => mp.MedicoId == medicoId && mp.PacienteId == r.PacienteId));
            }
        }
        else if (f.PacienteId is Guid pidAdmin)
        {
            q = q.Where(r => r.PacienteId == pidAdmin);
        }
        if (!string.IsNullOrWhiteSpace(f.Estado)) q = q.Where(r => r.Estado == f.Estado);
        if (!string.IsNullOrWhiteSpace(f.Origen)) q = q.Where(r => r.Origen == f.Origen);

        var page = await q
            .Include(r => r.Paciente).ThenInclude(p => p!.Persona)
            .Include(r => r.Archivo)
            .Include(r => r.Etiqueta)
            .OrderByDescending(r => r.CreatedAt)
            .PaginarAsync(f.Pagina, f.TamanoPagina, ct);

        var ids = page.Items.Select(r => r.Id).ToList();
        var ultimas = (await db.Detecciones.AsNoTracking()
                .Where(d => ids.Contains(d.RadiografiaId))
                .OrderByDescending(d => d.CreatedAt)
                .ToListAsync(ct))
            .GroupBy(d => d.RadiografiaId)
            .ToDictionary(g => g.Key, g => g.First());

        return page.Mapear(r => ToDto(r, ultimas.GetValueOrDefault(r.Id)));
    }

    public async Task<RadiografiaDto> ObtenerAsync(Guid id, CancellationToken ct)
    {
        var r = await db.Radiografias.AsNoTracking()
            .Include(x => x.Paciente).ThenInclude(p => p!.Persona)
            .Include(x => x.Archivo)
            .Include(x => x.Etiqueta)
            .FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct)
            ?? throw new NotFoundException("Radiografía no encontrada.");
        await db.ValidarAccesoAsync(current, r, ct);

        var ultima = await db.Detecciones.AsNoTracking()
            .Where(d => d.RadiografiaId == id)
            .OrderByDescending(d => d.CreatedAt)
            .FirstOrDefaultAsync(ct);
        return ToDto(r, ultima);
    }

    public async Task<ArchivoDescargado> ObtenerArchivoAsync(Guid id, CancellationToken ct)
    {
        var r = await db.RadiografiaAccesibleAsync(current, id, ct, incluirArchivo: true);
        if (r.Archivo is null) throw new NotFoundException("La radiografía no tiene archivo asociado.");
        var stream = await storage.DescargarAsync(r.Archivo.StorageKey, ct);
        var ext = Path.GetExtension(r.Archivo.StorageKey);
        return new ArchivoDescargado(stream, r.Archivo.Mime, $"radiografia-{r.Id}{ext}");
    }

    public async Task EliminarAsync(Guid id, CancellationToken ct)
    {
        var r = await db.RadiografiaAccesibleAsync(current, id, ct);
        // El paciente puede borrar solo lo que subió él mismo; el staff, solo el admin.
        var esDuenoPaciente = current.Rol == Roles.Paciente && r.Origen == Origenes.Paciente;
        if (!esDuenoPaciente && !current.EsAdmin)
            throw new ProhibidoException("No tiene permisos para eliminar esta radiografía.");

        r.DeletedAt = DateTimeOffset.UtcNow; // borrado lógico; el archivo se conserva en el bucket
        await db.SaveChangesAsync(ct);
        await audit.RegistrarAsync("radiografia_eliminada", "radiografias", r.Id.ToString(), null, null, ct);
    }

    // ---------- privados ----------
    private static RadiografiaDto ToDto(Radiografia r, Deteccion? ultima) => new(
        r.Id, r.PacienteId, r.Paciente?.Codigo,
        r.Paciente is null ? null : $"{r.Paciente.Persona.Nombres} {r.Paciente.Persona.Apellidos}",
        r.Origen, "cerebro", r.Modalidad, r.FechaEstudio, r.Notas, r.Estado, r.CreatedAt,
        r.Archivo is null ? null : Mapeos.ToDto(r.Archivo),
        r.Etiqueta is null ? null : Mapeos.ToDto(r.Etiqueta),
        ultima is null ? null : Mapeos.Resumen(ultima));

    /// <summary>Valida la imagen por sus "magic bytes" (no confía en la extensión ni en el Content-Type).</summary>
    private static (string Mime, string Ext)? DetectarImagen(byte[] b)
    {
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return ("image/jpeg", ".jpg");
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 &&
            b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return ("image/png", ".png");
        if (b.Length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' &&
            b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return ("image/webp", ".webp");
        return null;
    }
}
