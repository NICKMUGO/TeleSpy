// Shared boot-time helpers used by both Program.cs (normal web host startup)
// and Seed.cs (the `dotnet run -- --seed` path, which needs a DbContext and
// the same role bootstrap without spinning up Kestrel) — mirrors
// Backend/app.py's ConfigureDatabase-equivalent SQLALCHEMY_DATABASE_URI
// handling and its ensure_default_roles().
using Microsoft.EntityFrameworkCore;
using TeleSpy.Models;

namespace TeleSpy.Core;

public static class DatabaseConfig
{
    public static void Configure(DbContextOptionsBuilder options, string databaseUrl)
    {
        if (databaseUrl.StartsWith("sqlite:///", StringComparison.Ordinal))
        {
            var path = databaseUrl["sqlite:///".Length..];
            options.UseSqlite($"Data Source={path}");
        }
        else if (databaseUrl.StartsWith("postgres://", StringComparison.Ordinal) ||
                 databaseUrl.StartsWith("postgresql://", StringComparison.Ordinal))
        {
            var uri = new Uri(databaseUrl.Replace("postgres://", "postgresql://"));
            var userInfo = uri.UserInfo.Split(':', 2);
            var connectionString =
                $"Host={uri.Host};Port={(uri.Port > 0 ? uri.Port : 5432)};" +
                $"Database={uri.AbsolutePath.TrimStart('/')};" +
                $"Username={Uri.UnescapeDataString(userInfo[0])};" +
                $"Password={(userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : "")};";
            options.UseNpgsql(connectionString);
        }
        else
        {
            throw new InvalidOperationException($"Unsupported DATABASE_URL scheme: {databaseUrl}");
        }
    }

    public static TeleSpyDbContext CreateStandaloneContext()
    {
        var optionsBuilder = new DbContextOptionsBuilder<TeleSpyDbContext>();
        Configure(optionsBuilder, Config.DatabaseUrl);
        return new TeleSpyDbContext(optionsBuilder.Options);
    }
}

public static class RoleBootstrap
{
    /// <summary>The `roles` table needs Admin/Manager/Employee to exist for
    /// users.role_id to be a satisfiable foreign key at all. This is
    /// structural reference data (like a fixed status enum), not
    /// business/demo seed data — no Department, Employee, User, or SimCard
    /// row is ever created here. Idempotent: upserts by the fixed slug, safe
    /// to run on every boot.</summary>
    public static async Task EnsureDefaultRolesAsync(TeleSpyDbContext db, ILogger logger)
    {
        try
        {
            foreach (var (roleName, slug) in Constants.RoleSlugs)
            {
                var role = await db.Roles.FindAsync(slug);
                if (role is null)
                {
                    db.Roles.Add(new TeleSpy.Models.Role
                    {
                        RoleId = slug,
                        RoleName = roleName,
                        Permissions = [],
                        CallLimitKshs = Constants.DefaultCallLimitKes[roleName],
                    });
                }
            }
            await db.SaveChangesAsync();
        }
        catch (Exception exc)
        {
            // The `roles` table doesn't exist yet — e.g. a fresh checkout
            // that hasn't migrated yet. Move on; this runs again (and
            // succeeds) the next time the app boots after migrating.
            logger.LogWarning(exc, "Skipped default-role bootstrap: `roles` table not present yet. Run `dotnet ef database update`.");
        }
    }
}

public static class CallRateBootstrap
{
    /// <summary>billing_settings/international_call_rates need *some* rows
    /// for ML/training/billing.py to have anything to read at all —
    /// Safaricom's published local tariff and the PDF-sourced international
    /// rate table are structural configuration (like roles.call_limit_kshs),
    /// not business/demo seed data. Idempotent and non-destructive: the
    /// singleton BillingSettings row is only created if missing (never
    /// overwritten, so an Admin's PATCH /call-rates/local edit sticks across
    /// restarts), and InternationalCallRate rows are only inserted for
    /// country codes that don't already exist (an Admin's
    /// PATCH /call-rates/international edit is never clobbered by this
    /// running again on the next boot).</summary>
    public static async Task EnsureDefaultCallRatesAsync(TeleSpyDbContext db, ILogger logger)
    {
        try
        {
            if (await db.BillingSettings.FindAsync(BillingConstants.BillingSettingsId) is null)
            {
                db.BillingSettings.Add(new TeleSpy.Models.BillingSettings
                {
                    Id = BillingConstants.BillingSettingsId,
                    PeakRateKes = BillingConstants.DefaultPeakRateKes,
                    OffPeakRateKes = BillingConstants.DefaultOffPeakRateKes,
                    PeakStartHour = BillingConstants.DefaultPeakStartHour,
                    PeakEndHour = BillingConstants.DefaultPeakEndHour,
                    DefaultInternationalRateKes = BillingConstants.DefaultInternationalRateKes,
                });
            }

            var existingCodes = await db.InternationalCallRates.Select(r => r.CountryCode).ToListAsync();
            var existingCodeSet = existingCodes.ToHashSet();
            foreach (var (countryCode, countryName, rateKesPerMinute) in BillingConstants.InternationalCallRateSeed)
            {
                if (existingCodeSet.Contains(countryCode)) continue;
                db.InternationalCallRates.Add(new InternationalCallRate
                {
                    CountryCode = countryCode,
                    CountryName = countryName,
                    RateKesPerMinute = rateKesPerMinute,
                });
            }
            await db.SaveChangesAsync();
        }
        catch (Exception exc)
        {
            // The tables don't exist yet — e.g. a fresh checkout that
            // hasn't migrated yet. Move on; this runs again (and succeeds)
            // the next time the app boots after migrating.
            logger.LogWarning(exc, "Skipped default-call-rate bootstrap: `billing_settings`/`international_call_rates` tables not present yet. Run `dotnet ef database update`.");
        }
    }
}
