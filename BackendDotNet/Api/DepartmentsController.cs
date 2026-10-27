// Departments: CRUD (admin) + department spend / budget status (admin or
// the department's own manager). Mirrors Backend/api/departments.py 1:1.
using System.Globalization;
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

    private const int OverviewTrendMonths = 6;
    private const int OverviewTopSpenders = 5;
    // A department past this share of its ceiling is "near" it — the same
    // 90% the dashboard uses.
    private const double NearCeilingPct = 90.0;

    private static bool IsMonth(string value) =>
        DateTime.TryParseExact(value, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    private static double Round2(double value) => Math.Round(value, 2);

    /// <summary>GET /departments/overview?month=YYYY-MM — the departments
    /// dashboard: every department side by side for one month (spend against
    /// its ceiling, the change on the month before, cost per head, the call
    /// mix, staff over their own limit, open anomalies, its biggest
    /// spenders, the stored forecast) plus each one's spend for the last few
    /// months. The latest month with costs when `month` is omitted.
    ///
    /// An Admin gets every department; a Manager gets only their own, as on
    /// /departments/{id}/spend. KES figures come from usage_summaries
    /// (ML/training/billing.py) — nothing is priced here — and a call
    /// belongs to the department of whoever held the line.</summary>
    [HttpGet("/departments/overview")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> Overview()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var isAdmin = viewer!.Role!.RoleName == TeleSpy.Role.Admin;
        var scopeDeptId = isAdmin ? null : viewerContext.ViewerDepartmentId(viewer);

        var departments = await db.Departments.OrderBy(d => d.Name).ToListAsync();
        if (!isAdmin) departments = departments.Where(d => d.DepartmentId == scopeDeptId).ToList();
        var departmentIds = departments.Select(d => d.DepartmentId).ToList();

        var summaries = await db.UsageSummaries
            .Where(s => s.Employee!.DepartmentId != null && departmentIds.Contains(s.Employee.DepartmentId))
            .Select(s => new
            {
                s.Month, s.TotalCost, s.ListCost, s.EmployeeId, s.Employee!.FullName, s.Employee.DepartmentId,
                Limit = s.Employee.User != null && s.Employee.User.Role != null ? s.Employee.User.Role.CallLimitKshs : null,
            })
            .ToListAsync();
        var months = summaries.Select(s => s.Month).Where(IsMonth).Distinct()
            .OrderByDescending(m => m, StringComparer.Ordinal).ToList();

        var month = Request.Query["month"].ToString();
        if (string.IsNullOrEmpty(month)) month = months.FirstOrDefault() ?? viewerContext.CurrentMonth();
        if (!IsMonth(month))
        {
            return StatusCode(422, new
            {
                error_type = "validation_error",
                message = "month must be in YYYY-MM form.",
                field = "month",
                hint = "e.g. 2026-07.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        var monthStart = DateTime.ParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture);
        var monthEnd = monthStart.AddMonths(1);
        var previousMonth = monthStart.AddMonths(-1).ToString("yyyy-MM");
        var trendMonths = months.Where(m => string.CompareOrdinal(m, month) <= 0).Take(OverviewTrendMonths).Reverse().ToList();

        var headcount = await db.Employees
            .Where(e => e.DepartmentId != null && departmentIds.Contains(e.DepartmentId) && e.RemovedAt == null)
            .GroupBy(e => e.DepartmentId!)
            .Select(g => new { DepartmentId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.DepartmentId, g => g.Count);

        var now = Clock.UtcNow();
        var lines = await db.SimAllocations
            .Where(a => a.StartAt <= now && (a.EndAt == null || a.EndAt > now))
            .Where(a => a.Employee!.DepartmentId != null && departmentIds.Contains(a.Employee.DepartmentId))
            .GroupBy(a => a.Employee!.DepartmentId!)
            .Select(g => new { DepartmentId = g.Key, Count = g.Select(a => a.SimId).Distinct().Count() })
            .ToDictionaryAsync(g => g.DepartmentId, g => g.Count);

        // The month's calls per department and call type, in calls and
        // minutes — individual calls carry no cost.
        var callMix = await db.UsageEvents
            .Where(e => e.OccuredAt >= monthStart && e.OccuredAt < monthEnd && e.AllocationId != null)
            .Where(e => e.Allocation!.Employee!.DepartmentId != null && departmentIds.Contains(e.Allocation.Employee.DepartmentId))
            .GroupBy(e => new { e.Allocation!.Employee!.DepartmentId, e.CallClassification })
            .Select(g => new { g.Key.DepartmentId, g.Key.CallClassification, Calls = g.Count(), Minutes = g.Sum(e => e.DurationMinutes) })
            .ToListAsync();

        var openAnomalies = await db.AnomalyFlags
            .Where(f => f.ResolvedAt == null && f.Event!.OccuredAt >= monthStart && f.Event.OccuredAt < monthEnd)
            .Where(f => f.Event!.Allocation!.Employee!.DepartmentId != null && departmentIds.Contains(f.Event.Allocation.Employee.DepartmentId))
            .GroupBy(f => f.Event!.Allocation!.Employee!.DepartmentId!)
            .Select(g => new { DepartmentId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.DepartmentId, g => g.Count);

        var forecasts = (await db.ForecastResults.Where(f => departmentIds.Contains(f.DepartmentId)).ToListAsync())
            .GroupBy(f => f.DepartmentId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(f => f.GeneratedAt).First());

        var totalCost = Round2(summaries.Where(s => s.Month == month).Sum(s => s.TotalCost));

        var rows = departments.Select(d =>
        {
            var mine = summaries.Where(s => s.DepartmentId == d.DepartmentId).ToList();
            var thisMonth = mine.Where(s => s.Month == month).ToList();
            var before = mine.Where(s => s.Month == previousMonth).ToList();
            var cost = Round2(thisMonth.Sum(s => s.TotalCost));
            var listCost = Round2(thisMonth.Sum(s => s.ListCost));
            var staff = headcount.GetValueOrDefault(d.DepartmentId);
            var usedPct = d.BudgetCeiling is > 0 ? Math.Round(100.0 * cost / d.BudgetCeiling.Value, 1) : (double?)null;
            var over = thisMonth.Where(s => s.Limit is not null && s.TotalCost > s.Limit).ToList();
            var forecast = forecasts.GetValueOrDefault(d.DepartmentId);
            var mix = callMix.Where(c => c.DepartmentId == d.DepartmentId).ToList();
            return new
            {
                id = d.DepartmentId,
                name = d.Name,
                cost_centre_code = d.CostCentreCode,
                budget_ceiling_kes = d.BudgetCeiling,
                headcount = staff,
                lines = lines.GetValueOrDefault(d.DepartmentId),
                staff_with_spend = thisMonth.Count,
                cost_kes = cost,
                list_cost_kes = listCost,
                discount_kes = Round2(listCost - cost),
                share_pct = totalCost > 0 ? Math.Round(100.0 * cost / totalCost, 1) : 0,
                previous_cost_kes = before.Count > 0 ? Round2(before.Sum(s => s.TotalCost)) : (double?)null,
                cost_per_head_kes = staff > 0 ? Round2(cost / staff) : (double?)null,
                budget_used_pct = usedPct,
                over_budget_by_kes = d.BudgetCeiling is not null && cost > d.BudgetCeiling ? Round2(cost - d.BudgetCeiling.Value) : 0,
                status = usedPct is null ? "unmonitored" : usedPct > 100 ? "over_budget" : usedPct >= NearCeilingPct ? "near_ceiling" : "within_budget",
                staff_over_limit = over.Count,
                staff_over_limit_kes = Round2(over.Sum(s => s.TotalCost - s.Limit!.Value)),
                open_anomalies = openAnomalies.GetValueOrDefault(d.DepartmentId),
                calls = new[] { Constants.CallClassInternal, Constants.CallClassExternal, Constants.CallClassInternational }
                    .Select(type => new
                    {
                        type,
                        calls = mix.Where(c => c.CallClassification == type).Sum(c => c.Calls),
                        minutes = Round2(mix.Where(c => c.CallClassification == type).Sum(c => c.Minutes)),
                    }).ToList(),
                trend = trendMonths.Select(m => new
                {
                    month = m,
                    cost_kes = Round2(mine.Where(s => s.Month == m).Sum(s => s.TotalCost)),
                }).ToList(),
                top_spenders = thisMonth.OrderByDescending(s => s.TotalCost).Take(OverviewTopSpenders)
                    .Select(s => new
                    {
                        employee_id = s.EmployeeId,
                        full_name = s.FullName,
                        cost_kes = Round2(s.TotalCost),
                        over_limit = s.Limit is not null && s.TotalCost > s.Limit,
                    }).ToList(),
                forecast = forecast is null ? null : new
                {
                    period = forecast.Period,
                    forecasted_cost_kes = forecast.ForecastedCost,
                    confidence_low_kes = forecast.ConfidenceLow,
                    confidence_high_kes = forecast.ConfidenceHigh,
                },
            };
        }).ToList();

        return Ok(new
        {
            data = new
            {
                month,
                previous_month = previousMonth,
                months,
                trend_months = trendMonths,
                total_cost_kes = totalCost,
                total_budget_kes = Round2(departments.Sum(d => d.BudgetCeiling ?? 0)),
                departments = rows,
            },
        });
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
            nameEl.GetString()?.Trim() is { Length: > 0 } nameVal)
        {
            if (await db.Departments.AnyAsync(d => d.DepartmentId != departmentId && d.Name.ToLower() == nameVal.ToLower()))
            {
                return StatusCode(409, new
                {
                    error_type = "duplicate_department_name",
                    message = "Another department already has that name.",
                    field = "name",
                    hint = "Department names must be unique.",
                    status = 409,
                    path = Request.Path.Value,
                    method = Request.Method,
                    timestamp = NowIso(),
                });
            }
            dept.Name = nameVal;
        }
        // Its people work the customer service ticket desk.
        if (data.TryGetValue("handles_customer_service", out var deskEl) &&
            deskEl.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            dept.HandlesCustomerService = deskEl.GetBoolean();
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
