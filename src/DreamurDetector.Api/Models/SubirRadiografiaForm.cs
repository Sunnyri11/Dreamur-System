using System.ComponentModel.DataAnnotations;

namespace DreamurDetector.Api.Models;

/// <summary>Formulario multipart/form-data para subir una imagen de cerebro (MRI o TC).</summary>
public sealed class SubirRadiografiaForm
{
    /// <summary>Imagen JPEG, PNG o WEBP.</summary>
    [Required] public IFormFile Archivo { get; set; } = default!;

    /// <summary>mri | tc</summary>
    [Required] public string Modalidad { get; set; } = Modalidades.MriCerebro;

    /// <summary>Solo personal médico/admin: paciente al que pertenece la imagen.</summary>
    public Guid? PacienteId { get; set; }

    public DateOnly? FechaEstudio { get; set; }

    [StringLength(2000)] public string? Notas { get; set; }

    /// <summary>Solo admin: cargar al dataset inicial (sin paciente).</summary>
    public bool EsDataset { get; set; }

    /// <summary>Solo dataset: tipo de tumor para la etiqueta inicial (glioma, meningioma...).</summary>
    public string? TipoTumorDataset { get; set; }
}
