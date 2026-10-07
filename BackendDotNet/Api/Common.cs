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

/// <summary>An employee's full name is unique across the company — it's how
/// a SIM's holder is identified on screen, so two people on two different
/// extensions can't share one. Compared ignoring case and surrounding
/// spaces. Enforced wherever a name is set: creating or editing an
/// employee, self-registration, and a user renaming themselves.</summary>
public static class EmployeeNames
{
    public static Task<bool> IsTakenAsync(TeleSpyDbContext db, string fullName, string? exceptEmployeeId = null)
    {
        var wanted = fullName.Trim().ToLower();
        return db.Employees.AnyAsync(e => e.FullName.ToLower() == wanted && e.EmployeeId != exceptEmployeeId);
    }

    /// <summary>The 409 body returned when the name is already in use.</summary>
    public static object DuplicateError(HttpRequest request) => new
    {
        error_type = "duplicate_full_name",
        message = "Another employee already has that name.",
        field = "full_name",
        hint = "Names must be unique. Add a middle name or initial to tell the two people apart.",
        status = 409,
        path = request.Path.Value,
        method = request.Method,
        timestamp = DateTime.UtcNow.ToString("o"),
    };
}
