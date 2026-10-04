// Small helpers every controller reaches for: resolving the caller to a
// full User row, their department scope, and the current month key —
// mirrors Backend/api/common.py.
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Api;

public interface IViewerContext
{
    /// <summary>The full User row for the caller, or null if unauthenticated.
    /// Includes Employee + Role — the navigations most controllers need
    /// immediately — since EF Core does not lazy-load them.</summary>
    Task<User?> LoadedUserAsync();

    string? ViewerDepartmentId(User viewer);

    string CurrentMonth();
}

public class ViewerContext(TeleSpyDbContext db, ICurrentUserAccessor currentUser) : IViewerContext
{
    public async Task<User?> LoadedUserAsync()
    {
        var id = currentUser.Current.Id;
        if (string.IsNullOrEmpty(id)) return null;
        return await db.Users.Include(u => u.Employee).Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.UserId == id);
    }

    public string? ViewerDepartmentId(User viewer) => viewer.Employee?.DepartmentId;

    public string CurrentMonth() => Clock.UtcNow().ToString("yyyy-MM");
}
