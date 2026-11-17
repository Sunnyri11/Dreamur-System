namespace DreamurDetector.Api.Controllers;

[ApiController]
[Produces("application/json")]
[Tags("Detecciones")]
public sealed class DeteccionesController(IDeteccionService detecciones) : ControllerBase
{
    /// <summary>Analiza la radiografía con el modelo activo y guarda el resultado (tipo, confianza, zonas).</summary>
    [HttpPost("api/radiografias/{radiografiaId:guid}/detecciones")]
    [ProducesResponseType<DeteccionDto>(StatusCodes.Status201Created)]
    public async Task<IActionResult> Analizar(Guid radiografiaId, CancellationToken ct)
    {
        var dto = await detecciones.AnalizarAsync(radiografiaId, ct);
        return CreatedAtAction(nameof(Obtener), new { id = dto.Id }, dto);
    }

    /// <summary>Historial de detecciones de una radiografía (más reciente primero).</summary>
    [HttpGet("api/radiografias/{radiografiaId:guid}/detecciones")]
    public async Task<ActionResult<IReadOnlyList<DeteccionDto>>> Historial(Guid radiografiaId, CancellationToken ct) =>
        Ok(await detecciones.HistorialAsync(radiografiaId, ct));

    /// <summary>Detalle de una detección.</summary>
    [HttpGet("api/detecciones/{id:guid}")]
    public async Task<ActionResult<DeteccionDto>> Obtener(Guid id, CancellationToken ct) =>
        Ok(await detecciones.ObtenerAsync(id, ct));
}
