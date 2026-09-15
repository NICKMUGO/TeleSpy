// Redis-backed store for the JWT blocklist and MFA OTPs — mirrors
// Backend/services/cache.py exactly (same key prefixes, same TTL semantics).
using StackExchange.Redis;
using TeleSpy.Core;

namespace TeleSpy.Services;

public interface ICacheService
{
    Task RevokeTokenAsync(string jti, long ttlSeconds);
    Task<bool> IsTokenRevokedAsync(string jti);
    Task SetOtpAsync(string userId, string otpHash, int ttlSeconds);
    Task<string?> GetOtpHashAsync(string userId);
    Task ConsumeOtpAsync(string userId);
}

public class CacheService : ICacheService
{
    private const string JtiPrefix = "telespy:revoked_jti:";
    private const string OtpPrefix = "telespy:mfa_otp:";

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
}
