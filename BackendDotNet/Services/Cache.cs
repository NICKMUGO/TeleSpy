// Redis-backed store for the JWT blocklist and MFA OTPs — mirrors
// Backend/services/cache.py exactly (same key prefixes, same TTL semantics).
using System.Text.Json;
using StackExchange.Redis;
using TeleSpy.Core;

namespace TeleSpy.Services;

/// <summary>The one active session a user currently has, for both matching
/// (Sid) and describing it back to them if a second login collides with it
/// (Device/SignedInAtUtc) — see AuthController.VerifyOtp.</summary>
public record ActiveSessionInfo(string Sid, string? Device, DateTime SignedInAtUtc);

public interface ICacheService
{
    Task RevokeTokenAsync(string jti, long ttlSeconds);
    Task<bool> IsTokenRevokedAsync(string jti);
    Task SetOtpAsync(string userId, string otpHash, int ttlSeconds);
    Task<string?> GetOtpHashAsync(string userId);
    Task ConsumeOtpAsync(string userId);
    Task SetActiveSessionAsync(string userId, string sessionId, string? device, long ttlSeconds);
    Task<ActiveSessionInfo?> GetActiveSessionAsync(string userId);
    Task ClearActiveSessionAsync(string userId);
}

public class CacheService : ICacheService
{
    private const string JtiPrefix = "telespy:revoked_jti:";
    private const string OtpPrefix = "telespy:mfa_otp:";
    private const string ActiveSessionPrefix = "telespy:active_session:";

    private readonly Lazy<ConnectionMultiplexer> _connection = new(() => ConnectionMultiplexer.Connect(ParseRedisUrl(Config.RedisUrl)));

    /// <summary>StackExchange.Redis's ConnectionMultiplexer does not parse
    /// `redis://` URIs the way Python's redis-py does — it wants a plain
    /// ConfigurationOptions (host:port, optional password, optional
    /// DB index). Parse REDIS_URL (e.g. "redis://:password@host:6379/0")
    /// into that shape here so both backends can share the same env var
    /// format.</summary>
    private static ConfigurationOptions ParseRedisUrl(string redisUrl)
    {
        var uri = new Uri(redisUrl);
        var options = new ConfigurationOptions
        {
            EndPoints = { { uri.Host, uri.Port > 0 ? uri.Port : 6379 } },
        };
        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            var parts = uri.UserInfo.Split(':', 2);
            var password = parts.Length > 1 ? parts[1] : parts[0];
            if (!string.IsNullOrEmpty(password)) options.Password = Uri.UnescapeDataString(password);
        }
        var dbSegment = uri.AbsolutePath.Trim('/');
        if (dbSegment.Length > 0 && int.TryParse(dbSegment, out var db))
        {
            options.DefaultDatabase = db;
        }
        return options;
    }

    private IDatabase Db() => _connection.Value.GetDatabase();

    /// <summary>Blocklist a JWT's jti for (at most) the remaining lifetime of
    /// the token itself — once it would have expired anyway, it's not worth
    /// remembering.</summary>
    public Task RevokeTokenAsync(string jti, long ttlSeconds) =>
        ttlSeconds > 0 ? Db().StringSetAsync($"{JtiPrefix}{jti}", "1", TimeSpan.FromSeconds(ttlSeconds)) : Task.CompletedTask;

    public async Task<bool> IsTokenRevokedAsync(string jti) => await Db().KeyExistsAsync($"{JtiPrefix}{jti}");

    /// <summary>Overwrites any previous OTP for this user — only the latest
    /// one (per the resend/login flow) is ever valid.</summary>
    public Task SetOtpAsync(string userId, string otpHash, int ttlSeconds) =>
        Db().StringSetAsync($"{OtpPrefix}{userId}", otpHash, TimeSpan.FromSeconds(ttlSeconds));

    public async Task<string?> GetOtpHashAsync(string userId) => await Db().StringGetAsync($"{OtpPrefix}{userId}");

    public Task ConsumeOtpAsync(string userId) => Db().KeyDeleteAsync($"{OtpPrefix}{userId}");

    /// <summary>One active session per user, enforced here: overwriting this
    /// key is what "signs out" every device/tab that was on the previous
    /// session — the same idea as WhatsApp Web allowing only one live login
    /// at a time. TTL matches the refresh token's lifetime, since that's the
    /// longest-lived credential built on top of this session id.</summary>
    public Task SetActiveSessionAsync(string userId, string sessionId, string? device, long ttlSeconds) =>
        Db().StringSetAsync($"{ActiveSessionPrefix}{userId}",
            JsonSerializer.Serialize(new ActiveSessionInfo(sessionId, device, DateTime.UtcNow)),
            TimeSpan.FromSeconds(ttlSeconds));

    public async Task<ActiveSessionInfo?> GetActiveSessionAsync(string userId)
    {
        string? raw = await Db().StringGetAsync($"{ActiveSessionPrefix}{userId}");
        if (raw is null) return null;
        try
        {
            return JsonSerializer.Deserialize<ActiveSessionInfo>(raw);
        }
        catch (JsonException)
        {
            return null; // a value written before this field existed — treat as no active session
        }
    }

    public Task ClearActiveSessionAsync(string userId) => Db().KeyDeleteAsync($"{ActiveSessionPrefix}{userId}");
}
