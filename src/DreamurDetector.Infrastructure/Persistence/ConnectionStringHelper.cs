using Microsoft.Extensions.Configuration;
using Npgsql;

namespace DreamurDetector.Infrastructure.Persistence;

public static class ConnectionStringHelper
{
    /// <summary>
    /// Resuelve la conexión a Neon. Orden: variable DATABASE_URL, luego ConnectionStrings:Default.
    /// Acepta formato URI (postgresql://user:pass@host/db?sslmode=require, el que muestra Neon)
    /// o formato Npgsql (Host=...;Database=...).
    /// </summary>
    public static string Resolve(IConfiguration config)
    {
        var raw = Environment.GetEnvironmentVariable("DATABASE_URL");
        if (string.IsNullOrWhiteSpace(raw)) raw = config.GetConnectionString("Default");

        if (string.IsNullOrWhiteSpace(raw))
            throw new InvalidOperationException(
                "Falta la cadena de conexión a la base de datos. Define DATABASE_URL o ConnectionStrings__Default.");

        raw = raw.Trim();
        if (!raw.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) &&
            !raw.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
            return raw;

        var uri = new Uri(raw);
        var userInfo = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = uri.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
            SslMode = SslMode.Require,
            MaxPoolSize = 10,
            Timeout = 30,          // Neon puede tardar unos segundos en despertar tras autosuspend
            CommandTimeout = 60
        };
        return builder.ConnectionString;
    }
}
