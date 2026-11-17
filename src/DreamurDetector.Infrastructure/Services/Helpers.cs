using System.Text.Json;
using Npgsql;

namespace DreamurDetector.Infrastructure.Services;

internal static class JsonHelper
{
    private static readonly JsonSerializerOptions Opts = new(JsonSerializerDefaults.Web);

    public static JsonElement? Leer(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<JsonElement>(json); }
        catch (JsonException) { return null; }
    }

    /// <summary>Extrae heads.tipo (lista de clases) del JSONB de modelo_versiones.heads.</summary>
    public static string[] LeerTipos(string? heads)
    {
        var el = Leer(heads);
        if (el is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty("tipo", out var t) && t.ValueKind == JsonValueKind.Array)
            return t.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0).ToArray();
        return [];
    }

    public static string? Escribir(object? valor) => valor is null ? null : JsonSerializer.Serialize(valor, Opts);
}

internal static class DbExtensions
{
    public static bool EsViolacionUnica(this DbUpdateException ex) =>
        ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    public static async Task<PagedResult<T>> PaginarAsync<T>(this IQueryable<T> q, int pagina, int tamano, CancellationToken ct)
    {
        var total = await q.CountAsync(ct);
        var items = await q.Skip((pagina - 1) * tamano).Take(tamano).ToListAsync(ct);
        return new PagedResult<T>(items, pagina, tamano, total);
    }

    public static PagedResult<TOut> Mapear<TIn, TOut>(this PagedResult<TIn> p, Func<TIn, TOut> map) =>
        new(p.Items.Select(map).ToList(), p.Pagina, p.TamanoPagina, p.Total);

    /// <summary>Escapa % y _ para usarlos dentro de un patrón ILIKE.</summary>
    public static string PatronILike(string texto) =>
        "%" + texto.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

    /// <summary>
    /// Reglas de acceso a los datos de un paciente: el paciente solo a lo suyo; el médico solo a los pacientes
    /// vinculados en medico_pacientes; el administrador puede verlo todo (solo lectura en la práctica).
    /// </summary>
    public static async Task<bool> PuedeAccederPacienteAsync(
        this AppDbContext db, ICurrentUser user, Guid pacienteId, CancellationToken ct)
    {
        if (user.EsAdmin) return true;
        if (user.Rol == Roles.Paciente) return user.PersonaId == pacienteId;
        if (user.Rol == Roles.Medico && user.PersonaId is Guid medicoId)
            return await db.MedicoPacientes.AnyAsync(x => x.MedicoId == medicoId && x.PacienteId == pacienteId, ct);
        return false;
    }

    /// <summary>Valida que el usuario actual pueda ver la radiografía. Si no, responde 404 para no revelar su existencia.</summary>
    public static async Task ValidarAccesoAsync(
        this AppDbContext db, ICurrentUser user, Radiografia r, CancellationToken ct)
    {
        if (r.PacienteId is null)
        {
            // Imágenes del dataset (sin paciente): solo el administrador.
            if (user.EsAdmin) return;
            throw new NotFoundException("Radiografía no encontrada.");
        }
        if (!await db.PuedeAccederPacienteAsync(user, r.PacienteId.Value, ct))
            throw new NotFoundException("Radiografía no encontrada.");
    }

    /// <summary>Carga una radiografía activa y valida que el usuario actual pueda verla.</summary>
    public static async Task<Radiografia> RadiografiaAccesibleAsync(
        this AppDbContext db, ICurrentUser user, Guid id, CancellationToken ct, bool incluirArchivo = false)
    {
        IQueryable<Radiografia> q = db.Radiografias.Where(r => r.Id == id && r.DeletedAt == null);
        if (incluirArchivo) q = q.Include(r => r.Archivo);
        var r = await q.FirstOrDefaultAsync(ct) ?? throw new NotFoundException("Radiografía no encontrada.");
        await db.ValidarAccesoAsync(user, r, ct);
        return r;
    }

    public static async Task<TipoTumor> TipoTumorCerebroAsync(this AppDbContext db, string codigo, CancellationToken ct) =>
        await db.TiposTumor.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Codigo == codigo && true, ct)
        ?? throw new ReglaNegocioException($"Tipo de tumor desconocido para cerebro: '{codigo}'.");
}

internal static class Mapeos
{
    public static UsuarioDto ToDto(Usuario u, Persona p, string? correo, bool verificado, string? codigoPaciente = null,
        string? rolActivo = null, IReadOnlyList<string>? roles = null) =>
        new(u.Id, p.Id, p.Nombres, p.Apellidos, correo, verificado, rolActivo ?? u.Rol, u.Activo, u.UltimoAcceso,
            codigoPaciente, roles ?? [u.Rol]);

    public static EtiquetaDto ToDto(Etiqueta e) =>
        new(e.RadiografiaId, e.TieneTumor, e.TipoTumor, e.Fuente, e.RevisadoPor, e.Comentario, e.CreatedAt, e.UpdatedAt);

    public static ArchivoDto ToDto(RadiografiaArchivo a) =>
        new(a.Mime, a.Ancho, a.Alto, a.TamBytes, a.Sha256);

    public static DeteccionResumenDto Resumen(Deteccion d) =>
        new(d.Id, d.TieneTumor, d.TipoTumor, d.Confianza, d.CreatedAt, d.ImagenValida, d.TipoImagen);

    public static DeteccionDto ToDto(Deteccion d, string? nombreTipo) =>
        new(d.Id, d.RadiografiaId, d.ModeloVersionId, d.TieneTumor, d.TipoTumor, nombreTipo, d.Confianza,
            JsonHelper.Leer(d.Probabilidades),
            d.Zonas.OrderBy(z => z.Orden).Select(z => new ZonaDto(z.Orden, z.X, z.Y, z.Ancho, z.Alto, z.Puntaje)).ToList(),
            d.CreatedAt, d.ImagenValida, d.TipoImagen, d.Mensaje);

    public static ModeloVersionDto ToDto(ModeloVersion m) =>
        new(m.Id, m.Modalidad, m.Version, m.Arquitectura, JsonHelper.LeerTipos(m.Heads), m.NMuestras, JsonHelper.Leer(m.Metricas), m.Activo, m.CreatedAt);

    public static EntrenamientoDto ToDto(Entrenamiento e) =>
        new(e.Id, e.Modalidad, e.Estado, e.NMuestras, e.ModeloVersionId, e.Error, e.DisparadoPor, e.IniciadoEn, e.FinalizadoEn);
}
