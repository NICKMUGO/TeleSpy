// Departments: CRUD (admin) + department spend / budget status (admin or
// the department's own manager). Mirrors Backend/api/departments.py 1:1.
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

public class CreateDepartmentRequest
{
    public string? Name { get; set; }
    public string? CostCentreCode { get; set; }
    public double? BudgetCeiling { get; set; }
}

[ApiController]
public class DepartmentsController(TeleSpyDbContext db, IViewerContext viewerContext, IAuditService audit) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

    [HttpGet("/departments")]
    public async Task<IActionResult> Get()
    {
        var depts = await db.Departments.OrderBy(d => d.Name).ToListAsync();
        return Ok(new { data = depts.Select(d => d.ToDict()).ToList() });
    }

    [HttpPost("/departments")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Post()
    {
        var data = await RequestBody.ReadJsonSilentAsync<CreateDepartmentRequest>(Request);
        var name = (data.Name ?? "").Trim();
        if (name.Length == 0)
        {
            return StatusCode(422, new
            {
                error_type = "validation_error",
                message = "Department name is required.",
                field = "name",
                hint = "Include a non-empty name for the department.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (await db.Departments.AnyAsync(d => d.Name == name))
        {
            return StatusCode(409, new
            {
                error_type = "duplicate_department",
                message = "A department with that name already exists.",
                field = "name",
                hint = "Choose a different department name, or update the existing one instead.",
                status = 409,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var dept = new Department { Name = name, CostCentreCode = data.CostCentreCode, BudgetCeiling = data.BudgetCeiling };
        db.Departments.Add(dept);
        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("department_created", "department", dept.DepartmentId);
        return StatusCode(201, new { data = dept.ToDict(), message = "Created." });
    }

    [HttpPatch("/departments/{departmentId}")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Patch(string departmentId)
    {
        var dept = await db.Departments.FindAsync(departmentId);
        if (dept is null)
        {
            return StatusCode(404, new
            {
                error_type = "department_not_found",
                message = "Department not found.",
                field = "department_id",
                hint = $"No department exists with id '{departmentId}'. Check /departments for valid ids.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        var data = await RequestBody.ReadJsonSilentAsync<Dictionary<string, JsonElement>>(Request);
        if (data.TryGetValue("name", out var nameEl) && nameEl.ValueKind == JsonValueKind.String &&
            nameEl.GetString() is { Length: > 0 } nameVal)
        {
            dept.Name = nameVal.Trim();
        }
        if (data.TryGetValue("cost_centre_code", out var codeEl))
        {
            dept.CostCentreCode = codeEl.ValueKind == JsonValueKind.String ? codeEl.GetString() : null;
        }
        if (data.TryGetValue("budget_ceiling", out var budgetEl))
        {
            dept.BudgetCeiling = budgetEl.ValueKind == JsonValueKind.Number ? budgetEl.GetDouble() : null;
        }
        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("department_updated", "department", dept.DepartmentId);
        return Ok(new { data = dept.ToDict() });
    }

    /// <summary>Manager's "View department spend" / "View budget status" —
    /// real aggregation over usage_summary, no ML involved.</summary>
    [HttpGet("/departments/{departmentId}/spend")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> Spend(string departmentId)
    {
        var viewer = await viewerContext.LoadedUserAsync();
        if (viewer!.Role!.RoleName == TeleSpy.Role.Manager && viewerContext.ViewerDepartmentId(viewer) != departmentId)
        {
            return StatusCode(404, new
            {
                error_type = "department_not_found",
                message = "Department not found.",
                field = "department_id",
                hint = "Managers can only view spend for their own department.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        var dept = await db.Departments.Include(d => d.Employees).FirstOrDefaultAsync(d => d.DepartmentId == departmentId);
        if (dept is null)
        {
            return StatusCode(404, new
            {
                error_type = "department_not_found",
                message = "Department not found.",
                field = "department_id",
                hint = $"No department exists with id '{departmentId}'. Check /departments for valid ids.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var month = Request.Query["month"].ToString();
        if (string.IsNullOrEmpty(month)) month = viewerContext.CurrentMonth();
        var employeeIds = dept.Employees.Select(e => e.EmployeeId).ToList();
        var total = 0.0;
        if (employeeIds.Count > 0)
        {
            var summaries = await db.UsageSummaries.Where(s => employeeIds.Contains(s.EmployeeId) && s.Month == month).ToListAsync();
            total = Math.Round(summaries.Sum(s => s.TotalCost), 2);
        }

        return Ok(new
        {
            data = new
            {
                department_id = departmentId,
                month,
                total_spend = total,
                budget_ceiling = dept.BudgetCeiling,
                budget_status = dept.GetBudgetStatus(total),
            },
        });
    }
}
