// Encryption, password hashing/bank, and secure random generation:
// authenticated, crypto-agile field encryption (Core/FieldEncryption.cs —
// AES-256-GCM for new values, versioned so algorithm and key can change)
// plus a deterministic HMAC-SHA256 blind index for equality lookups on
// encrypted columns.
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
    // Reversible field encryption lives in Core/FieldEncryption.cs, which is
    // crypto-agile (versioned ciphertexts, pluggable algorithms, key
    // rotation). These two keep the original call sites unchanged.
    public static string? EncryptValue(string? plaintext) =>
        string.IsNullOrEmpty(plaintext) ? null : FieldEncryption.Encrypt(plaintext);

    public static string? DecryptValue(string? ciphertext) =>
        string.IsNullOrEmpty(ciphertext) ? null : FieldEncryption.Decrypt(ciphertext);

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
