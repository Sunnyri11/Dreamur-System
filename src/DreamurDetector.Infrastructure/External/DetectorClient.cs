using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace DreamurDetector.Infrastructure.External;

/// <summary>
/// Cliente HTTP del servicio ML de Dreamur-Detector.
/// Contrato asumido (ajústalo aquí si tu servicio difiere):
///   POST {BaseUrl}/predict  multipart: file (imagen), region ("cerebro")
///     -> { "imagen_valida": true, "tipo_imagen": "resonancia_cerebral", "mensaje": null,
///          "tipo_tumor": "glioma", "confianza": 0.93, "probabilidades": { "glioma": 0.93, ... },
///          "zonas": [ { "x": .., "y": .., "ancho": .., "alto": .., "puntaje": .. } ], "modelo_version": 3 }
///   POST {BaseUrl}/train    json: { "entrenamiento_id": 1, "region": "cerebro", "callback_url": "..." }
/// Coordenadas de zonas normalizadas 0..1. Cabecera X-Api-Key si Detector:ApiKey está definida.
/// </summary>
public sealed class DetectorClient(
    HttpClient http,
    IOptions<AppOptions> appOptions,
    ILogger<DetectorClient> log) : IDetectorClient
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    public async Task<DetectorResultado> PredecirAsync(Stream imagen, string nombre, string mime, string region, CancellationToken ct)
    {
        using var contenido = new MultipartFormDataContent();
        var archivo = new StreamContent(imagen);
        archivo.Headers.ContentType = new MediaTypeHeaderValue(mime);
        contenido.Add(archivo, "file", nombre);
        contenido.Add(new StringContent(region), "region");

        using var resp = await EnviarAsync(() => http.PostAsync("predict", contenido, ct), ct);
        var dto = await resp.Content.ReadFromJsonAsync<PredictResponse>(Json, ct)
                  ?? throw new ServicioExternoException("El servicio de detección devolvió una respuesta vacía.");

        var valida = dto.ImagenValida ?? true; // si el servicio no informa validez, se asume válida
        if (valida && string.IsNullOrWhiteSpace(dto.TipoTumor))
            throw new ServicioExternoException("El servicio de detección no devolvió 'tipo_tumor'.");

        var zonas = (dto.Zonas ?? [])
            .Select(z => new DetectorZona(z.X, z.Y, z.Ancho, z.Alto, z.Puntaje))
            .ToList();
        return new DetectorResultado(
            string.IsNullOrWhiteSpace(dto.TipoTumor) ? null : dto.TipoTumor, dto.Confianza, dto.Probabilidades, zonas,
            dto.ModeloVersion, valida, dto.TipoImagen, dto.Mensaje);
    }

    public async Task IniciarEntrenamientoAsync(int entrenamientoId, string region, CancellationToken ct)
    {
        var publica = appOptions.Value.PublicApiUrl.TrimEnd('/');
        var cuerpo = new
        {
            entrenamiento_id = entrenamientoId,
            region,
            callback_url = string.IsNullOrEmpty(publica) ? null : $"{publica}/api/entrenamientos/{entrenamientoId}/completar"
        };
        using var resp = await EnviarAsync(() => http.PostAsJsonAsync("train", cuerpo, ct), ct);
    }

    private async Task<HttpResponseMessage> EnviarAsync(Func<Task<HttpResponseMessage>> envio, CancellationToken ct)
    {
        HttpResponseMessage resp;
        try
        {
            resp = await envio();
        }
        catch (Exception ex) when ((ex is HttpRequestException || ex is TaskCanceledException) && !ct.IsCancellationRequested)
        {
            log.LogError(ex, "No se pudo contactar al servicio de detección");
            throw new ServicioExternoException("No se pudo contactar al servicio de detección. Intente de nuevo en unos minutos.", ex);
        }

        if (!resp.IsSuccessStatusCode)
        {
            var cuerpo = await resp.Content.ReadAsStringAsync(ct);
            log.LogWarning("Servicio de detección respondió {Status}: {Cuerpo}", (int)resp.StatusCode, cuerpo);
            var codigo = (int)resp.StatusCode;
            resp.Dispose();
            throw new ServicioExternoException($"El servicio de detección respondió con error {codigo}.");
        }
        return resp;
    }

    private sealed class PredictResponse
    {
        public bool? ImagenValida { get; set; }
        public string? TipoImagen { get; set; }
        public string? Mensaje { get; set; }
        public string? TipoTumor { get; set; }
        public float Confianza { get; set; }
        public Dictionary<string, float>? Probabilidades { get; set; }
        public List<ZonaResponse>? Zonas { get; set; }
        public int? ModeloVersion { get; set; }
    }

    private sealed class ZonaResponse
    {
        public float X { get; set; }
        public float Y { get; set; }
        public float Ancho { get; set; }
        public float Alto { get; set; }
        public float? Puntaje { get; set; }
    }
}
