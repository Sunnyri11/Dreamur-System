using System.Net;
using System.Net.Mail;

namespace DreamurDetector.Infrastructure.Email;

/// <summary>Se usa cuando no hay SMTP configurado: escribe el correo en el log (útil en desarrollo).</summary>
public sealed class LogEmailSender(ILogger<LogEmailSender> log) : IEmailSender
{
    public Task EnviarAsync(string para, string asunto, string html, CancellationToken ct = default)
    {
        log.LogWarning("[EMAIL sin SMTP configurado] Para: {Para} | Asunto: {Asunto} | Cuerpo: {Html}", para, asunto, html);
        return Task.CompletedTask;
    }
}

public sealed class SmtpEmailSender(IOptions<EmailOptions> options) : IEmailSender
{
    public async Task EnviarAsync(string para, string asunto, string html, CancellationToken ct = default)
    {
        var o = options.Value;
        using var client = new SmtpClient(o.Host, o.Port)
        {
            EnableSsl = o.UsarSsl,
            Credentials = new NetworkCredential(o.Usuario, o.Password)
        };
        using var msg = new MailMessage(new MailAddress(o.Remitente, "Dreamur-Detector"), new MailAddress(para))
        {
            Subject = asunto,
            Body = html,
            IsBodyHtml = true
        };
        await client.SendMailAsync(msg, ct);
    }
}
