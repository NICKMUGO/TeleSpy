// SIM inventory (admin, with manager read): create, patch lifecycle,
// allocate/unassign to employees. ICCID/MSISDN/extension are encrypted at
// rest with blind-index fingerprints for uniqueness (see Security.cs).
// Mirrors Backend/api/sims.py 1:1.
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

public class CreateSimRequest
{
    public string? Iccid { get; set; }
    public string? Msisdn { get; set; }
    public string? Extension { get; set; }
    public string? PlanId { get; set; }
    public string? Provider { get; set; }
}

public class AllocateSimRequest
{
    public string? EmployeeId { get; set; }
}

[ApiController]
public class SimsController(
    TeleSpyDbContext db,
    IViewerContext viewerContext,
    IAuditService audit,
    IAllocationService allocationService) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");
    private static readonly HashSet<string> ValidLifecycleStates = ["active", "suspended", "decommissioned"];

    [HttpGet("/sims")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> Get()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var (page, limit) = Pagination.PaginateArgs(Request);
        var query = db.SimCards.Include(s => s.Allocations).OrderByDescending(s => s.CreatedAt);
        var total = await query.CountAsync();
        var rows = await query.Skip((page - 1) * limit).Take(limit).ToListAsync();
        return Ok(new
        {
            data = rows.Select(s => s.ToDict(viewer!)).ToList(),
            meta = Pagination.PaginateMeta(page, limit, total),
        });
    }

    [HttpPost("/sims")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Post()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var data = await RequestBody.ReadJsonSilentAsync<CreateSimRequest>(Request);
        var iccid = data.Iccid ?? "";
        var msisdn = data.Msisdn ?? "";
        var extension = data.Extension;

        if (!(iccid.Length > 0 && iccid.All(char.IsAsciiDigit) && iccid.Length is >= 15 and <= 22))
        {
            return StatusCode(422, new
            {
                error_type = "validation_error",
                message = "ICCID must be 15-22 digits.",
                field = "iccid",
                hint = "Provide a numeric ICCID between 15 and 22 digits long.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (!(msisdn.Length > 0 && msisdn.All(char.IsAsciiDigit) && msisdn.Length is >= 9 and <= 12))
        {
            return StatusCode(422, new
            {
                error_type = "validation_error",
                message = "MSISDN must be 9-12 digits.",
                field = "msisdn",
                hint = "Provide a numeric MSISDN between 9 and 12 digits long.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (!string.IsNullOrEmpty(extension))
        {
            try
            {
                Validators.RequireValidExtension(extension);
            }
            catch (ValidationFailed exc)
            {
                return StatusCode(422, new
                {
                    error_type = "validation_error",
                    message = exc.Message,
                    field = "extension",
                    hint = "Extension must be exactly 3 digits.",
                    status = 422,
                    path = Request.Path.Value,
                    method = Request.Method,
                    timestamp = NowIso(),
                });
            }
        }

        var planId = data.PlanId;
        if (!string.IsNullOrEmpty(planId) && await db.TelcoPlans.FindAsync(planId) is null)
        {
            return StatusCode(404, new
            {
                error_type = "plan_not_found",
                message = "Telco plan not found.",
                field = "plan_id",
                hint = $"No telco plan exists with id '{planId}'. Check /telco-plans for valid ids.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var iccidHash = Security.BlindIndex(iccid);
        var msisdnHash = Security.BlindIndex(msisdn);
        var extHash = extension is { Length: > 0 } ? Security.BlindIndex(extension) : null;

        var clash = await db.SimCards.AnyAsync(s =>
            s.IccidHash == iccidHash || s.MsisdnHash == msisdnHash || (extHash != null && s.MsisdnPbxHash == extHash));
        if (clash)
        {
            return StatusCode(409, new
            {
                error_type = "duplicate_sim",
                message = "A SIM with that ICCID, MSISDN, or extension already exists.",
                hint = "Check the ICCID, MSISDN, and extension against existing SIM records.",
                status = 409,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var sim = new SimCard
        {
            IccidEnc = Security.EncryptValue(iccid)!,
            IccidHash = iccidHash!,
            MsisdnEnc = Security.EncryptValue(msisdn)!,
            MsisdnHash = msisdnHash!,
            MsisdnPbxEnc = extension is { Length: > 0 } ? Security.EncryptValue(extension) : null,
            MsisdnPbxHash = extHash,
            Provider = data.Provider,
            PlanId = planId,
            LifecycleState = "active",
        };
        db.SimCards.Add(sim);
        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("sim_created", "sim_card", sim.SimId);
        return StatusCode(201, new { data = sim.ToDict(viewer!), message = "Created." });
    }

    [HttpPatch("/sims/{simId}")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Patch(string simId)
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var sim = await db.SimCards.Include(s => s.Allocations).FirstOrDefaultAsync(s => s.SimId == simId);
        if (sim is null)
        {
            return StatusCode(404, new
            {
                error_type = "sim_not_found",
                message = "SIM not found.",
                field = "sim_id",
                hint = $"No SIM exists with id '{simId}'.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var data = await RequestBody.ReadJsonSilentAsync<Dictionary<string, JsonElement>>(Request);

        if (data.TryGetValue("lifecycle_state", out var stateEl) && stateEl.ValueKind == JsonValueKind.String &&
            stateEl.GetString() is { Length: > 0 } stateVal)
        {
            if (!ValidLifecycleStates.Contains(stateVal))
            {
                return StatusCode(422, new
                {
                    error_type = "invalid_status",
                    message = "Invalid lifecycle_state.",
                    field = "lifecycle_state",
                    hint = "lifecycle_state must be one of: active, suspended, decommissioned.",
                    status = 422,
                    path = Request.Path.Value,
                    method = Request.Method,
                    timestamp = NowIso(),
                });
            }
            sim.LifecycleState = stateVal;
        }
        if (data.TryGetValue("provider", out var providerEl))
        {
            sim.Provider = providerEl.ValueKind == JsonValueKind.String ? providerEl.GetString() : null;
        }
        if (data.TryGetValue("plan_id", out var planIdEl))
        {
            var planIdVal = planIdEl.ValueKind == JsonValueKind.String ? planIdEl.GetString() : null;
            if (!string.IsNullOrEmpty(planIdVal) && await db.TelcoPlans.FindAsync(planIdVal) is null)
            {
                return StatusCode(404, new
                {
                    error_type = "plan_not_found",
                    message = "Telco plan not found.",
                    field = "plan_id",
                    hint = $"No telco plan exists with id '{planIdVal}'. Check /telco-plans for valid ids.",
                    status = 404,
                    path = Request.Path.Value,
                    method = Request.Method,
                    timestamp = NowIso(),
                });
            }
            sim.PlanId = planIdVal;
        }

        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("sim_updated", "sim_card", sim.SimId,
            meta: new Dictionary<string, object?> { ["fields"] = data.Keys.ToList() });
        return Ok(new { data = sim.ToDict(viewer!) });
    }

    /// <summary>The employee&lt;-&gt;SIM/extension mapping is time-bounded:
    /// allocating a SIM to a new employee closes the previous allocation
    /// (end_at = now) and opens a new one, rather than overwriting a single
    /// FK.</summary>
    [HttpPost("/sims/{simId}/allocate")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Allocate(string simId)
    {
        var actor = await viewerContext.LoadedUserAsync();
        var sim = await db.SimCards.Include(s => s.Allocations).FirstOrDefaultAsync(s => s.SimId == simId);
        if (sim is null)
        {
            return StatusCode(404, new
            {
                error_type = "sim_not_found",
                message = "SIM not found.",
                field = "sim_id",
                hint = $"No SIM exists with id '{simId}'.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        var data = await RequestBody.ReadJsonSilentAsync<AllocateSimRequest>(Request);
        var employee = !string.IsNullOrEmpty(data.EmployeeId) ? await db.Employees.FindAsync(data.EmployeeId) : null;
        if (employee is null)
        {
            return StatusCode(404, new
            {
                error_type = "employee_not_found",
                message = "Employee not found.",
                field = "employee_id",
                hint = "Provide the id of an existing Employee to allocate this SIM to.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (sim.LifecycleState != "active")
        {
            return StatusCode(409, new
            {
                error_type = "sim_not_active",
                message = "SIM is not active.",
                field = "sim_id",
                hint = $"This SIM's lifecycle_state is '{sim.LifecycleState}'; only active SIMs can be allocated.",
                status = 409,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var allocation = await allocationService.AllocateSimAsync(sim, employee, actor!);
        return StatusCode(201, new { data = allocation.ToDict(), message = "SIM allocated." });
    }

    [HttpPost("/sims/{simId}/unassign")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Unassign(string simId)
    {
        var actor = await viewerContext.LoadedUserAsync();
        var sim = await db.SimCards.Include(s => s.Allocations).FirstOrDefaultAsync(s => s.SimId == simId);
        if (sim is null)
        {
            return StatusCode(404, new
            {
                error_type = "sim_not_found",
                message = "SIM not found.",
                field = "sim_id",
                hint = $"No SIM exists with id '{simId}'.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        var current = sim.GetCurrentAllocation();
        if (current is null)
        {
            return StatusCode(409, new
            {
                error_type = "no_active_allocation",
                message = "This SIM has no active allocation.",
                field = "sim_id",
                hint = "There's nothing to unassign — this SIM isn't currently allocated to an employee.",
                status = 409,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        current.CloseAllocation(Clock.UtcNow());
        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("sim_unassigned", "sim_allocation", current.AllocationId,
            actorId: actor!.UserId, actorRole: actor.Role?.RoleName);
        return Ok(new { message = "SIM unassigned." });
    }
}
