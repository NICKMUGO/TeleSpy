// SIM <-> employee allocation — mirrors Backend/services/allocation.py.
// The mapping is time-bounded: allocating a SIM to a new employee closes the
// previous allocation (end_at = now) and opens a new one, rather than
// overwriting a single FK. Shared by POST /sims/{id}/allocate and the
// extension shortcut on POST /employees.
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Services;

public interface IAllocationService
{
    Task<SimAllocation> AllocateSimAsync(SimCard sim, Employee employee, User actor);
}

public class AllocationService(TeleSpyDbContext db, IAuditService audit) : IAllocationService
{
    public async Task<SimAllocation> AllocateSimAsync(SimCard sim, Employee employee, User actor)
    {
        var current = sim.GetCurrentAllocation();
        current?.CloseAllocation(Clock.UtcNow());

        var allocation = new SimAllocation { SimId = sim.SimId, EmployeeId = employee.EmployeeId, StartAt = Clock.UtcNow() };
        db.SimAllocations.Add(allocation);
        await db.SaveChangesAsync();

        await audit.RecordAuditAsync(
            "sim_allocated", "sim_allocation", allocation.AllocationId,
            actorId: actor.UserId, actorRole: actor.Role?.RoleName,
            meta: new Dictionary<string, object?> { ["sim_id"] = sim.SimId, ["employee_id"] = employee.EmployeeId });

        return allocation;
    }
}
