namespace DreamurDetector.Api.Controllers;

[ApiController]
[Route("api/catalogo")]
[Produces("application/json")]
[Tags("Catálogo")]
public sealed class CatalogoController(ICatalogoService catalogo) : ControllerBase
{
    /// <summary>Tipos de tumor aplicables a cerebro (incluye «sin_tumor»).</summary>
    [HttpGet("tipos-tumor")]
    public async Task<ActionResult<IReadOnlyList<TipoTumorDto>>> TiposTumor(CancellationToken ct) =>
        Ok(await catalogo.ListarTiposTumorAsync(ct));
}
