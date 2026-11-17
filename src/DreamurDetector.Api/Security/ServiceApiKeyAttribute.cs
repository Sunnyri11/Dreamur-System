using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;
using DreamurDetector.Api.Middleware;

namespace DreamurDetector.Api.Security;

/// <summary>Autentica llamadas servidor-a-servidor (el servicio ML) con la cabecera X-Api-Key = Detector:CallbackApiKey.</summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class ServiceApiKeyAttribute : Attribute, IAsyncActionFilter
{
    public const string Header = "X-Api-Key";

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var esperada = context.HttpContext.RequestServices
            .GetRequiredService<IOptions<DetectorOptions>>().Value.CallbackApiKey;
        var recibida = context.HttpContext.Request.Headers[Header].ToString();

        var valida = !string.IsNullOrEmpty(esperada) &&
                     CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(esperada), Encoding.UTF8.GetBytes(recibida));
        if (!valida)
        {
            await ProblemWriter.EscribirAsync(context.HttpContext, 401, "API key de servicio inválida o ausente.", "api_key_invalida");
            context.Result = new EmptyResult();
            return;
        }
        await next();
    }
}
