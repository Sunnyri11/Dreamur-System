using System.Security.Claims;

namespace DreamurDetector.Api.Security;

/// <summary>Usuario actual leído de los claims del JWT (sub, persona_id, role, jti, exp).</summary>
public sealed class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private ClaimsPrincipal? User => accessor.HttpContext?.User;

    private string? Claim(string tipo) => User?.FindFirst(tipo)?.Value;

    public bool EstaAutenticado => User?.Identity?.IsAuthenticated == true;
    public Guid? UsuarioId => Guid.TryParse(Claim("sub"), out var id) ? id : null;
    public Guid? PersonaId => Guid.TryParse(Claim("persona_id"), out var id) ? id : null;
    public string? Rol => Claim("role");
    public string? Jti => Claim("jti");
    public DateTimeOffset? TokenExpiraEn =>
        long.TryParse(Claim("exp"), out var s) ? DateTimeOffset.FromUnixTimeSeconds(s) : null;
    public string? Ip => accessor.HttpContext?.Connection.RemoteIpAddress?.ToString();
}
