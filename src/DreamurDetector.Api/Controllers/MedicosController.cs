namespace DreamurDetector.Api.Controllers;

/// <summary>Listado de médicos (solo administrador). El alta se hace con POST /api/usuarios (rol «medico»).</summary>
[ApiController]
[Route("api/medicos")]
[Produces("application/json")]
[Authorize(Roles = Roles.Admin)]
[Tags("Médicos (admin)")]
public sealed class MedicosController(IMedicoService medicos) : ControllerBase
{
    /// <summary>Lista médicos con su estado, último acceso y número de pacientes vinculados.</summary>
    [HttpGet]
    public async Task<ActionResult<PagedResult<MedicoDto>>> Listar([FromQuery] MedicoFiltro filtro, CancellationToken ct) =>
        Ok(await medicos.ListarAsync(filtro, ct));
}
