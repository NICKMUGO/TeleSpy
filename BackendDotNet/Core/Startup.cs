// Shared boot-time helpers used by both Program.cs (normal web host startup)
// and Seed.cs (the `dotnet run -- --seed` path, which needs a DbContext and
// the same role bootstrap without spinning up Kestrel) — mirrors
// Backend/app.py's ConfigureDatabase-equivalent SQLALCHEMY_DATABASE_URI
// handling and its ensure_default_roles().
using Microsoft.EntityFrameworkCore;
using TeleSpy.Models;
using TeleSpy.Services;

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

public static class AdminBootstrap
{
    /// <summary>Solves "who creates the first Admin" without a hardcoded
    /// account. While no active Admin exists, creates one for
    /// BOOTSTRAP_ADMIN_EMAIL with a random, never-revealed password and
    /// emails them a set-password link — the same way an Admin-created
    /// account starts (EmployeesController.Post). Once any active Admin
    /// exists this does nothing, so it is safe on every boot and never
    /// touches an existing database's accounts. Lost the link? "Forgot
    /// password?" on the sign-in page issues a new one.</summary>
    public static async Task EnsureBootstrapAdminAsync(TeleSpyDbContext db, IPasswordResetService passwordReset, ILogger logger)
    {
        try
        {
            var adminRoleId = Constants.RoleSlugs[Role.Admin];
            if (await db.Users.AnyAsync(u => u.RoleId == adminRoleId && u.IsActive)) return;

            if (string.IsNullOrWhiteSpace(Config.BootstrapAdminEmail))
            {
                logger.LogWarning("No active Admin exists and BOOTSTRAP_ADMIN_EMAIL is not set — nobody can sign in to create accounts. " +
                    "Set BOOTSTRAP_ADMIN_EMAIL in .env and restart.");
                return;
            }

            string email;
            try
            {
                email = Validators.RequireValidEmail(Config.BootstrapAdminEmail);
            }
            catch (ValidationFailed)
            {
                logger.LogWarning("BOOTSTRAP_ADMIN_EMAIL is not a valid email address — no Admin was created.");
                return;
            }
            // Never take over or promote an existing account; that's an
            // Admin decision, and there isn't one yet.
            if (await db.Users.AnyAsync(u => u.Email == email))
            {
                logger.LogWarning("BOOTSTRAP_ADMIN_EMAIL {Email} already belongs to a non-Admin account — no Admin was created. " +
                    "Use an address with no account yet.", email);
                return;
            }

            var fullName = Config.BootstrapAdminName.Trim();
            if (fullName.Length == 0 || await TeleSpy.Api.EmployeeNames.IsTakenAsync(db, fullName)) fullName = $"Administrator ({email})";
            var staffNumber = "ADM-0001";
            for (var n = 2; await db.Employees.AnyAsync(e => e.StaffNumber == staffNumber); n++) staffNumber = $"ADM-{n:D4}";

            var employee = new Employee { FullName = fullName, StaffNumber = staffNumber };
            db.Employees.Add(employee);
            await db.SaveChangesAsync();
            var user = new User
            {
                EmployeeId = employee.EmployeeId, Email = email, RoleId = adminRoleId,
                IsActive = true, MustChangePassword = true,
            };
            user.SetPassword(Security.GenerateResetToken());
            db.Users.Add(user);
            await db.SaveChangesAsync();
            db.PasswordHistories.Add(new PasswordHistory { UserId = user.UserId, PasswordHashValue = user.PasswordHash, CreatedAt = Clock.UtcNow() });
            await db.SaveChangesAsync();

            await passwordReset.IssuePasswordResetAsync(user, newAccount: true);
            logger.LogInformation("Created the first Admin, {Email}; a set-password link has been emailed to them.", email);
        }
        catch (Exception exc)
        {
            // Same as the bootstraps above: tables not migrated yet.
            logger.LogWarning(exc, "Skipped Admin bootstrap: run `dotnet ef database update` first.");
        }
    }
}

public static class TicketCategoryBootstrap
{
    // Starter categories for the customer service desk, each routed to a
    // department by cost-centre code (stable across department renames).
    private static readonly (string Name, string CostCentreCode)[] Defaults =
    [
        ("Flight rebooking", "OPS"),
        ("Flight delay or cancellation", "OPS"),
        ("Baggage", "OPS"),
        ("Refund or payment", "FIN"),
        ("Complaint about staff", "HR"),
    ];

    /// <summary>Adds the starter categories once, only while there are none
    /// at all — after that they're the Admin's to rename, re-route or turn
    /// off in Settings, and this never touches them again. A default whose
    /// department doesn't exist is skipped.</summary>
    public static async Task EnsureDefaultCategoriesAsync(TeleSpyDbContext db, ILogger logger)
    {
        try
        {
            if (await db.TicketCategories.AnyAsync()) return;
            var departments = await db.Departments.Where(d => d.CostCentreCode != null)
                .ToDictionaryAsync(d => d.CostCentreCode!, d => d.DepartmentId);
            if (departments.Count == 0) return; // nothing to route to yet (unseeded database)
            foreach (var (name, code) in Defaults)
            {
                if (departments.TryGetValue(code, out var departmentId))
                {
                    db.TicketCategories.Add(new TicketCategory { Name = name, DepartmentId = departmentId });
                }
            }
            await db.SaveChangesAsync();
        }
        catch (Exception exc)
        {
            logger.LogWarning(exc, "Could not add the default ticket categories.");
        }
    }
}
