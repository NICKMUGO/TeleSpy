"""SIM inventory (admin, with manager read): create, patch lifecycle,
allocate/unassign to employees. ICCID/MSISDN/extension are encrypted at
rest with blind-index fingerprints for uniqueness (see security.py).
"""
from flask import request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from core.responses import err, ok, paginate_args, paginate_meta
from core.time import utcnow
from models.models import Employee, SimCard, TelcoPlan, db
from security import blind_index, encrypt_value
from services.allocation import allocate_sim
from services.audit import record_audit
from validators import ValidationFailed, require_valid_extension

from api.common import loaded_user


class Sims(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN], ROLE_SLUGS[Role.MANAGER])
    def get(self):
        viewer = loaded_user()
        page, limit = paginate_args()
        query = db.session.query(SimCard).order_by(SimCard.created_at.desc())
        total = query.count()
        rows = query.offset((page - 1) * limit).limit(limit).all()
        return ok(data=[s.to_dict(viewer=viewer) for s in rows], meta=paginate_meta(page, limit, total))

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self):
        viewer = loaded_user()
        data = request.get_json(silent=True) or {}
        iccid = data.get("iccid") or ""
        msisdn = data.get("msisdn") or ""
        extension = data.get("extension")
        if not (iccid.isdigit() and 15 <= len(iccid) <= 22):
            return err("ICCID must be 15-22 digits.", 422, "validation_error")
        if not (msisdn.isdigit() and 9 <= len(msisdn) <= 12):
            return err("MSISDN must be 9-12 digits.", 422, "validation_error")
        if extension:
            try:
                require_valid_extension(extension)
            except ValidationFailed as exc:
                return err(exc.message, 422, "validation_error")

        plan_id = data.get("plan_id")
        if plan_id and not db.session.get(TelcoPlan, plan_id):
            return err("Telco plan not found.", 404, "plan_not_found")

        iccid_hash, msisdn_hash = blind_index(iccid), blind_index(msisdn)
        clash_filters = [SimCard.iccid_hash == iccid_hash, SimCard.msisdn_hash == msisdn_hash]
        ext_hash = None
        if extension:
            ext_hash = blind_index(extension)
            clash_filters.append(SimCard.msisdn_pbx_hash == ext_hash)
        if db.session.query(SimCard).filter(db.or_(*clash_filters)).first():
            return err("A SIM with that ICCID, MSISDN, or extension already exists.", 409, "duplicate_sim")

        sim = SimCard(
            iccid_enc=encrypt_value(iccid), iccid_hash=iccid_hash,
            msisdn_enc=encrypt_value(msisdn), msisdn_hash=msisdn_hash,
            msisdn_pbx_enc=encrypt_value(extension) if extension else None,
            msisdn_pbx_hash=ext_hash,
            provider=data.get("provider"), plan_id=plan_id, lifecycle_state="active",
        )
        db.session.add(sim)
        db.session.commit()
        record_audit("sim_created", "sim_card", sim.sim_id)
        return ok(data=sim.to_dict(viewer=viewer), status=201, message="Created.")


class SimById(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def patch(self, sim_id):
        viewer = loaded_user()
        sim = db.session.get(SimCard, sim_id)
        if not sim:
            return err("SIM not found.", 404, "sim_not_found")
        data = request.get_json(silent=True) or {}

        if data.get("lifecycle_state"):
            if data["lifecycle_state"] not in {"active", "suspended", "decommissioned"}:
                return err("Invalid lifecycle_state.", 422, "invalid_status")
            sim.lifecycle_state = data["lifecycle_state"]
        if "provider" in data:
            sim.provider = data["provider"]
        if "plan_id" in data:
            if data["plan_id"] and not db.session.get(TelcoPlan, data["plan_id"]):
                return err("Telco plan not found.", 404, "plan_not_found")
            sim.plan_id = data["plan_id"]

        db.session.commit()
        record_audit("sim_updated", "sim_card", sim.sim_id, meta={"fields": list(data.keys())})
        return ok(data=sim.to_dict(viewer=viewer))


class SimAllocate(Resource):
    """The employee<->SIM/extension mapping is time-bounded: allocating a
    SIM to a new employee closes the previous allocation (end_at = now)
    and opens a new one, rather than overwriting a single FK."""

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self, sim_id):
        actor = loaded_user()
        sim = db.session.get(SimCard, sim_id)
        if not sim:
            return err("SIM not found.", 404, "sim_not_found")
        data = request.get_json(silent=True) or {}
        employee = db.session.get(Employee, data.get("employee_id", ""))
        if not employee:
            return err("Employee not found.", 404, "employee_not_found")
        if sim.lifecycle_state != "active":
            return err("SIM is not active.", 409, "sim_not_active")

        allocation = allocate_sim(sim, employee, actor)
        return ok(data=allocation.to_dict(), status=201, message="SIM allocated.")


class SimUnassign(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self, sim_id):
        actor = loaded_user()
        sim = db.session.get(SimCard, sim_id)
        if not sim:
            return err("SIM not found.", 404, "sim_not_found")
        current = sim.get_current_allocation()
        if not current:
            return err("This SIM has no active allocation.", 409, "no_active_allocation")
        current.close_allocation(utcnow())
        db.session.commit()
        record_audit("sim_unassigned", "sim_allocation", current.allocation_id, actor_id=actor.user_id, actor_role=actor.role.role_name)
        return ok(message="SIM unassigned.")


RESOURCES = [
    (Sims, "/sims"),
    (SimById, "/sims/<sim_id>"),
    (SimAllocate, "/sims/<sim_id>/allocate"),
    (SimUnassign, "/sims/<sim_id>/unassign"),
]
