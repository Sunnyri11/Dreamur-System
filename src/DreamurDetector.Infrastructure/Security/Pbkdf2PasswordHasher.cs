using System.Security.Cryptography;

namespace DreamurDetector.Infrastructure.Security;

/// <summary>PBKDF2-HMAC-SHA512 (recomendación OWASP), sin dependencias externas. Formato: pbkdf2-sha512$iter$salt$hash.</summary>
public sealed class Pbkdf2PasswordHasher : IPasswordHasher
{
    private const int SaltSize = 16;
    private const int KeySize = 32;
    private const int Iteraciones = 210_000;
    private const string Prefijo = "pbkdf2-sha512";

    public string DummyHash { get; }

    public Pbkdf2PasswordHasher()
    {
        DummyHash = Hash(Guid.NewGuid().ToString("N"));
    }

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iteraciones, HashAlgorithmName.SHA512, KeySize);
        return $"{Prefijo}${Iteraciones}${Convert.ToBase64String(salt)}${Convert.ToBase64String(key)}";
    }

    public bool Verify(string password, string hash)
    {
        var partes = hash.Split('$');
        if (partes.Length != 4 || partes[0] != Prefijo || !int.TryParse(partes[1], out var iter) || iter <= 0)
            return false;
        try
        {
            var salt = Convert.FromBase64String(partes[2]);
            var esperado = Convert.FromBase64String(partes[3]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iter, HashAlgorithmName.SHA512, esperado.Length);
            return CryptographicOperations.FixedTimeEquals(actual, esperado);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
