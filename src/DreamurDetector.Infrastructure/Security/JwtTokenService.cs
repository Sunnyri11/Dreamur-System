using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace DreamurDetector.Infrastructure.Security;

/// <summary>Emite JWT HS256. Claims: sub, jti, persona_id, role, email, name. Duración: Jwt:ExpiraMinutos (240 = 4 h).</summary>
public sealed class JwtTokenService : ITokenService
{
    private readonly JwtOptions _opt;
    private readonly SigningCredentials _credenciales;
    private readonly JsonWebTokenHandler _handler = new();

    public JwtTokenService(IOptions<JwtOptions> options)
    {
        _opt = options.Value;
        _credenciales = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_opt.Key)), SecurityAlgorithms.HmacSha256);
    }

    public TokenEmitido CrearAccessToken(TokenSubject s)
    {
        var ahora = DateTime.UtcNow;
        var expira = ahora.AddMinutes(_opt.ExpiraMinutos);
        var jti = Guid.NewGuid().ToString("N");

        var claims = new List<Claim>
        {
            new("sub", s.UsuarioId.ToString()),
            new("jti", jti),
            new("persona_id", s.PersonaId.ToString()),
            new("role", s.Rol),
            new("email", s.Correo),
            new("name", s.NombreCompleto)
        };

        var descriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Issuer = _opt.Issuer,
            Audience = _opt.Audience,
            NotBefore = ahora,
            IssuedAt = ahora,
            Expires = expira,
            SigningCredentials = _credenciales
        };

        return new TokenEmitido(_handler.CreateToken(descriptor), jti, new DateTimeOffset(expira));
    }
}
