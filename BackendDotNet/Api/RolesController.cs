// Roles + budget ceilings: list/patch roles, and the "who is over their
// monthly cost ceiling" report. Mirrors Backend/api/roles.py 1:1.
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

[ApiController]
public class RolesController(TeleSpyDbContext db, IViewerContext viewerContext) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

    [HttpGet("/roles")]
    public async Task<IActionResult> Get()
    {
        var roles = await db.Roles.ToListAsync();
        return Ok(new { data = roles.Select(r => r.ToDict()).ToList() });
    }

    [HttpPatch("/roles/{roleId}")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Patch(string roleId)
    {
        var role = await db.Roles.FindAsync(roleId);
        if (role is null)
        {
            return StatusCode(404, new
            {
                error_type = "role_not_found",
                message = "Role not found.",
                field = "role_id",
                hint = $"No role exists with id '{roleId}'. Check /roles for valid ids.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        var data = await RequestBody.ReadJsonSilentAsync<Dictionary<string, JsonElement>>(Request);

        if (data.TryGetValue("call_limit_kshs", out var limitEl))
        {
            if (limitEl.ValueKind != JsonValueKind.Null &&
                (limitEl.ValueKind != JsonValueKind.Number || limitEl.GetDouble() <= 0))
            {
                return StatusCode(422, new
                {
                    error_type = "validation_error",
                    message = "call_limit_kshs must be a positive number or null.",
                    field = "call_limit_kshs",
                    hint = "Pass a positive number for the monthly limit, or null to remove the limit.",
                    status = 422,
                    path = Request.Path.Value,
                    method = Request.Method,
                    timestamp = NowIso(),
                });
            }
            role.CallLimitKshs = limitEl.ValueKind == JsonValueKind.Null ? null : limitEl.GetDouble();
        }
        if (data.TryGetValue("permissions", out var permsEl) && permsEl.ValueKind == JsonValueKind.Array)
        {
            role.Permissions = permsEl.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String)
                .Select(e => e.GetString()!).ToList();
        }
        await db.SaveChangesAsync();
        return Ok(new { data = role.ToDict(), message = "Role updated." });
    }

    private async Task<List<object>> EmployeesOverBudgetAsync(string month, string? departmentId = null)
    {
        var summaries = await db.UsageSummaries.Where(s => s.Month == month)
            .Include(s => s.Employee).ThenInclude(e => e!.User).ThenInclude(u => u!.Role)
            .Include(s => s.Employee).ThenInclude(e => e!.Allocations).ThenInclude(a => a.Sim)
            .ToListAsync();

        var over = new List<object>();
        foreach (var summary in summaries)
        {
            var employee = summary.Employee!;
            if (departmentId is not null && employee.DepartmentId != departmentId) continue;
            if (employee.User?.Role is null) continue;
            var limit = employee.User.Role.CallLimitKshs;
            if (summary.CheckThresholdBreach(limit))
            {
                var allocation = employee.GetActiveAllocation();
                over.Add(new
                {
                    employee_id = employee.EmployeeId,
                    staff_number = employee.StaffNumber,
                    full_name = employee.FullName,
                    department_id = employee.DepartmentId,
                    role = employee.User.Role.RoleName,
                    extension = allocation?.Sim?.MsisdnPbxEnc is { Length: > 0 } ? Security.DecryptValue(allocation.Sim.MsisdnPbxEnc) : null,
                    limit_kshs = limit,
                    total_cost = summary.TotalCost,
                    overage_kshs = Math.Round(summary.TotalCost - limit!.Value, 2),
                });
            }
        }
        return over;
    }

    [HttpGet("/budgets/over-limit")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> BudgetsOverLimit()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var month = Request.Query["month"].ToString();
        if (string.IsNullOrEmpty(month)) month = viewerContext.CurrentMonth();
        var scopeDept = viewer!.Role!.RoleName == TeleSpy.Role.Manager ? viewerContext.ViewerDepartmentId(viewer) : null;
        return Ok(new { data = await EmployeesOverBudgetAsync(month, scopeDept) });
    }
}
