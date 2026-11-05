// Analytics reads: anomaly flags (+ resolve), department spend forecast,
// and usage profiles — see Design_Docs/MachineLearningDesignTeleSpy*.jpeg
// and ML/training/. Mirrors Backend/api/analytics.py 1:1. The Isolation
// Forest / KMeans / forecasting batch jobs behind these tables are no
// longer run in-process by either backend: they live as the shared
// Jupyter notebooks under ML/training/ (ml_models.ipynb + run_ml.ipynb),
// which write straight to this database's anomaly_flags, usage_profiles,
// and forecast_results tables since both backends share the same schema.
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

/// <summary>Reads AnomalyFlag rows written by Isolation Forest
/// (ML/training/anomaly_detection.py) rather than computing anything ad hoc.
/// Employee is intentionally excluded: this surfaces total_cost_kes, a field
/// private from other employees.</summary>
[ApiController]
public class AnalyticsController(TeleSpyDbContext db, IViewerContext viewerContext) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

    [HttpGet("/analytics/anomalies")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> Anomalies()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var query = db.AnomalyFlags
            .Include(f => f.Event).ThenInclude(e => e!.Allocation).ThenInclude(a => a!.Employee)
            .AsQueryable();

        var resolvedParam = Request.Query["resolved"].ToString();
        if (!string.IsNullOrEmpty(resolvedParam))
        {
            var wantResolved = resolvedParam.Equals("true", StringComparison.OrdinalIgnoreCase);
            query = wantResolved ? query.Where(f => f.ResolvedAt != null) : query.Where(f => f.ResolvedAt == null);
        }

        var flags = await query.OrderByDescending(f => f.CreatedAt).ToListAsync();
        var data = new List<Dictionary<string, object?>>();
        foreach (var flag in flags)
        {
            var allocation = flag.Event?.Allocation;
            var employee = allocation?.Employee;
            if (viewer!.Role!.RoleName == TeleSpy.Role.Manager &&
                (employee is null || employee.DepartmentId != viewerContext.ViewerDepartmentId(viewer)))
            {
                continue;
            }
            var entry = flag.ToDict();
            entry["event"] = flag.Event!.ToDict();
            entry["employee"] = employee is not null
                ? new Dictionary<string, object?> { ["id"] = employee.EmployeeId, ["full_name"] = employee.FullName }
                : null;
            data.Add(entry);
        }
        return Ok(new { data });
    }

    /// <summary>Admin-only "Resolve anomaly flag" (extends "Review anomaly
    /// flag").</summary>
    [HttpPost("/analytics/anomalies/{flagId}/resolve")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Resolve(string flagId)
    {
        var actor = await viewerContext.LoadedUserAsync();
        var flag = await db.AnomalyFlags.FindAsync(flagId);
        if (flag is null)
        {
            return StatusCode(404, new
            {
                error_type = "flag_not_found",
                message = "Anomaly flag not found.",
                field = "flag_id",
                hint = $"No anomaly flag exists with id '{flagId}'.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        flag.ResolvedAt = Clock.UtcNow();
        flag.ResolvedByUserId = actor!.UserId;
        await db.SaveChangesAsync();
        return Ok(new { data = flag.ToDict(), message = "Anomaly flag resolved." });
    }

    /// <summary>GET /forecast/{departmentId} — the real historical
    /// monthly-spend series, plus the latest stored forecast
    /// (ML/training/ml_models.ipynb), per
    /// Design_Docs/MachineLearningDesignTeleSpy2.jpeg. `forecast` is null
    /// until ML/training/run_ml.ipynb has run at least once for this
    /// department.</summary>
    [HttpGet("/forecast/{departmentId}")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> Forecasts(string departmentId)
    {
        var viewer = await viewerContext.LoadedUserAsync();
        if (viewer!.Role!.RoleName == TeleSpy.Role.Manager && viewerContext.ViewerDepartmentId(viewer) != departmentId)
        {
            return StatusCode(404, new
            {
                error_type = "department_not_found",
                message = "Department not found.",
                field = "department_id",
                hint = "Managers can only view the forecast for their own department.",
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

        var employeeIds = dept.Employees.Select(e => e.EmployeeId).ToList();
        // Department totals: every employee's usage_summaries for a month
        // added together, plus how many employees that total is made of.
        var history = new SortedDictionary<string, double>(StringComparer.Ordinal);
        var employeesWithSpend = new Dictionary<string, int>();
        if (employeeIds.Count > 0)
        {
            var summaries = await db.UsageSummaries.Where(s => employeeIds.Contains(s.EmployeeId)).ToListAsync();
            foreach (var summary in summaries)
            {
                history[summary.Month] = Math.Round(history.GetValueOrDefault(summary.Month) + summary.TotalCost, 2);
                employeesWithSpend[summary.Month] = employeesWithSpend.GetValueOrDefault(summary.Month) + 1;
            }
        }

        // The days the call data spans, so a month it only partly covers
        // (the first month of data, the month still in progress) can be
        // shown as partial rather than as a drop in spend — the same
        // partial-month rule ML/training/forecasting.py scales by.
        DateTime? dataFrom = null, dataTo = null;
        if (await db.UsageEvents.AnyAsync())
        {
            dataFrom = await db.UsageEvents.MinAsync(e => e.OccuredAt);
            dataTo = await db.UsageEvents.MaxAsync(e => e.OccuredAt);
        }
        (int Covered, int InMonth) DaysCovered(string month)
        {
            if (!DateTime.TryParseExact(month, "yyyy-MM", System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out var first))
            {
                return (0, 0);
            }
            var inMonth = DateTime.DaysInMonth(first.Year, first.Month);
            if (dataFrom is null || dataTo is null) return (inMonth, inMonth);
            var start = dataFrom.Value.Year == first.Year && dataFrom.Value.Month == first.Month ? dataFrom.Value.Day : 1;
            var end = dataTo.Value.Year == first.Year && dataTo.Value.Month == first.Month ? dataTo.Value.Day : inMonth;
            return (Math.Max(0, end - start + 1), inMonth);
        }

        var stored = await db.ForecastResults.Where(f => f.DepartmentId == departmentId)
            .OrderByDescending(f => f.GeneratedAt).FirstOrDefaultAsync();

        var body = new Dictionary<string, object?>
        {
            ["data"] = new Dictionary<string, object?>
            {
                ["department_id"] = departmentId,
                ["department_name"] = dept.Name,
                ["employee_count"] = employeeIds.Count,
                ["historical_monthly_spend"] = history.Select(kv =>
                {
                    var (covered, inMonth) = DaysCovered(kv.Key);
                    return new
                    {
                        month = kv.Key,
                        total_cost = kv.Value,
                        employees = employeesWithSpend.GetValueOrDefault(kv.Key),
                        days_covered = covered,
                        days_in_month = inMonth,
                    };
                }).ToList(),
                ["budget_ceiling"] = dept.BudgetCeiling,
                ["forecast"] = stored?.ToDict(),
            },
        };
        if (stored is null)
        {
            body["message"] = "No forecast yet for this department — run ML/training/run_ml.ipynb. Historical series only.";
        }
        return Ok(body);
    }

    /// <summary>GET /analytics/profiles — usage_profile rows, clustered by
    /// calling behavior via KMeans (ML/training/ml_models.ipynb).
    /// ClusterLabel is null for an employee with no usage history yet, or
    /// before ML/training/run_ml.ipynb has ever run.</summary>
    [HttpGet("/analytics/profiles")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> Profiles()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var query = db.Employees.Where(e => e.RemovedAt == null);
        if (viewer!.Role!.RoleName == TeleSpy.Role.Manager)
        {
            var deptId = viewerContext.ViewerDepartmentId(viewer);
            query = query.Where(e => e.DepartmentId == deptId);
        }

        var employees = await query.ToListAsync();
        var data = new List<object>();
        var anyLabeled = false;
        foreach (var employee in employees)
        {
            var profile = await db.UsageProfiles.FirstOrDefaultAsync(p => p.EmployeeId == employee.EmployeeId);
            anyLabeled = anyLabeled || profile?.ClusterLabel is not null;
            data.Add(new
            {
                employee_id = employee.EmployeeId,
                full_name = employee.FullName,
                cluster_label = profile?.ClusterLabel,
            });
        }
        var body = new Dictionary<string, object?> { ["data"] = data };
        if (!anyLabeled)
        {
            body["message"] = "No usage profiles yet — run ML/training/run_ml.ipynb. cluster_label is null until then.";
        }
        return Ok(body);
    }

    /// <summary>GET /analytics/usage-summary — every usage_summaries row
    /// (employee name + extension_code + month + total_cost + everything
    /// else on the row), filled in by ML/training/billing.py rather than
    /// computed here. Sorted by total_cost descending, so the biggest
    /// spenders surface first; optionally narrowed to one month with
    /// ?month=YYYY-MM.</summary>
    [HttpGet("/analytics/usage-summary")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> UsageSummaries()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var query = db.UsageSummaries.Include(s => s.Employee).AsQueryable();
        if (viewer!.Role!.RoleName == TeleSpy.Role.Manager)
        {
            var deptId = viewerContext.ViewerDepartmentId(viewer);
            query = query.Where(s => s.Employee!.DepartmentId == deptId);
        }
        var month = Request.Query["month"].ToString();
        if (!string.IsNullOrEmpty(month))
        {
            query = query.Where(s => s.Month == month);
        }

        var summaries = await query.OrderByDescending(s => s.TotalCost).ToListAsync();
        var data = summaries.Select(s =>
        {
            var entry = s.ToDict();
            entry["full_name"] = s.Employee!.FullName;
            return entry;
        }).ToList();
        return Ok(new { data });
    }
}
