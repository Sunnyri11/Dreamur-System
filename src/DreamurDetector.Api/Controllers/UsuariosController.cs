namespace DreamurDetector.Api.Controllers;

/// <summary>Administración de cuentas (solo admin): alta de médicos/administradores, activar/desactivar, desbloquear.</summary>
[ApiController]
[Route("api/usuarios")]
[Produces("application/json")]
[Authorize(Roles = Roles.Admin)]
[Tags("Usuarios (admin)")]
public sealed class UsuariosController(IUsuarioService usuarios) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<UsuarioDto>>> Listar([FromQuery] UsuarioFiltro filtro, CancellationToken ct) =>
        Ok(await usuarios.ListarAsync(filtro, ct));

    /// <summary>Crea una cuenta de médico o administrador (los pacientes se registran solos).</summary>
    [HttpPost]
    [ProducesResponseType<UsuarioDto>(StatusCodes.Status201Created)]
    public async Task<IActionResult> Crear(CrearUsuarioRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await usuarios.CrearAsync(request, ct));

    [HttpPatch("{id:guid}/estado")]
    public async Task<ActionResult<UsuarioDto>> CambiarEstado(Guid id, CambiarEstadoUsuarioRequest request, CancellationToken ct) =>
        Ok(await usuarios.CambiarEstadoAsync(id, request.Activo, ct));

    [HttpPost("{id:guid}/desbloquear")]
    public async Task<ActionResult<UsuarioDto>> Desbloquear(Guid id, CancellationToken ct) =>
        Ok(await usuarios.DesbloquearAsync(id, ct));
}
