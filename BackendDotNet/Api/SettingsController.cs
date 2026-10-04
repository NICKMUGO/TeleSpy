// Per-user self-service: profile (GET/PATCH /settings/me) and the
// employee's own usage view (GET /me/usage). Mirrors Backend/api/settings.py 1:1.
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Api;

public class UpdateProfileRequest
{
    public string? FullName { get; set; }
}

[ApiController]
public class SettingsController(TeleSpyDbContext db, IViewerContext viewerContext) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

    private async Task<User?> LoadFullUserAsync(string userId) =>
        await db.Users.Include(u => u.Role)
            .Include(u => u.Employee!).ThenInclude(e => e.User).ThenInclude(u => u!.Role)
            .Include(u => u.Employee!).ThenInclude(e => e.Allocations).ThenInclude(a => a.Sim)
            .Include(u => u.Employee!).ThenInclude(e => e.UsageSummaries)
            .FirstOrDefaultAsync(u => u.UserId == userId);

    [HttpGet("/settings/me")]
    public async Task<IActionResult> Get()
    {
        var current = await viewerContext.LoadedUserAsync();
        if (current is null)
        {
            return StatusCode(404, new
            {
                error_type = "not_found",
                message = "Not found.",
                hint = "The account for the current session no longer exists.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        var user = await LoadFullUserAsync(current.UserId) ?? current;
        var outDict = user.ToDict();
        if (user.Employee is not null)
        {
            foreach (var kv in user.Employee.ToDict(user)) outDict[kv.Key] = kv.Value;
        }
        return Ok(new { data = outDict });
    }

    [HttpPatch("/settings/me")]
    public async Task<IActionResult> Patch()
    {
        var current = await viewerContext.LoadedUserAsync();
        var data = await RequestBody.ReadJsonSilentAsync<UpdateProfileRequest>(Request);
        var user = await LoadFullUserAsync(current!.UserId) ?? current;
        if (!string.IsNullOrEmpty(data.FullName) && user.Employee is not null)
        {
            user.Employee.FullName = data.FullName.Trim();
        }
        await db.SaveChangesAsync();
        var outDict = user.ToDict();
        if (user.Employee is not null)
        {
            foreach (var kv in user.Employee.ToDict(user)) outDict[kv.Key] = kv.Value;
        }
        return Ok(new { data = outDict, message = "Profile updated." });
    }
}

/// <summary>Employee self-service view — Design_Docs sequence diagram's GET
/// /me/usage: own CDR events + allocation, cost totals, usage profile
/// cluster. Any authenticated user with an Employee record can call this for
/// their own data (Admin/Manager included).</summary>
[ApiController]
public class MyUsageController(TeleSpyDbContext db, IViewerContext viewerContext) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

    [HttpGet("/me/usage")]
    public async Task<IActionResult> Get()
    {
        var current = await viewerContext.LoadedUserAsync();
        var viewer = current is not null
            ? await db.Users.Include(u => u.Role)
                .Include(u => u.Employee!).ThenInclude(e => e.Allocations).ThenInclude(a => a.Sim)
                .Include(u => u.Employee!).ThenInclude(e => e.UsageSummaries)
                .FirstOrDefaultAsync(u => u.UserId == current.UserId)
            : null;
        if (viewer?.Employee is null)
        {
            return StatusCode(404, new
            {
                error_type = "not_found",
                message = "No employee record for this account.",
                hint = "This account isn't linked to an Employee record, so it has no usage history.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        var employee = viewer.Employee;
        var (page, limit) = Pagination.PaginateArgs(Request);

        var allocationIds = employee.Allocations.Select(a => a.AllocationId).ToList();
        var query = db.UsageEvents.Where(e => e.AllocationId != null && allocationIds.Contains(e.AllocationId));
        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(e => e.OccuredAt).Skip((page - 1) * limit).Take(limit).ToListAsync();

        var currentAllocation = employee.GetActiveAllocation();
        var profile = await db.UsageProfiles.FirstOrDefaultAsync(p => p.EmployeeId == employee.EmployeeId);

        return Ok(new
        {
            data = new
            {
                usage = rows.Select(r => r.ToDict()).ToList(),
                cost_summaries = employee.UsageSummaries.Select(s => s.ToDict()).ToList(),
                limit_kshs = viewer.Role?.CallLimitKshs,
                current_allocation = currentAllocation?.ToDict(),
                current_sim = currentAllocation?.Sim?.ToDict(viewer),
                usage_profile_cluster = profile?.ClusterLabel,
            },
            meta = Pagination.PaginateMeta(page, limit, total),
        });
    }
}
