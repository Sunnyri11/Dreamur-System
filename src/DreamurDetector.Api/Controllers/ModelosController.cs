using DreamurDetector.Api.Security;

namespace DreamurDetector.Api.Controllers;

/// <summary>Versiones del modelo y entrenamientos de Dreamur-Detector (región cerebro).</summary>
[ApiController]
[Produces("application/json")]
[Tags("Modelos y entrenamiento")]
public sealed class ModelosController(IModeloService modelos) : ControllerBase
{
    [HttpGet("api/modelos"), Authorize(Roles = Roles.Staff)]
    public async Task<ActionResult<IReadOnlyList<ModeloVersionDto>>> Listar(CancellationToken ct) =>
        Ok(await modelos.ListarVersionesAsync(ct));

    [HttpGet("api/modelos/activo"), Authorize(Roles = Roles.Staff)]
    public async Task<ActionResult<ModeloVersionDto>> Activo(CancellationToken ct) =>
        Ok(await modelos.ObtenerActivoAsync(ct));

    /// <summary>Activa una versión (sirve también para volver a una versión anterior).</summary>
    [HttpPost("api/modelos/{id:int}/activar"), Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<ModeloVersionDto>> Activar(int id, CancellationToken ct) =>
        Ok(await modelos.ActivarAsync(id, ct));

    [HttpGet("api/entrenamientos"), Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<PagedResult<EntrenamientoDto>>> Entrenamientos([FromQuery] PaginacionQuery paginacion, CancellationToken ct) =>
        Ok(await modelos.ListarEntrenamientosAsync(paginacion, ct));

    /// <summary>Dispara un reentrenamiento con las etiquetas disponibles (dataset + pacientes con consentimiento).</summary>
    [HttpPost("api/entrenamientos"), Authorize(Roles = Roles.Admin)]
    [ProducesResponseType<EntrenamientoDto>(StatusCodes.Status202Accepted)]
    public async Task<IActionResult> IniciarEntrenamiento(CancellationToken ct) =>
        Accepted(await modelos.IniciarEntrenamientoAsync(ct));

    /// <summary>Callback del servicio ML al terminar. Se autentica con la cabecera X-Api-Key (no con JWT).</summary>
    [HttpPost("api/entrenamientos/{id:int}/completar"), AllowAnonymous, ServiceApiKey]
    public async Task<ActionResult<EntrenamientoDto>> Completar(
        int id, CompletarEntrenamientoRequest request,
        [FromHeader(Name = ServiceApiKeyAttribute.Header)] string? apiKey, CancellationToken ct) =>
        Ok(await modelos.CompletarEntrenamientoAsync(id, request, ct));
}
