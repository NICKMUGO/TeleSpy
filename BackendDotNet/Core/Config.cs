// Central runtime configuration, read from environment variables — mirrors
// Backend/core/config.py field-for-field (same env var names and defaults).
namespace TeleSpy.Core;

public static class Config
{
    private static bool ToBool(string name, string defaultValue = "false")
    {
        var raw = (Environment.GetEnvironmentVariable(name) ?? defaultValue).Trim().ToLowerInvariant();
        return raw is "1" or "true" or "yes" or "on";
    }

    private static List<string> ToList(string name, string defaultValue = "")
    {
        var raw = Environment.GetEnvironmentVariable(name) ?? defaultValue;
        return raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
    }

    private static int ToInt(string name, string defaultValue) =>
        int.Parse(Environment.GetEnvironmentVariable(name) ?? defaultValue);

    public static string Env { get; } = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production";
    public static bool Debug { get; } = Env == "Development";
    public static string SecretKey { get; } = Environment.GetEnvironmentVariable("SECRET_KEY") ?? "";

    // --- Database (SQL) -----------------------------------------------------
    public static string DatabaseUrl { get; } = Environment.GetEnvironmentVariable("DATABASE_URL") ?? "postgresql://postgres@localhost:5432/telespy";

    // --- Redis (JWT blocklist + MFA OTP cache) -------------------------------
    public static string RedisUrl { get; } = Environment.GetEnvironmentVariable("REDIS_URL") ?? "redis://localhost:6379/0";

    // --- JWT ---------------------------------------------------------------
    public static string JwtSecretKey { get; } = Environment.GetEnvironmentVariable("JWT_SECRET_KEY") ?? "";
    public static TimeSpan JwtAccessTokenExpires { get; } = TimeSpan.FromMinutes(ToInt("JWT_ACCESS_TOKEN_EXPIRES_MINUTES", "15"));
    public static TimeSpan JwtRefreshTokenExpires { get; } = TimeSpan.FromDays(ToInt("JWT_REFRESH_TOKEN_EXPIRES_DAYS", "7"));
    public static int JwtMfaTokenExpiresMinutes { get; } = ToInt("JWT_MFA_TOKEN_EXPIRES_MINUTES", "5");

    // --- Field-level encryption --------------------------------------------
    public static string FieldEncryptionKey { get; } = Environment.GetEnvironmentVariable("FIELD_ENCRYPTION_KEY") ?? "";
    public static string BlindIndexKey { get; } = Environment.GetEnvironmentVariable("BLIND_INDEX_KEY") ?? "";

    // --- CORS ----------------------------------------------------------------
    public static List<string> FrontendOrigins { get; } = ToList("FRONTEND_ORIGINS", "http://localhost:3000");

    // --- Mail ------------------------------------------------------------------
    public static string MailServer { get; } = Environment.GetEnvironmentVariable("MAIL_SERVER") ?? "localhost";
    public static int MailPort { get; } = ToInt("MAIL_PORT", "587");
    public static bool MailUseTls { get; } = ToBool("MAIL_USE_TLS", "true");
    public static string? MailUsername { get; } = Environment.GetEnvironmentVariable("MAIL_USERNAME");
    public static string? MailPassword { get; } = Environment.GetEnvironmentVariable("MAIL_PASSWORD");
    public static string MailDefaultSender { get; } = Environment.GetEnvironmentVariable("MAIL_DEFAULT_SENDER") ?? "TeleSpy <no-reply@telespy.local>";
    public static bool MailSuppressSend { get; } = ToBool("MAIL_SUPPRESS_SEND", "true");

    // --- Policy -----------------------------------------------------------------
    public static string DpaKePolicyVersion { get; } = Environment.GetEnvironmentVariable("DPA_KE_POLICY_VERSION") ?? "2026-01";
    public static int PasswordResetTokenExpiresMinutes { get; } = ToInt("PASSWORD_RESET_TOKEN_EXPIRES_MINUTES", "30");
    public static int MfaOtpExpiresMinutes { get; } = ToInt("MFA_OTP_EXPIRES_MINUTES", "5");

    /// <summary>Fail fast on missing secrets instead of limping along insecurely.</summary>
    public static void Validate()
    {
        var missing = new List<(string Name, string Value)>
        {
            (nameof(SecretKey), SecretKey),
            (nameof(JwtSecretKey), JwtSecretKey),
            (nameof(FieldEncryptionKey), FieldEncryptionKey),
            (nameof(BlindIndexKey), BlindIndexKey),
        }.Where(kv => string.IsNullOrEmpty(kv.Value)).Select(kv => kv.Name).ToList();

        if (missing.Count > 0)
        {
            throw new InvalidOperationException(
                "Missing required environment variables: " + string.Join(", ", missing) + ". See .env.example.");
        }
    }
}
