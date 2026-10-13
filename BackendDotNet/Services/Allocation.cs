// SIM <-> employee allocation — who holds a line. The mapping is
// time-bounded: giving a SIM to a new employee closes the previous
// allocation (end_at = now) and opens a new one, rather than overwriting a
// single FK, so past calls stay attributed to whoever held the line then.
//
// The extension code travels with the SIM: the holder's
// Employee.ExtensionCode is the SIM's extension, so handing a line over
// (someone leaves, a colleague takes their number) moves both in one step.
// Shared by POST /sims/{id}/allocate, POST /sims/{id}/unassign and the
// extension field on POST/PATCH /employees.
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Services;

public interface IAllocationService
{
    /// <summary>Gives the SIM — and its extension — to the employee. Whoever
    /// held it before loses both, and any other line the employee held is
    /// released, since a person answers on one extension.</summary>
    Task<SimAllocation> AllocateSimAsync(SimCard sim, Employee employee, User actor);

    /// <summary>Takes the SIM back from whoever holds it, leaving the line
    /// (and its extension) unallocated. Null if nobody held it.</summary>
    Task<SimAllocation?> ReleaseSimAsync(SimCard sim, User actor);

    /// <summary>Moves a bare extension code — one no SIM carries — to the
    /// employee, taking it from whoever had it.</summary>
    Task AssignExtensionCodeAsync(string extension, Employee employee);
}

public class AllocationService(TeleSpyDbContext db, IAuditService audit) : IAllocationService
{
    public async Task<SimAllocation> AllocateSimAsync(SimCard sim, Employee employee, User actor)
    {
        var now = Clock.UtcNow();
        var previous = sim.GetCurrentAllocation();
        if (previous is not null && previous.EmployeeId == employee.EmployeeId) return previous;
        previous?.CloseAllocation(now);

        // Any other line the new holder had goes back to the pool.
        var otherLines = await db.SimAllocations
            .Where(a => a.EmployeeId == employee.EmployeeId && a.SimId != sim.SimId && a.EndAt == null)
            .ToListAsync();
        foreach (var other in otherLines) other.CloseAllocation(now);

        var extension = sim.Extension();
        if (extension is not null)
        {
            await ClearExtensionCodeAsync(extension, exceptEmployeeId: employee.EmployeeId);
        }
        else if (previous is not null)
        {
            await db.SaveChangesAsync();
        }
        // A SIM with no extension leaves the employee without one, rather
        // than still showing the code of the line they just gave up.
        employee.ExtensionCode = extension;

        var allocation = new SimAllocation { SimId = sim.SimId, EmployeeId = employee.EmployeeId, StartAt = now };
        db.SimAllocations.Add(allocation);
        await db.SaveChangesAsync();

        await audit.RecordAuditAsync(
            "sim_allocated", "sim_allocation", allocation.AllocationId,
            actorId: actor.UserId, actorRole: actor.Role?.RoleName,
            meta: new Dictionary<string, object?>
            {
                ["sim_id"] = sim.SimId,
                ["employee_id"] = employee.EmployeeId,
                ["extension"] = extension,
                ["previous_employee_id"] = previous?.EmployeeId,
                ["released_sim_ids"] = otherLines.Select(a => a.SimId).ToList(),
            });

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

        await audit.RecordAuditAsync("sim_unassigned", "sim_allocation", current.AllocationId,
            actorId: actor.UserId, actorRole: actor.Role?.RoleName,
            meta: new Dictionary<string, object?>
            {
                ["sim_id"] = sim.SimId,
                ["employee_id"] = current.EmployeeId,
                ["extension"] = extension,
            });
        return current;
    }

    public async Task AssignExtensionCodeAsync(string extension, Employee employee)
    {
        await ClearExtensionCodeAsync(extension, exceptEmployeeId: employee.EmployeeId);
        employee.ExtensionCode = extension;
        await db.SaveChangesAsync();
    }

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
