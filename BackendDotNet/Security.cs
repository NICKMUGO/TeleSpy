// Encryption, password hashing/bank, and secure random generation — mirrors
// Backend/security.py's design (not its exact byte format, since these are
// two independent backends that never need to decrypt each other's
// ciphertext): authenticated symmetric encryption (AES-256-CBC + HMAC-SHA256,
// encrypt-then-MAC — .NET has no built-in Fernet, so this hand-rolls the same
// "reversible ciphertext + separate one-way blind-index fingerprint" pattern
// using only System.Security.Cryptography, no extra package) plus a
// deterministic HMAC-SHA256 blind index for equality lookups on encrypted
// columns.
//
// FieldEncryptionKey and BlindIndexKey must be two *different* secrets (see
// .env.example) so compromising one doesn't help with the other.
//
// Passwords are hashed (bcrypt, via User.Password in Models/Entities.cs),
// never "encrypted" — a password hash must never be reversible. Everything
// unpredictable here (OTPs, reset tokens) is drawn from
// RandomNumberGenerator, the OS CSPRNG — never System.Random.
using System.Security.Cryptography;
using System.Text;
using TeleSpy.Core;

namespace TeleSpy;

public class DecryptionError : Exception
{
    public DecryptionError(string message) : base(message) { }
    public DecryptionError(string message, Exception inner) : base(message, inner) { }
}

public static class Security
{
    private static byte[] DeriveKey(string secret, string purpose) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(secret), outputLength: 32,
            info: Encoding.UTF8.GetBytes(purpose));

    private static byte[] EncKey() => DeriveKey(Config.FieldEncryptionKey, "telespy:field-encryption:aes");
    private static byte[] MacKey() => DeriveKey(Config.FieldEncryptionKey, "telespy:field-encryption:hmac");

    public static string? EncryptValue(string? plaintext)
    {
        if (string.IsNullOrEmpty(plaintext)) return null;

        using var aes = Aes.Create();
        aes.Key = EncKey();
        aes.GenerateIV();
        using var encryptor = aes.CreateEncryptor();
        var plainBytes = Encoding.UTF8.GetBytes(plaintext);
        var cipherBytes = encryptor.TransformFinalBlock(plainBytes, 0, plainBytes.Length);

        byte[] ivAndCipher = [.. aes.IV, .. cipherBytes];
        var mac = HMACSHA256.HashData(MacKey(), ivAndCipher);
        return Convert.ToBase64String([.. ivAndCipher, .. mac]);
    }

    public static string? DecryptValue(string? ciphertext)
    {
        if (string.IsNullOrEmpty(ciphertext)) return null;

        try
        {
            var token = Convert.FromBase64String(ciphertext);
            if (token.Length < 16 + 32) throw new DecryptionError("Could not decrypt stored value.");

            var iv = token[..16];
            var mac = token[^32..];
            var cipherBytes = token[16..^32];

            byte[] ivAndCipher = [.. iv, .. cipherBytes];
            var expectedMac = HMACSHA256.HashData(MacKey(), ivAndCipher);
            if (!CryptographicOperations.FixedTimeEquals(mac, expectedMac))
            {
                throw new DecryptionError("Could not decrypt stored value.");
            }

            using var aes = Aes.Create();
            aes.Key = EncKey();
            aes.IV = iv;
            using var decryptor = aes.CreateDecryptor();
            var plainBytes = decryptor.TransformFinalBlock(cipherBytes, 0, cipherBytes.Length);
            return Encoding.UTF8.GetString(plainBytes);
        }
        catch (DecryptionError)
        {
            throw;
        }
        catch (Exception exc)
        {
            throw new DecryptionError("Could not decrypt stored value.", exc);
        }
    }

    public static string? BlindIndex(string? value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        var key = Encoding.UTF8.GetBytes(Config.BlindIndexKey);
        var normalized = Encoding.UTF8.GetBytes(value.Trim().ToLowerInvariant());
        return Convert.ToHexStringLower(HMACSHA256.HashData(key, normalized));
    }

    /// <summary>Cryptographically secure numeric one-time code, e.g. for email MFA.</summary>
    public static string GenerateOtp(int length = 6)
    {
        var chars = new char[length];
        for (var i = 0; i < length; i++)
        {
            chars[i] = (char)('0' + RandomNumberGenerator.GetInt32(0, 10));
        }
        return new string(chars);
    }

    /// <summary>High-entropy URL-safe token for password reset links (48 raw
    /// bytes is comfortably more than enough to make guessing infeasible).</summary>
    public static string GenerateResetToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(48))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>One-way digest used to store/compare reset tokens and OTPs
    /// without keeping the sensitive value itself in the database.</summary>
    public static string HashToken(string token) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
