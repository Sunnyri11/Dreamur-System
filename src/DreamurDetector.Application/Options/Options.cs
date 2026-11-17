namespace DreamurDetector.Application.Options;

public sealed class JwtOptions
{
    public const string Seccion = "Jwt";
    public string Issuer { get; set; } = "DreamurDetector.Api";
    public string Audience { get; set; } = "DreamurDetector.Clients";
    /// <summary>Clave HMAC. Mínimo 32 caracteres. Se define por variable de entorno Jwt__Key.</summary>
    public string Key { get; set; } = "";
    /// <summary>Duración del token de acceso. 240 min = 4 horas.</summary>
    public int ExpiraMinutos { get; set; } = 240;
}

public sealed class AuthOptions
{
    public const string Seccion = "Auth";
    public int MaxIntentosFallidos { get; set; } = 5;
    public int BloqueoMinutos { get; set; } = 15;
    public bool RequerirCorreoVerificado { get; set; } = true;
    public int VerificacionHoras { get; set; } = 24;
    public int RestablecerMinutos { get; set; } = 60;
}

public sealed class AppOptions
{
    public const string Seccion = "App";
    /// <summary>URL del frontend; se usa para armar los enlaces de los correos.</summary>
    public string FrontendUrl { get; set; } = "http://localhost:5173";
    /// <summary>URL pública de este backend (se envía al servicio ML como callback).</summary>
    public string PublicApiUrl { get; set; } = "";
}

public sealed class StorageOptions
{
    public const string Seccion = "Storage";
    /// <summary>"Local" (desarrollo) o "S3" (Cloudflare R2, AWS S3, MinIO...).</summary>
    public string Provider { get; set; } = "Local";
    public string LocalPath { get; set; } = "storage";
    public string ServiceUrl { get; set; } = "";
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string Bucket { get; set; } = "";
    public string Region { get; set; } = "auto";
    public int MaxFileMb { get; set; } = 20;
}

public sealed class DetectorOptions
{
    public const string Seccion = "Detector";
    public string BaseUrl { get; set; } = "http://localhost:8001";
    /// <summary>Clave que este backend envía al servicio ML (X-Api-Key).</summary>
    public string ApiKey { get; set; } = "";
    /// <summary>Clave que el servicio ML debe enviar al callback de entrenamientos.</summary>
    public string CallbackApiKey { get; set; } = "";
    public int TimeoutSegundos { get; set; } = 120;
}

public sealed class SeedOptions
{
    public const string Seccion = "Seed";
    public string AdminCorreo { get; set; } = "";
    public string AdminPassword { get; set; } = "";
    public string AdminNombres { get; set; } = "Administrador";
    public string AdminApellidos { get; set; } = "Dreamur";
}

public sealed class EmailOptions
{
    public const string Seccion = "Email";
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string Usuario { get; set; } = "";
    public string Password { get; set; } = "";
    public string Remitente { get; set; } = "no-reply@dreamur-detector.local";
    public string RemitenteNombre { get; set; } = "Dreamur-Detector";
    public bool UsarSsl { get; set; } = true;
    /// <summary>API key v3 de Brevo (xkeysib-...). Si se define, los correos salen por la API HTTPS de Brevo.</summary>
    public string BrevoApiKey { get; set; } = "";
    public string BrevoApiUrl { get; set; } = "https://api.brevo.com/v3/smtp/email";
}
