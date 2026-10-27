// Crypto-agile field encryption for personal data stored in the database
// (SIM numbers and ICCIDs, ticket customer details).
//
// Every value written is self-describing:
//
//     enc:<algorithm id>:<key id>:<base64 payload>
//
// so the algorithm and the key can both change without breaking anything
// already stored:
//   * New algorithm — implement IFieldCipher, register it in Ciphers, and
//     set FIELD_ENCRYPTION_ALGORITHM. Old values still decrypt with the
//     cipher their prefix names.
//   * New key — set FIELD_ENCRYPTION_KEY (+ FIELD_ENCRYPTION_KEY_ID) to the
//     new secret and move the old one to FIELD_ENCRYPTION_OLD_KEYS. Old
//     values still decrypt with the key their prefix names.
//   * Then `dotnet run -- --reencrypt` rewrites every stored value with the
//     current algorithm and key, after which the old key can be retired.
//
// Values written before this existed carry no prefix. They were made by
// AesCbcHmacSha256Cipher, and are decrypted by trying each configured key
// (the MAC check makes a wrong key fail cleanly, never decrypt to garbage).
using System.Security.Cryptography;
using System.Text;

namespace TeleSpy.Core;

/// <summary>One authenticated encryption algorithm. Implementations derive
/// whatever subkeys they need from the key secret themselves, so two
/// algorithms never share key material.</summary>
public interface IFieldCipher
{
    /// <summary>Stable id written into every ciphertext. Never reuse or
    /// rename one: stored values depend on it.</summary>
    string AlgorithmId { get; }

    byte[] Encrypt(string keySecret, byte[] plaintext);

    /// <summary>Throws CryptographicException when the payload was not
    /// produced with this key (or was tampered with).</summary>
    byte[] Decrypt(string keySecret, byte[] payload);
}

/// <summary>AES-256-GCM: authenticated encryption in one primitive. 12-byte
/// random nonce, 16-byte tag. Payload: nonce | ciphertext | tag.</summary>
public sealed class AesGcmCipher : IFieldCipher
{
    private const int NonceSize = 12;
    private const int TagSize = 16;

    public string AlgorithmId => "aesgcm";

    private static byte[] Key(string secret) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(secret), 32,
            info: Encoding.UTF8.GetBytes("telespy:field-encryption:aesgcm"));

    public byte[] Encrypt(string keySecret, byte[] plaintext)
    {
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var cipher = new byte[plaintext.Length];
        var tag = new byte[TagSize];
        using var aes = new AesGcm(Key(keySecret), TagSize);
        aes.Encrypt(nonce, plaintext, cipher, tag);
        return [.. nonce, .. cipher, .. tag];
    }

    public byte[] Decrypt(string keySecret, byte[] payload)
    {
        if (payload.Length < NonceSize + TagSize) throw new CryptographicException("Payload too short.");
        var nonce = payload[..NonceSize];
        var tag = payload[^TagSize..];
        var cipher = payload[NonceSize..^TagSize];
        var plain = new byte[cipher.Length];
        using var aes = new AesGcm(Key(keySecret), TagSize);
        aes.Decrypt(nonce, cipher, tag, plain);
        return plain;
    }
}

/// <summary>The original scheme: AES-256-CBC + HMAC-SHA256, encrypt-then-MAC.
/// Payload: IV(16) | ciphertext | MAC(32). Kept so existing values stay
/// readable; still secure, just two primitives where GCM needs one.</summary>
public sealed class AesCbcHmacSha256Cipher : IFieldCipher
{
    public string AlgorithmId => "aescbc-hs256";

    // The original key derivation, unchanged, so pre-existing values decrypt.
    private static byte[] Derive(string secret, string purpose) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(secret), 32,
            info: Encoding.UTF8.GetBytes(purpose));

    public byte[] Encrypt(string keySecret, byte[] plaintext)
    {
        using var aes = Aes.Create();
        aes.Key = Derive(keySecret, "telespy:field-encryption:aes");
        aes.GenerateIV();
        using var encryptor = aes.CreateEncryptor();
        var cipher = encryptor.TransformFinalBlock(plaintext, 0, plaintext.Length);
        byte[] ivAndCipher = [.. aes.IV, .. cipher];
        var mac = HMACSHA256.HashData(Derive(keySecret, "telespy:field-encryption:hmac"), ivAndCipher);
        return [.. ivAndCipher, .. mac];
    }

    public byte[] Decrypt(string keySecret, byte[] payload)
    {
        if (payload.Length < 16 + 32) throw new CryptographicException("Payload too short.");
        var ivAndCipher = payload[..^32];
        var expected = HMACSHA256.HashData(Derive(keySecret, "telespy:field-encryption:hmac"), ivAndCipher);
        if (!CryptographicOperations.FixedTimeEquals(payload[^32..], expected))
        {
            throw new CryptographicException("MAC mismatch.");
        }
        using var aes = Aes.Create();
        aes.Key = Derive(keySecret, "telespy:field-encryption:aes");
        aes.IV = ivAndCipher[..16];
        using var decryptor = aes.CreateDecryptor();
        return decryptor.TransformFinalBlock(ivAndCipher, 16, ivAndCipher.Length - 16);
    }
}

public static class FieldEncryption
{
    private const string Prefix = "enc";

    /// <summary>Every algorithm that can decrypt; add new ones here.</summary>
    private static readonly IReadOnlyDictionary<string, IFieldCipher> Ciphers =
        new IFieldCipher[] { new AesGcmCipher(), new AesCbcHmacSha256Cipher() }
            .ToDictionary(c => c.AlgorithmId);

    private static readonly IFieldCipher LegacyCipher = Ciphers["aescbc-hs256"];

    /// <summary>The algorithm new values are written with.</summary>
    public static IFieldCipher CurrentCipher =>
        Ciphers.TryGetValue(Config.FieldEncryptionAlgorithm, out var cipher)
            ? cipher
            : throw new InvalidOperationException(
                $"FIELD_ENCRYPTION_ALGORITHM '{Config.FieldEncryptionAlgorithm}' is not one of: {string.Join(", ", Ciphers.Keys)}.");

    /// <summary>Key id → secret: the current key first, then retired ones
    /// that may still be needed to read older values.</summary>
    private static IReadOnlyList<(string Id, string Secret)> Keys() =>
        [(Config.FieldEncryptionKeyId, Config.FieldEncryptionKey), .. Config.FieldEncryptionOldKeys];

    public static string Encrypt(string plaintext)
    {
        var cipher = CurrentCipher;
        var payload = cipher.Encrypt(Config.FieldEncryptionKey, Encoding.UTF8.GetBytes(plaintext));
        return $"{Prefix}:{cipher.AlgorithmId}:{Config.FieldEncryptionKeyId}:{Convert.ToBase64String(payload)}";
    }

    public static string Decrypt(string stored)
    {
        try
        {
            if (!stored.StartsWith(Prefix + ":", StringComparison.Ordinal)) return DecryptLegacy(stored);

            var parts = stored.Split(':', 4);
            if (parts.Length != 4 || !Ciphers.TryGetValue(parts[1], out var cipher))
            {
                throw new DecryptionError("Unknown encryption algorithm on a stored value.");
            }
            var key = Keys().FirstOrDefault(k => k.Id == parts[2]);
            if (key.Secret is null)
            {
                throw new DecryptionError(
                    $"A stored value was encrypted with key '{parts[2]}', which isn't configured. Add it to FIELD_ENCRYPTION_OLD_KEYS.");
            }
            return Encoding.UTF8.GetString(cipher.Decrypt(key.Secret, Convert.FromBase64String(parts[3])));
        }
        catch (DecryptionError) { throw; }
        catch (Exception exc) { throw new DecryptionError("Could not decrypt stored value.", exc); }
    }

    /// <summary>True when the value is already in the current algorithm and
    /// key — the re-encrypt job skips those.</summary>
    public static bool IsCurrent(string stored) =>
        stored.StartsWith($"{Prefix}:{CurrentCipher.AlgorithmId}:{Config.FieldEncryptionKeyId}:", StringComparison.Ordinal);

    private static string DecryptLegacy(string stored)
    {
        var payload = Convert.FromBase64String(stored);
        foreach (var (_, secret) in Keys())
        {
            try { return Encoding.UTF8.GetString(LegacyCipher.Decrypt(secret, payload)); }
            catch (CryptographicException) { /* not this key — try the next */ }
        }
        throw new DecryptionError("Could not decrypt stored value with any configured key.");
    }
}
