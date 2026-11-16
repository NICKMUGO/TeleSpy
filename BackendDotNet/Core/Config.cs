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
    // A sign-in lasts while it's in use: every refresh (about every 15
    // minutes of activity) pushes the end out to this many days from now,
    // so someone is only asked for their password + OTP again after this
    // long without opening the app...
    public static TimeSpan JwtRefreshTokenExpires { get; } = TimeSpan.FromDays(ToInt("JWT_REFRESH_TOKEN_EXPIRES_DAYS", "30"));
    // ...or once this long has passed since they signed in, however active —
    // so a stolen or forgotten device can't stay signed in forever.
    public static TimeSpan SessionMaxLifetime { get; } = TimeSpan.FromDays(ToInt("SESSION_MAX_DAYS", "90"));
    public static int JwtMfaTokenExpiresMinutes { get; } = ToInt("JWT_MFA_TOKEN_EXPIRES_MINUTES", "5");

    // --- Push notifications (Web Push) ----------------------------------------
    // Generate once with `dotnet run -- --vapid-keys`. Left empty, push is
    // simply off: nothing is offered to browsers and nothing is sent.
    public static string VapidPublicKey { get; } = Environment.GetEnvironmentVariable("VAPID_PUBLIC_KEY") ?? "";
    public static string VapidPrivateKey { get; } = Environment.GetEnvironmentVariable("VAPID_PRIVATE_KEY") ?? "";
    /// <summary>Who push services contact about misbehaving pushes.</summary>
    public static string VapidSubject { get; } =
        Environment.GetEnvironmentVariable("VAPID_SUBJECT") is { Length: > 0 } subject ? subject : "mailto:admin@localhost";
    public static bool PushEnabled => VapidPublicKey.Length > 0 && VapidPrivateKey.Length > 0;

    // --- Field-level encryption --------------------------------------------
    public static string FieldEncryptionKey { get; } = Environment.GetEnvironmentVariable("FIELD_ENCRYPTION_KEY") ?? "";
    public static string BlindIndexKey { get; } = Environment.GetEnvironmentVariable("BLIND_INDEX_KEY") ?? "";

    // Crypto agility for FieldEncryption (Core/FieldEncryption.cs): which
    // algorithm new values use, the id stamped on values made with
    // FIELD_ENCRYPTION_KEY, and retired keys kept only to read older values
    // ("k0=secret;k-old=secret") until `--reencrypt` has moved everything on.
    public static string FieldEncryptionAlgorithm { get; } =
        Environment.GetEnvironmentVariable("FIELD_ENCRYPTION_ALGORITHM") is { Length: > 0 } alg ? alg : "aesgcm";
    public static string FieldEncryptionKeyId { get; } =
        Environment.GetEnvironmentVariable("FIELD_ENCRYPTION_KEY_ID") is { Length: > 0 } id ? id : "k1";
    public static IReadOnlyList<(string Id, string Secret)> FieldEncryptionOldKeys { get; } =
        (Environment.GetEnvironmentVariable("FIELD_ENCRYPTION_OLD_KEYS") ?? "")
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(pair => pair.Split('=', 2))
            .Where(pair => pair.Length == 2 && pair[0].Length > 0 && pair[1].Length > 0)
            .Select(pair => (pair[0], pair[1]))
            .ToList();

    // --- CORS ----------------------------------------------------------------
    public static List<string> FrontendOrigins { get; } = ToList("FRONTEND_ORIGINS", "http://localhost:3000");

    /// <summary>Where the API is reachable from outside, for links in emails
    /// that open a page the API serves itself (the customer rating page).
    /// Production serves the API under the site's /api (deploy/Caddyfile);
    /// local dev runs it on its own port.</summary>
    public static string PublicApiUrl { get; } = (Environment.GetEnvironmentVariable("PUBLIC_API_URL") is { Length: > 0 } url
        ? url
        : FrontendOrigins.FirstOrDefault() is { } origin && !origin.Contains("localhost")
            ? $"{origin.TrimEnd('/')}/api"
            : "http://localhost:5299").TrimEnd('/');

    /// <summary>Where ticket attachments are kept on disk (a Docker volume in
    /// production, deploy/docker-compose.yml).</summary>
    public static string AttachmentsDir { get; } =
        Path.GetFullPath(Environment.GetEnvironmentVariable("ATTACHMENTS_DIR") is { Length: > 0 } dir
            ? dir
            : Path.Combine(AppContext.BaseDirectory, "attachments"));

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

    // --- First Admin (see AdminBootstrap) ---------------------------------------
    // Only read while no active Admin exists; ignored from then on.
    public static string? BootstrapAdminEmail { get; } = Environment.GetEnvironmentVariable("BOOTSTRAP_ADMIN_EMAIL");
    public static string BootstrapAdminName { get; } = Environment.GetEnvironmentVariable("BOOTSTRAP_ADMIN_NAME") ?? "System Administrator";

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
