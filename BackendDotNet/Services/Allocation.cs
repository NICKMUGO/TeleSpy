// SIM <-> employee allocation — who holds a line. The mapping is
// time-bounded: giving a SIM to a new employee closes the previous
// allocation (end_at = now) and opens a new one, rather than overwriting a
// single FK, so past calls stay attributed to whoever held the line then.
//
// The extension code travels with the SIM: the holder's
// Employee.ExtensionCode is the SIM's extension, so handing a line over
// moves both in one step.
//
// Lines are fixed — seeded from the CSV, with the odd spare — and a person
// holds one. Giving someone a free spare just moves them (their old line
// goes back to the pool). Giving them a line someone else holds needs an
// explicit choice about that holder (Handover):
//   - Swap: the two trade lines — a change of position, nobody leaves.
//   - Remove: the holder left the company. They're removed (see
//     RemoveEmployeeAsync) and the line goes to the new person.
// Removing someone stops their line being tracked against them, so it is
// only ever done on purpose: callers verify the Admin's step-up first
// (IStepUpService), and the HR manager and Admins are emailed. Breaking a
// rule throws LineRuleViolation, which RuleViolationMiddleware turns into
// a 409.
// Shared by POST /sims/{id}/allocate, POST /sims/{id}/unassign, the
// extension field on POST/PATCH /employees and POST /employees/{id}/remove.
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Services;

/// <summary>A request that breaks the line rules above. Carries the api/
/// error fields so the 409 reads like any other refusal.</summary>
public class LineRuleViolation(string errorType, string message, string field, string hint) : Exception(message)
{
    public string ErrorType { get; } = errorType;
    public string Field { get; } = field;
    public string Hint { get; } = hint;
}

/// <summary>What happens to the person holding a line that's being given
/// to someone else.</summary>
public enum DisplacedHolder { Swap, Remove }

/// <summary>The caller's choice for a held line. A Remove must carry one of
/// EmployeeRemoval.Reasons, and the caller must have verified the Admin's
/// step-up before passing it.</summary>
public record Handover(DisplacedHolder Choice, string? RemovalReason = null)
{
    public static Handover? Parse(string? choice, string? removalReason) => choice?.Trim().ToLowerInvariant() switch
    {
        "swap" => new Handover(DisplacedHolder.Swap),
        "remove" => new Handover(DisplacedHolder.Remove, removalReason?.Trim()),
        _ => null,
    };
}

/// <summary>Why someone left — stored on Employee.RemovalReason.</summary>
public static class EmployeeRemoval
{
    public static readonly IReadOnlyDictionary<string, string> Reasons = new Dictionary<string, string>
    {
        ["resigned"] = "Resigned",
        ["terminated"] = "Terminated",
        ["contract_ended"] = "Contract ended",
        ["retired"] = "Retired",
        ["other"] = "Other",
    };

    public static string Describe(string reason) => Reasons.GetValueOrDefault(reason, reason);

    public static void RequireValidReason(string? reason)
    {
        if (reason is not null && Reasons.ContainsKey(reason)) return;
        throw new LineRuleViolation("removal_reason_required", "Say why this employee is leaving.", "removal_reason",
            $"removal_reason must be one of: {string.Join(", ", Reasons.Keys)}.");
    }
}

public interface IAllocationService
{
    /// <summary>Gives the SIM — and its extension — to the employee. A free
    /// SIM moves them onto it, releasing any line they had. A held SIM
    /// needs a Handover saying what happens to its holder.</summary>
    Task<SimAllocation> AllocateSimAsync(SimCard sim, Employee employee, User actor, Handover? handover = null);

    /// <summary>Takes the SIM back from whoever holds it, leaving the line
    /// (and its extension) unallocated. Null if nobody held it.</summary>
    Task<SimAllocation?> ReleaseSimAsync(SimCard sim, User actor);

    /// <summary>Moves a bare extension code — one no SIM carries — to the
    /// employee, under the same rules as a SIM.</summary>
    Task AssignExtensionCodeAsync(string extension, Employee employee, User actor, Handover? handover = null);

    /// <summary>The employee left the company: their line goes back to the
    /// pool (or to `replacement`, who the caller then gives it to), their
    /// login is disabled and signed out, and they drop out of every list.
    /// The row stays, so past calls and bills keep their owner. The caller
    /// must have verified the Admin's step-up.</summary>
    Task RemoveEmployeeAsync(Employee employee, string? reason, User actor, Employee? replacement = null);
}

public class AllocationService(
    TeleSpyDbContext db,
    ICacheService cache,
    INotificationService notifications) : IAllocationService
{
    public async Task<SimAllocation> AllocateSimAsync(SimCard sim, Employee employee, User actor, Handover? handover = null)
    {
        var previous = sim.GetCurrentAllocation();
        if (previous is not null && previous.EmployeeId == employee.EmployeeId) return previous;
        RequireNotRemoved(employee);

        if (previous is not null)
        {
            var holder = await db.Employees.Include(e => e.User).FirstAsync(e => e.EmployeeId == previous.EmployeeId);
            switch (handover?.Choice)
            {
                case DisplacedHolder.Swap:
                    await RequireHasLineAsync(employee, holder);
                    return (await SwapLinesAsync(employee, holder, actor))!;
                case DisplacedHolder.Remove:
                    // Closes the holder's allocation, so the SIM is free below.
                    await RemoveEmployeeAsync(holder, handover.RemovalReason, actor, replacement: employee);
                    break;
                default:
                    throw HolderChoiceRequired(holder, sim.Extension());
            }
        }

        var now = Clock.UtcNow();
        // A free line: whatever they had goes back to the pool.
        var otherLines = await db.SimAllocations
            .Where(a => a.EmployeeId == employee.EmployeeId && a.SimId != sim.SimId && a.EndAt == null)
            .ToListAsync();
        foreach (var other in otherLines) other.CloseAllocation(now);

        var extension = sim.Extension();
        if (extension is not null)
        {
            await ClearExtensionCodeAsync(extension, exceptEmployeeId: employee.EmployeeId);
        }
        else if (otherLines.Count > 0)
        {
            await db.SaveChangesAsync();
        }
        // A SIM with no extension leaves the employee without one, rather
        // than still showing the code of the line they just gave up.
        employee.ExtensionCode = extension;

        var allocation = new SimAllocation { SimId = sim.SimId, EmployeeId = employee.EmployeeId, StartAt = now };
        db.SimAllocations.Add(allocation);
        await db.SaveChangesAsync();

        return allocation;
    }

    public async Task<SimAllocation?> ReleaseSimAsync(SimCard sim, User actor)
    {
        var current = sim.GetCurrentAllocation();
        if (current is null) return null;
        current.CloseAllocation(Clock.UtcNow());

        var extension = sim.Extension();
        if (extension is not null)
        {
            await ClearExtensionCodeAsync(extension, exceptEmployeeId: null);
        }
        else
        {
            await db.SaveChangesAsync();
        }

        return current;
    }

    public async Task AssignExtensionCodeAsync(string extension, Employee employee, User actor, Handover? handover = null)
    {
        if (employee.ExtensionCode == extension) return;
        RequireNotRemoved(employee);

        var holder = await db.Employees.Include(e => e.User)
            .FirstOrDefaultAsync(e => e.ExtensionCode == extension && e.EmployeeId != employee.EmployeeId);
        if (holder is not null)
        {
            switch (handover?.Choice)
            {
                case DisplacedHolder.Swap:
                    await RequireHasLineAsync(employee, holder);
                    await SwapLinesAsync(employee, holder, actor);
                    return;
                case DisplacedHolder.Remove:
                    await RemoveEmployeeAsync(holder, handover.RemovalReason, actor, replacement: employee);
                    break;
                default:
                    throw HolderChoiceRequired(holder, extension);
            }
        }

        // Moving to a free code: whatever SIM they held goes back to the
        // pool, so their record never shows one extension and another
        // line's number.
        var now = Clock.UtcNow();
        var heldLines = await db.SimAllocations
            .Where(a => a.EmployeeId == employee.EmployeeId && a.EndAt == null)
            .ToListAsync();
        foreach (var held in heldLines) held.CloseAllocation(now);
        employee.ExtensionCode = extension;
        await db.SaveChangesAsync();
    }

    public async Task RemoveEmployeeAsync(Employee employee, string? reason, User actor, Employee? replacement = null)
    {
        if (employee.RemovedAt is not null) throw Removed(employee);
        EmployeeRemoval.RequireValidReason(reason);
        if (employee.EmployeeId == actor.EmployeeId)
        {
            throw new LineRuleViolation("cannot_remove_self", "You can't remove yourself.", "employee_id",
                "Hand the Admin role to someone else first (make them Admin from Edit employee); they can then remove you.");
        }
        if (employee.User is null) await db.Entry(employee).Reference(e => e.User).LoadAsync();

        var now = Clock.UtcNow();
        var openLines = await db.SimAllocations.Include(a => a.Sim)
            .Where(a => a.EmployeeId == employee.EmployeeId && a.EndAt == null)
            .ToListAsync();
        foreach (var line in openLines) line.CloseAllocation(now);
        var releasedExtension = employee.ExtensionCode ?? openLines.Select(a => a.Sim?.Extension()).FirstOrDefault(x => x is not null);

        employee.ExtensionCode = null;
        employee.RemovedAt = now;
        employee.RemovalReason = reason;
        if (employee.User is not null) employee.User.IsActive = false;
        await db.SaveChangesAsync();
        // Signed out everywhere, now — not when their token runs out.
        if (employee.User is not null) await cache.ClearActiveSessionAsync(employee.User.UserId);

        await notifications.NotifyEmployeeRemovedAsync(employee, reason!, releasedExtension, replacement, actor);
    }

    /// <summary>Two people trade lines — SIMs and extension codes — in one
    /// go; nobody is left without one. Returns `mover`'s new allocation
    /// (null if `holder` only had a bare code).</summary>
    private async Task<SimAllocation?> SwapLinesAsync(Employee mover, Employee holder, User actor)
    {
        var now = Clock.UtcNow();
        var moverLines = await OpenLinesAsync(mover.EmployeeId);
        var holderLines = await OpenLinesAsync(holder.EmployeeId);
        var moverSimId = moverLines.FirstOrDefault()?.SimId;
        var holderSimId = holderLines.FirstOrDefault()?.SimId;
        var (moverCode, holderCode) = (mover.ExtensionCode, holder.ExtensionCode);

        // Close and clear first: the one-open-line and unique-code indexes
        // are checked row by row, so neither side can hold both at once.
        foreach (var line in moverLines.Concat(holderLines)) line.CloseAllocation(now);
        mover.ExtensionCode = null;
        holder.ExtensionCode = null;
        await db.SaveChangesAsync();

        SimAllocation? moverAllocation = null;
        if (holderSimId is not null)
        {
            moverAllocation = new SimAllocation { SimId = holderSimId, EmployeeId = mover.EmployeeId, StartAt = now };
            db.SimAllocations.Add(moverAllocation);
        }
        if (moverSimId is not null)
        {
            db.SimAllocations.Add(new SimAllocation { SimId = moverSimId, EmployeeId = holder.EmployeeId, StartAt = now });
        }
        mover.ExtensionCode = holderCode;
        holder.ExtensionCode = moverCode;
        await db.SaveChangesAsync();

        return moverAllocation;
    }

    private Task<List<SimAllocation>> OpenLinesAsync(string employeeId) =>
        db.SimAllocations.Where(a => a.EmployeeId == employeeId && a.EndAt == null).ToListAsync();

    private async Task RequireHasLineAsync(Employee mover, Employee holder)
    {
        if (mover.ExtensionCode is not null || (await OpenLinesAsync(mover.EmployeeId)).Count > 0) return;
        throw new LineRuleViolation("swap_needs_a_line",
            $"{mover.FullName} has no line to swap with {holder.FullName}.", "displaced_holder",
            $"A swap trades two lines. For a new hire taking over, choose that {holder.FullName} left the company instead.");
    }

    private static void RequireNotRemoved(Employee employee)
    {
        if (employee.RemovedAt is not null) throw Removed(employee);
    }

    private static LineRuleViolation Removed(Employee employee) => new(
        "employee_removed",
        $"{employee.FullName} has been removed.",
        "employee_id",
        "Removed employees are kept only for their call and billing history. Add the person again as a new employee.");

    private static LineRuleViolation HolderChoiceRequired(Employee holder, string? extension) => new(
        "displaced_holder_required",
        $"{(extension is null ? "This line" : $"Extension {extension}")} is held by {holder.FullName}.",
        "displaced_holder",
        $"Say what happens to {holder.FullName}: \"swap\" (they take the other person's line — a change of position) " +
        "or \"remove\" (they left the company; needs a reason and your step-up confirmation).");

    /// <summary>Extension codes are unique, so the old holder's has to be
    /// cleared — and saved — before the new holder's is set.</summary>
    private async Task ClearExtensionCodeAsync(string extension, string? exceptEmployeeId)
    {
        var holders = await db.Employees
            .Where(e => e.ExtensionCode == extension && e.EmployeeId != exceptEmployeeId)
            .ToListAsync();
        foreach (var holder in holders) holder.ExtensionCode = null;
        await db.SaveChangesAsync();
    }
}
