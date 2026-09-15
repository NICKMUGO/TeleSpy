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
