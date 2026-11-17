using DreamurDetector.Api.Models;

namespace DreamurDetector.Api.Controllers;

/// <summary>Imágenes de cerebro (MRI / TC). Los pacientes solo ven las suyas.</summary>
[ApiController]
[Route("api/radiografias")]
[Produces("application/json")]
[Tags("Radiografías")]
public sealed class RadiografiasController(IRadiografiaService radiografias) : ControllerBase
{
    /// <summary>Sube una imagen (multipart/form-data). Máx. 20 MB; JPEG, PNG o WEBP.</summary>
    [HttpPost, Consumes("multipart/form-data"), RequestSizeLimit(25_000_000)]
    [ProducesResponseType<RadiografiaDto>(StatusCodes.Status201Created)]
    public async Task<IActionResult> Subir([FromForm] SubirRadiografiaForm form, CancellationToken ct)
    {
        await using var stream = form.Archivo.OpenReadStream();
        var archivo = new ArchivoSubido(stream, form.Archivo.FileName, form.Archivo.ContentType, form.Archivo.Length);
        var request = new SubirRadiografiaRequest
        {
            PacienteId = form.PacienteId,
            Modalidad = form.Modalidad,
            FechaEstudio = form.FechaEstudio,
            Notas = form.Notas,
            EsDataset = form.EsDataset,
            TipoTumorDataset = form.TipoTumorDataset
        };
        var dto = await radiografias.SubirAsync(request, archivo, ct);
        return CreatedAtAction(nameof(Obtener), new { id = dto.Id }, dto);
    }

    /// <summary>Lista radiografías con filtros y paginación.</summary>
    [HttpGet]
    public async Task<ActionResult<PagedResult<RadiografiaDto>>> Listar([FromQuery] RadiografiaFiltro filtro, CancellationToken ct) =>
        Ok(await radiografias.ListarAsync(filtro, ct));

    /// <summary>Detalle de una radiografía (con etiqueta y última detección).</summary>
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<RadiografiaDto>> Obtener(Guid id, CancellationToken ct) =>
        Ok(await radiografias.ObtenerAsync(id, ct));

    /// <summary>Descarga/visualiza la imagen original.</summary>
    [HttpGet("{id:guid}/archivo")]
    [Produces("image/jpeg", "image/png", "image/webp")]
    public async Task<IActionResult> Archivo(Guid id, CancellationToken ct)
    {
        var a = await radiografias.ObtenerArchivoAsync(id, ct);
        return File(a.Contenido, a.Mime);
    }

    /// <summary>Borrado lógico. El paciente borra solo lo que subió; el admin cualquiera.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Eliminar(Guid id, CancellationToken ct)
    {
        await radiografias.EliminarAsync(id, ct);
        return NoContent();
    }
}
