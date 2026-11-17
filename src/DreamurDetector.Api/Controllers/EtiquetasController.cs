namespace DreamurDetector.Api.Controllers;

/// <summary>Diagnóstico confirmado por un médico. Es lo único que alimenta el reentrenamiento.</summary>
[ApiController]
[Route("api/radiografias/{radiografiaId:guid}/etiqueta")]
[Produces("application/json")]
[Tags("Etiquetas")]
public sealed class EtiquetasController(IEtiquetaService etiquetas) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<EtiquetaDto>> Obtener(Guid radiografiaId, CancellationToken ct) =>
        Ok(await etiquetas.ObtenerAsync(radiografiaId, ct));

    /// <summary>Crea o reemplaza la etiqueta (médico/admin). Marca la radiografía como revisada.</summary>
    [HttpPut, Authorize(Roles = Roles.Staff)]
    public async Task<ActionResult<EtiquetaDto>> Guardar(Guid radiografiaId, EtiquetaRequest request, CancellationToken ct) =>
        Ok(await etiquetas.GuardarAsync(radiografiaId, request, ct));

    [HttpDelete, Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> Eliminar(Guid radiografiaId, CancellationToken ct)
    {
        await etiquetas.EliminarAsync(radiografiaId, ct);
        return NoContent();
    }
}
