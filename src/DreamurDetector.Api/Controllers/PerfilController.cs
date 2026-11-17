namespace DreamurDetector.Api.Controllers;

/// <summary>Perfil del usuario autenticado (paciente, médico o administrador): ver y editar sus propios datos.</summary>
[ApiController]
[Route("api/perfil")]
[Produces("application/json")]
[Tags("Perfil")]
public sealed class PerfilController(IPerfilService perfil) : ControllerBase
{
    /// <summary>Todos mis datos personales (y los propios de mi rol: clínicos, matrícula, nivel admin...).</summary>
    [HttpGet]
    public async Task<ActionResult<PerfilDto>> Obtener(CancellationToken ct) =>
        Ok(await perfil.ObtenerAsync(ct));

    /// <summary>Actualiza mis datos. null = no cambia; cadena vacía = borrar el valor (campos opcionales).</summary>
    [HttpPatch]
    public async Task<ActionResult<PerfilDto>> Actualizar(ActualizarPerfilRequest request, CancellationToken ct) =>
        Ok(await perfil.ActualizarAsync(request, ct));
}
