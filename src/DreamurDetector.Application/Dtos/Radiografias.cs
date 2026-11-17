using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using DreamurDetector.Application.Common;

namespace DreamurDetector.Application.Dtos;

public sealed record ArchivoDto(string Mime, int? Ancho, int? Alto, long? TamBytes, string Sha256);

public sealed record EtiquetaDto(
    Guid RadiografiaId, bool TieneTumor, string TipoTumor, string Fuente, Guid? RevisadoPor,
    string? Comentario, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public sealed record DeteccionResumenDto(
    Guid Id, bool TieneTumor, string TipoTumor, float Confianza, DateTimeOffset CreatedAt,
    bool ImagenValida, string? TipoImagen);

public sealed record RadiografiaDto(
    Guid Id, Guid? PacienteId, string? PacienteCodigo, string? PacienteNombre,
    string Origen, string Region, string Modalidad, DateOnly? FechaEstudio, string? Notas, string Estado,
    DateTimeOffset CreatedAt, ArchivoDto? Archivo, EtiquetaDto? Etiqueta, DeteccionResumenDto? UltimaDeteccion);

public sealed record ZonaDto(int Orden, float X, float Y, float Ancho, float Alto, float? Puntaje);

public sealed record DeteccionDto(
    Guid Id, Guid RadiografiaId, int? ModeloVersionId, bool TieneTumor, string TipoTumor, string? TipoTumorNombre,
    float Confianza, JsonElement? Probabilidades, IReadOnlyList<ZonaDto> Zonas, DateTimeOffset CreatedAt,
    bool ImagenValida, string? TipoImagen, string? Mensaje);

public sealed class RadiografiaFiltro : PaginacionQuery
{
    /// <summary>Solo personal médico/admin; un paciente siempre ve únicamente las suyas.</summary>
    public Guid? PacienteId { get; set; }
    [RegularExpression("^(subido|analizado|revisado)$")] public string? Estado { get; set; }
    [RegularExpression("^(paciente|personal|dataset)$")] public string? Origen { get; set; }
}

public sealed class SubirRadiografiaRequest
{
    /// <summary>Requerido cuando sube personal médico/admin (no dataset).</summary>
    public Guid? PacienteId { get; set; }
    public string Modalidad { get; set; } = Domain.Modalidades.MriCerebro;
    public DateOnly? FechaEstudio { get; set; }
    public string? Notas { get; set; }
    /// <summary>Solo admin: carga la imagen al dataset inicial (sin paciente).</summary>
    public bool EsDataset { get; set; }
    /// <summary>Solo dataset: código de tipo de tumor para crear la etiqueta inicial.</summary>
    public string? TipoTumorDataset { get; set; }
}

public sealed class EtiquetaRequest
{
    [Required] public string TipoTumor { get; set; } = "";
    [StringLength(2000)] public string? Comentario { get; set; }
}

public sealed record TipoTumorDto(string Codigo, string? Region, string Nombre, string? Descripcion);

public sealed record EvolucionItemDto(
    Guid RadiografiaId, Guid DeteccionId, DateOnly? FechaEstudio, DateTimeOffset CreatedAt, string Modalidad,
    bool ImagenValida, string? TipoImagen, bool TieneTumor, string TipoTumor, string? TipoTumorNombre,
    float Confianza, float AreaSospechosa, int NumeroZonas, string? EtiquetaTipo, string? EtiquetaFuente);

public sealed record EvolucionDto(
    Guid PacienteId, int TotalImagenes, int TotalAnalizadas, int TotalValidas, int TotalInvalidas,
    IReadOnlyList<EvolucionItemDto> Items);
