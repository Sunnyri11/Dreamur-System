using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace DreamurDetector.Infrastructure.Email;

/// <summary>
/// Envía correos por la API HTTPS de Brevo (POST /v3/smtp/email).
/// Se usa la API y no el relé SMTP porque los planes gratuitos de Render bloquean los puertos SMTP salientes.
/// Requisito en Brevo: el remitente (Email__Remitente) debe estar verificado en Senders &amp; IP.
/// </summary>
public sealed class BrevoEmailSender(HttpClient http, IOptions<EmailOptions> options, ILogger<BrevoEmailSender> log) : IEmailSender
{
    public async Task EnviarAsync(string para, string asunto, string html, CancellationToken ct = default)
    {
        var o = options.Value;
        using var req = new HttpRequestMessage(HttpMethod.Post, o.BrevoApiUrl)
        {
            Content = JsonContent.Create(new BrevoMensaje
            {
                Sender = new BrevoContacto { Name = o.RemitenteNombre, Email = o.Remitente },
                To = [new BrevoContacto { Email = para }],
                Subject = asunto,
                HtmlContent = html
            })
        };
        req.Headers.Add("api-key", o.BrevoApiKey);
        req.Headers.Add("accept", "application/json");

        using var resp = await http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var detalle = await resp.Content.ReadAsStringAsync(ct);
            log.LogError("Brevo rechazó el correo para {Para}: {Status} {Detalle}", para, (int)resp.StatusCode, detalle);
            throw new HttpRequestException($"Brevo respondió {(int)resp.StatusCode}.");
        }
    }

    private sealed class BrevoMensaje
    {
        [JsonPropertyName("sender")] public BrevoContacto Sender { get; set; } = new();
        [JsonPropertyName("to")] public List<BrevoContacto> To { get; set; } = [];
        [JsonPropertyName("subject")] public string Subject { get; set; } = "";
        [JsonPropertyName("htmlContent")] public string HtmlContent { get; set; } = "";
    }

    private sealed class BrevoContacto
    {
        [JsonPropertyName("name"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Name { get; set; }
        [JsonPropertyName("email")] public string Email { get; set; } = "";
    }
}
