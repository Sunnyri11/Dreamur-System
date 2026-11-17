namespace DreamurDetector.Api.Controllers;

[ApiController]
[Route("api/pacientes")]
[Produces("application/json")]
[Tags("Pacientes")]
public sealed class PacientesController(
    IPacienteService pacientes,
    IEvolucionService evolucion,
    ICurrentUser current) : ControllerBase
{
    /// <summary>Lista pacientes. Médico: solo los vinculados a él. Admin: todos. Busca por nombre, código o documento.</summary>
    [HttpGet, Authorize(Roles = Roles.Staff)]
    public async Task<ActionResult<PagedResult<PacienteResumenDto>>> Listar([FromQuery] PacienteFiltro filtro, CancellationToken ct) =>
        Ok(await pacientes.ListarAsync(filtro, ct));

    /// <summary>El médico da de alta a un paciente nuevo; queda vinculado solo a ese médico.</summary>
    [HttpPost, Authorize(Roles = Roles.Medico)]
    [ProducesResponseType<PacienteDto>(StatusCodes.Status201Created)]
    public async Task<IActionResult> Crear(CrearPacienteMedicoRequest request, CancellationToken ct)
    {
        var dto = await pacientes.CrearPorMedicoAsync(request, ct);
        return CreatedAtAction(nameof(Obtener), new { id = dto.PersonaId }, dto);
    }

    /// <summary>El médico vincula un paciente ya registrado con su código PAC-xxxxxx o su documento.</summary>
    [HttpPost("vincular"), Authorize(Roles = Roles.Medico)]
    public async Task<ActionResult<PacienteDto>> Vincular(VincularPacienteRequest request, CancellationToken ct) =>
        Ok(await pacientes.VincularAsync(request, ct));

    /// <summary>Quita al paciente de la lista del médico (no borra al paciente ni sus datos).</summary>
    [HttpDelete("{id:guid}/vinculo"), Authorize(Roles = Roles.Medico)]
    public async Task<IActionResult> Desvincular(Guid id, CancellationToken ct)
    {
        await pacientes.DesvincularAsync(id, ct);
        return NoContent();
    }

    /// <summary>Ficha del paciente autenticado.</summary>
    [HttpGet("me"), Authorize(Roles = Roles.Paciente)]
    public async Task<ActionResult<PacienteDto>> Mi(CancellationToken ct) =>
        Ok(await pacientes.ObtenerAsync(current.RequerirPersonaId(), ct));

    /// <summary>Ficha de un paciente (él mismo, su médico vinculado o un administrador).</summary>
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<PacienteDto>> Obtener(Guid id, CancellationToken ct) =>
        Ok(await pacientes.ObtenerAsync(id, ct));

    /// <summary>Actualiza datos personales y clínicos (paciente o su médico vinculado; el admin no edita a terceros).</summary>
    [HttpPatch("{id:guid}")]
    public async Task<ActionResult<PacienteDto>> Actualizar(Guid id, ActualizarPacienteRequest request, CancellationToken ct) =>
        Ok(await pacientes.ActualizarAsync(id, request, ct));

    /// <summary>Evolución del paciente: resultado de la última detección de cada imagen, ordenado en el tiempo.</summary>
    [HttpGet("{id:guid}/evolucion")]
    public async Task<ActionResult<EvolucionDto>> Evolucion(Guid id, CancellationToken ct) =>
        Ok(await evolucion.ObtenerAsync(id, ct));

    /// <summary>Historial de consentimientos del paciente.</summary>
    [HttpGet("{id:guid}/consentimientos")]
    public async Task<ActionResult<IReadOnlyList<ConsentimientoDto>>> Consentimientos(Guid id, CancellationToken ct) =>
        Ok(await pacientes.ListarConsentimientosAsync(id, ct));

    /// <summary>Registra un cambio de consentimiento (cada cambio es una fila nueva; vale el último).</summary>
    [HttpPost("me/consentimientos"), Authorize(Roles = Roles.Paciente)]
    [ProducesResponseType<ConsentimientoDto>(StatusCodes.Status201Created)]
    public async Task<IActionResult> RegistrarConsentimiento(ConsentimientoRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await pacientes.RegistrarConsentimientoAsync(request, ct));
}
