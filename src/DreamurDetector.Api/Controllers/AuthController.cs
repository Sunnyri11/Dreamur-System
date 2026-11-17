using Microsoft.AspNetCore.RateLimiting;

namespace DreamurDetector.Api.Controllers;

/// <summary>Registro, inicio/cierre de sesión (JWT de 4 horas), verificación de correo y recuperación de contraseña.</summary>
[ApiController]
[Route("api/auth")]
[Produces("application/json")]
[Tags("Autenticación")]
public sealed class AuthController(IAuthService auth) : ControllerBase
{
    /// <summary>Crea una cuenta de paciente.</summary>
    /// <remarks>
    /// Con confirmación de correo obligatoria (por defecto) responde 202: se envía un enlace por Brevo y la sesión
    /// se abre al iniciar sesión después de confirmarlo. Si la confirmación está desactivada, responde 201 con la sesión.
    /// </remarks>
    [HttpPost("registro"), AllowAnonymous, EnableRateLimiting("auth")]
    [ProducesResponseType<AuthResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<MensajeResponse>(StatusCodes.Status202Accepted)]
    public async Task<IActionResult> Registro(RegistroRequest request, CancellationToken ct)
    {
        var sesion = await auth.RegistrarAsync(request, ct);
        return sesion is null
            ? Accepted(new MensajeResponse("Cuenta creada. Te enviamos un correo para confirmarla; revisa también la carpeta de spam."))
            : StatusCode(StatusCodes.Status201Created, sesion);
    }

    /// <summary>Inicia sesión. Devuelve un JWT válido por 4 horas.</summary>
    /// <remarks>Tras 5 intentos fallidos la cuenta se bloquea 15 minutos.</remarks>
    [HttpPost("login"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request, CancellationToken ct) =>
        Ok(await auth.LoginAsync(request, ct));

    /// <summary>Cierra la sesión: el token actual deja de ser válido de inmediato.</summary>
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        await auth.LogoutAsync(ct);
        return NoContent();
    }

    /// <summary>Cambia el rol activo (paciente | medico | admin) entre los perfiles que tiene la cuenta.</summary>
    [HttpPost("cambiar-rol")]
    public async Task<ActionResult<AuthResponse>> CambiarRol(CambiarRolRequest request, CancellationToken ct) =>
        Ok(await auth.CambiarRolAsync(request, ct));

    /// <summary>Activa un perfil adicional: paciente (médicos/admin) o médico (admin). Devuelve la sesión con el rol nuevo.</summary>
    [HttpPost("activar-rol")]
    public async Task<ActionResult<AuthResponse>> ActivarRol(ActivarRolRequest request, CancellationToken ct) =>
        Ok(await auth.ActivarRolAsync(request, ct));

    /// <summary>Datos del usuario autenticado.</summary>
    [HttpGet("me")]
    public async Task<ActionResult<UsuarioDto>> Me(CancellationToken ct) => Ok(await auth.MeAsync(ct));

    /// <summary>Cambia la contraseña y cierra la sesión actual.</summary>
    [HttpPost("cambiar-password")]
    public async Task<IActionResult> CambiarPassword(CambiarPasswordRequest request, CancellationToken ct)
    {
        await auth.CambiarPasswordAsync(request, ct);
        return NoContent();
    }

    /// <summary>Envía un enlace de restablecimiento. Responde igual exista o no la cuenta.</summary>
    [HttpPost("olvide-password"), AllowAnonymous, EnableRateLimiting("auth")]
    [ProducesResponseType<MensajeResponse>(StatusCodes.Status202Accepted)]
    public async Task<IActionResult> OlvidePassword(OlvidePasswordRequest request, CancellationToken ct)
    {
        await auth.SolicitarRestablecimientoAsync(request, ct);
        return Accepted(new MensajeResponse("Si el correo está registrado, recibirá un enlace para restablecer su contraseña."));
    }

    /// <summary>Define una nueva contraseña usando el token recibido por correo.</summary>
    [HttpPost("restablecer-password"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<ActionResult<MensajeResponse>> RestablecerPassword(RestablecerPasswordRequest request, CancellationToken ct)
    {
        await auth.RestablecerPasswordAsync(request, ct);
        return Ok(new MensajeResponse("Contraseña actualizada. Ya puede iniciar sesión."));
    }

    /// <summary>Confirma el correo con el token recibido por email.</summary>
    [HttpPost("verificar-correo"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<ActionResult<MensajeResponse>> VerificarCorreo(VerificarCorreoRequest request, CancellationToken ct)
    {
        await auth.VerificarCorreoAsync(request, ct);
        return Ok(new MensajeResponse("Correo verificado correctamente."));
    }

    /// <summary>Reenvía el correo de confirmación sin necesidad de sesión. Responde igual exista o no la cuenta.</summary>
    [HttpPost("reenviar-verificacion-publico"), AllowAnonymous, EnableRateLimiting("auth")]
    [ProducesResponseType<MensajeResponse>(StatusCodes.Status202Accepted)]
    public async Task<IActionResult> ReenviarVerificacionPublico(ReenviarVerificacionRequest request, CancellationToken ct)
    {
        await auth.ReenviarVerificacionPublicaAsync(request, ct);
        return Accepted(new MensajeResponse("Si la cuenta existe y falta confirmarla, recibirá un nuevo enlace."));
    }

    /// <summary>Reenvía el correo de verificación al usuario autenticado.</summary>
    [HttpPost("reenviar-verificacion"), EnableRateLimiting("auth")]
    [ProducesResponseType<MensajeResponse>(StatusCodes.Status202Accepted)]
    public async Task<IActionResult> ReenviarVerificacion(CancellationToken ct)
    {
        await auth.ReenviarVerificacionAsync(ct);
        return Accepted(new MensajeResponse("Le enviamos un nuevo correo de verificación."));
    }
}
