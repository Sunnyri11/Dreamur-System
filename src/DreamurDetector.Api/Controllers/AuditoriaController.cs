namespace DreamurDetector.Api.Controllers;

[ApiController]
[Route("api/auditoria")]
[Produces("application/json")]
[Authorize(Roles = Roles.Admin)]
[Tags("Auditoría (admin)")]
public sealed class AuditoriaController(IAuditoriaService auditoria) : ControllerBase
{
    /// <summary>Registro de acciones sensibles (logins, subidas, detecciones, cambios de etiqueta...).</summary>
    [HttpGet]
    public async Task<ActionResult<PagedResult<AuditoriaDto>>> Listar([FromQuery] AuditoriaFiltro filtro, CancellationToken ct) =>
        Ok(await auditoria.ListarAsync(filtro, ct));
}
