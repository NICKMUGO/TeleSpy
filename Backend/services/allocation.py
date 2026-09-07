"""SIM <-> employee allocation.

The mapping is time-bounded: allocating a SIM to a new employee closes the
previous allocation (end_at = now) and opens a new one, rather than
overwriting a single FK. Shared by POST /sims/<id>/allocate and the
extension shortcut on POST /employees.
"""
from core.time import utcnow
from models.models import SimAllocation, db
from services.audit import record_audit


def allocate_sim(sim, employee, actor) -> SimAllocation:
    current = sim.get_current_allocation()
    if current:
        current.close_allocation(utcnow())
    allocation = SimAllocation(sim_id=sim.sim_id, employee_id=employee.employee_id, start_at=utcnow())
    db.session.add(allocation)
    db.session.commit()
    record_audit(
        "sim_allocated", "sim_allocation", allocation.allocation_id,
        actor_id=actor.user_id, actor_role=actor.role.role_name,
        meta={"sim_id": sim.sim_id, "employee_id": employee.employee_id},
    )
    return allocation
