// Per-user self-service: profile (GET/PATCH /settings/me) and the
// employee's own usage view (GET /me/usage) — plus the one company-wide
// setting kept here, the standard number format (/settings/number-format,
// Admin only).
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

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
            if (await EmployeeNames.IsTakenAsync(db, data.FullName, exceptEmployeeId: user.Employee.EmployeeId))
            {
                return StatusCode(409, EmployeeNames.DuplicateError(Request));
            }
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

/// <summary>The company's standard number format: every staff line is one
/// shared prefix followed by the 3-digit extension, so with the prefix
/// 0703083 the person on extension 370 is 0703083370. Admin only.</summary>
[ApiController]
public class NumberFormatController(TeleSpyDbContext db, IAuditService audit) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

    private IActionResult Error(string errorType, string message, int status, string? field = null, string? hint = null) =>
        StatusCode(status, new
        {
            error_type = errorType,
            message,
            field,
            hint,
            status,
            path = Request.Path.Value,
            method = Request.Method,
            timestamp = NowIso(),
        });

    private static Dictionary<string, object?> ToDict(BillingSettings settings) => new()
    {
        ["prefix"] = settings.CompanyNumberPrefix,
        ["extension_digits"] = 3,
        ["example"] = settings.CompanyNumberFor("370"),
        ["updated_at"] = settings.UpdatedAt.ToString("o"),
    };

    [HttpGet("/settings/number-format")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Get()
    {
        var settings = await db.BillingSettings.FindAsync(BillingConstants.BillingSettingsId);
        if (settings is null)
        {
            return Error("settings_not_found", "Company settings have not been initialised.", 404,
                hint: "Restart the API so CallRateBootstrap can seed the defaults.");
        }
        return Ok(new { data = ToDict(settings) });
    }

    /// <summary>Body: { prefix, apply_to_existing? }. With apply_to_existing
    /// the number of every SIM that has an extension is rewritten to the new
    /// prefix + that extension; without it only SIMs registered from now on
    /// follow the new format.</summary>
    [HttpPatch("/settings/number-format")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Patch()
    {
        var settings = await db.BillingSettings.FindAsync(BillingConstants.BillingSettingsId);
        if (settings is null)
        {
            return Error("settings_not_found", "Company settings have not been initialised.", 404,
                hint: "Restart the API so CallRateBootstrap can seed the defaults.");
        }
        var data = await RequestBody.ReadJsonSilentAsync<Dictionary<string, JsonElement>>(Request);

        var prefix = data.TryGetValue("prefix", out var prefixEl) && prefixEl.ValueKind == JsonValueKind.String
            ? (prefixEl.GetString() ?? "").Replace(" ", "")
            : "";
        if (!prefix.All(char.IsAsciiDigit) ||
            prefix.Length is < BillingConstants.CompanyNumberPrefixMinLength or > BillingConstants.CompanyNumberPrefixMaxLength)
        {
            return Error("validation_error",
                $"prefix must be {BillingConstants.CompanyNumberPrefixMinLength} to {BillingConstants.CompanyNumberPrefixMaxLength} digits.",
                422, "prefix", "The digits every company number starts with, before the 3-digit extension — e.g. 0703083.");
        }
        var applyToExisting = data.TryGetValue("apply_to_existing", out var applyEl) && applyEl.ValueKind == JsonValueKind.True;

        var renumbered = 0;
        if (applyToExisting)
        {
            var sims = await db.SimCards.ToListAsync();
            var targets = sims.Where(s => s.Extension() is not null)
                .ToDictionary(s => s.SimId, s => prefix + s.Extension());
            // A SIM that keeps its number (it has no extension) mustn't
            // already be on one of the new numbers.
            var newHashes = targets.Values.Select(n => Security.BlindIndex(n)!).ToHashSet();
            if (sims.Any(s => !targets.ContainsKey(s.SimId) && newHashes.Contains(s.MsisdnHash)))
            {
                return Error("duplicate_sim", "Another SIM already uses one of the numbers this format would produce.", 409,
                    "prefix", "Choose a different prefix, or change that SIM's number first.");
            }

            var changing = sims.Where(s => targets.TryGetValue(s.SimId, out var number) &&
                Security.BlindIndex(number) != s.MsisdnHash).ToList();
            await using var transaction = await db.Database.BeginTransactionAsync();
            // Numbers are unique, and the new set can overlap the old one,
            // so each SIM is moved off its old number before any takes a
            // new one.
            foreach (var sim in changing) sim.MsisdnHash = "renumbering:" + sim.SimId;
            await db.SaveChangesAsync();
            foreach (var sim in changing)
            {
                sim.MsisdnEnc = Security.EncryptValue(targets[sim.SimId])!;
                sim.MsisdnHash = Security.BlindIndex(targets[sim.SimId])!;
                sim.UpdatedAt = Clock.UtcNow();
            }
            settings.CompanyNumberPrefix = prefix;
            settings.UpdatedAt = Clock.UtcNow();
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            renumbered = changing.Count;
        }
        else
        {
            settings.CompanyNumberPrefix = prefix;
            settings.UpdatedAt = Clock.UtcNow();
            await db.SaveChangesAsync();
        }

        await audit.RecordAuditAsync("number_format_updated", "billing_settings", settings.Id,
            meta: new Dictionary<string, object?> { ["prefix"] = prefix, ["sims_renumbered"] = renumbered });
        var outDict = ToDict(settings);
        outDict["sims_renumbered"] = renumbered;
        return Ok(new
        {
            data = outDict,
            message = renumbered > 0 ? $"Number format updated; {renumbered} SIM(s) renumbered." : "Number format updated.",
        });
    }
}
