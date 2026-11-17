using DreamurDetector.Application.Common;
using DreamurDetector.Application.Dtos;

namespace DreamurDetector.Application.Interfaces;

// ---------- Tipos auxiliares ----------
public sealed record TokenSubject(Guid UsuarioId, Guid PersonaId, string Rol, string Correo, string NombreCompleto);
public sealed record TokenEmitido(string Token, string Jti, DateTimeOffset ExpiraEn);

public sealed record ArchivoSubido(Stream Contenido, string NombreArchivo, string ContentType, long Length);
public sealed record ArchivoDescargado(Stream Contenido, string Mime, string NombreArchivo);

public sealed record DetectorZona(float X, float Y, float Ancho, float Alto, float? Puntaje);
public sealed record DetectorResultado(
    string? TipoTumor, float Confianza, IReadOnlyDictionary<string, float>? Probabilidades,
    IReadOnlyList<DetectorZona> Zonas, int? ModeloVersion,
    bool ImagenValida, string? TipoImagen, string? Mensaje);

// ---------- Seguridad ----------
public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string password, string hash);
    /// <summary>Hash válido pero inventado, para igualar tiempos cuando el usuario no existe.</summary>
    string DummyHash { get; }
}

public interface ITokenService
{
    TokenEmitido CrearAccessToken(TokenSubject subject);
}

public interface ISesionValidator
{
    /// <summary>true si el usuario sigue activo y el jti no fue revocado (logout).</summary>
    Task<bool> EsValidaAsync(Guid usuarioId, string jti, CancellationToken ct);
}

// ---------- Infraestructura externa ----------
public interface IEmailSender
{
    Task EnviarAsync(string para, string asunto, string html, CancellationToken ct = default);
}

public interface IStorageService
{
    Task SubirAsync(string key, Stream contenido, string mime, CancellationToken ct);
    Task<Stream> DescargarAsync(string key, CancellationToken ct);
    Task EliminarAsync(string key, CancellationToken ct);
}

public interface IDetectorClient
{
    Task<DetectorResultado> PredecirAsync(Stream imagen, string nombreArchivo, string mime, string region, CancellationToken ct);
    Task IniciarEntrenamientoAsync(int entrenamientoId, string region, CancellationToken ct);
}

// ---------- Servicios de aplicación ----------
public interface IAuthService
{
    /// <summary>Devuelve null cuando se exige confirmar el correo: no se abre sesión hasta confirmarlo.</summary>
    Task<AuthResponse?> RegistrarAsync(RegistroRequest request, CancellationToken ct);
    Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken ct);
    Task LogoutAsync(CancellationToken ct);
    /// <summary>Cambia el rol activo (solo entre los perfiles que la persona tiene). Emite un token nuevo y revoca el actual.</summary>
    Task<AuthResponse> CambiarRolAsync(CambiarRolRequest request, CancellationToken ct);
    /// <summary>Activa un perfil adicional: paciente (médico/admin) o médico (admin). Un paciente nunca puede ser médico/admin.</summary>
    Task<AuthResponse> ActivarRolAsync(ActivarRolRequest request, CancellationToken ct);
    Task<UsuarioDto> MeAsync(CancellationToken ct);
    Task CambiarPasswordAsync(CambiarPasswordRequest request, CancellationToken ct);
    Task SolicitarRestablecimientoAsync(OlvidePasswordRequest request, CancellationToken ct);
    Task RestablecerPasswordAsync(RestablecerPasswordRequest request, CancellationToken ct);
    Task VerificarCorreoAsync(VerificarCorreoRequest request, CancellationToken ct);
    Task ReenviarVerificacionAsync(CancellationToken ct);
    /// <summary>Reenvío sin sesión (para quien aún no puede iniciarla). No revela si el correo existe.</summary>
    Task ReenviarVerificacionPublicaAsync(ReenviarVerificacionRequest request, CancellationToken ct);
}

public interface IPacienteService
{
    Task<PagedResult<PacienteResumenDto>> ListarAsync(PacienteFiltro filtro, CancellationToken ct);
    Task<PacienteDto> ObtenerAsync(Guid personaId, CancellationToken ct);
    Task<PacienteDto> ActualizarAsync(Guid personaId, ActualizarPacienteRequest request, CancellationToken ct);
    Task<PacienteDto> CrearPorMedicoAsync(CrearPacienteMedicoRequest request, CancellationToken ct);
    Task<PacienteDto> VincularAsync(VincularPacienteRequest request, CancellationToken ct);
    Task DesvincularAsync(Guid pacienteId, CancellationToken ct);
    Task<IReadOnlyList<ConsentimientoDto>> ListarConsentimientosAsync(Guid personaId, CancellationToken ct);
    Task<ConsentimientoDto> RegistrarConsentimientoAsync(ConsentimientoRequest request, CancellationToken ct);
}

public interface IRadiografiaService
{
    Task<RadiografiaDto> SubirAsync(SubirRadiografiaRequest request, ArchivoSubido archivo, CancellationToken ct);
    Task<PagedResult<RadiografiaDto>> ListarAsync(RadiografiaFiltro filtro, CancellationToken ct);
    Task<RadiografiaDto> ObtenerAsync(Guid id, CancellationToken ct);
    Task<ArchivoDescargado> ObtenerArchivoAsync(Guid id, CancellationToken ct);
    Task EliminarAsync(Guid id, CancellationToken ct);
}

public interface IDeteccionService
{
    Task<DeteccionDto> AnalizarAsync(Guid radiografiaId, CancellationToken ct);
    Task<IReadOnlyList<DeteccionDto>> HistorialAsync(Guid radiografiaId, CancellationToken ct);
    Task<DeteccionDto> ObtenerAsync(Guid id, CancellationToken ct);
}

public interface IEtiquetaService
{
    Task<EtiquetaDto> ObtenerAsync(Guid radiografiaId, CancellationToken ct);
    Task<EtiquetaDto> GuardarAsync(Guid radiografiaId, EtiquetaRequest request, CancellationToken ct);
    Task EliminarAsync(Guid radiografiaId, CancellationToken ct);
}

public interface IModeloService
{
    Task<IReadOnlyList<ModeloVersionDto>> ListarVersionesAsync(CancellationToken ct);
    Task<ModeloVersionDto> ObtenerActivoAsync(CancellationToken ct);
    Task<ModeloVersionDto> ActivarAsync(int modeloVersionId, CancellationToken ct);
    Task<PagedResult<EntrenamientoDto>> ListarEntrenamientosAsync(PaginacionQuery paginacion, CancellationToken ct);
    Task<EntrenamientoDto> IniciarEntrenamientoAsync(CancellationToken ct);
    Task<EntrenamientoDto> CompletarEntrenamientoAsync(int id, CompletarEntrenamientoRequest request, CancellationToken ct);
}

public interface IUsuarioService
{
    Task<PagedResult<UsuarioDto>> ListarAsync(UsuarioFiltro filtro, CancellationToken ct);
    Task<UsuarioDto> CrearAsync(CrearUsuarioRequest request, CancellationToken ct);
    Task<UsuarioDto> CambiarEstadoAsync(Guid usuarioId, bool activo, CancellationToken ct);
    Task<UsuarioDto> DesbloquearAsync(Guid usuarioId, CancellationToken ct);
}

public interface IAuditoriaService
{
    Task RegistrarAsync(string accion, string? entidad = null, string? entidadId = null, object? detalle = null,
        Guid? usuarioId = null, CancellationToken ct = default);
    Task<PagedResult<AuditoriaDto>> ListarAsync(AuditoriaFiltro filtro, CancellationToken ct);
}

public interface IPerfilService
{
    Task<PerfilDto> ObtenerAsync(CancellationToken ct);
    Task<PerfilDto> ActualizarAsync(ActualizarPerfilRequest request, CancellationToken ct);
}

public interface IMedicoService
{
    Task<PagedResult<MedicoDto>> ListarAsync(MedicoFiltro filtro, CancellationToken ct);
}

public interface IEvolucionService
{
    Task<EvolucionDto> ObtenerAsync(Guid pacienteId, CancellationToken ct);
}

public interface ICatalogoService
{
    Task<IReadOnlyList<TipoTumorDto>> ListarTiposTumorAsync(CancellationToken ct);
}
