"""SIM inventory (admin, with manager read): create, patch lifecycle,
allocate/unassign to employees. ICCID/MSISDN/extension are encrypted at
rest with blind-index fingerprints for uniqueness (see security.py).
"""
from datetime import datetime, timezone

from flask import jsonify, make_response, request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from core.responses import paginate_args, paginate_meta
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
        return make_response(jsonify({
            "data": [s.to_dict(viewer=viewer) for s in rows],
            "meta": paginate_meta(page, limit, total),
        }), 200)

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self):
        viewer = loaded_user()
        data = request.get_json(silent=True) or {}
        iccid = data.get("iccid") or ""
        msisdn = data.get("msisdn") or ""
        extension = data.get("extension")
        if not (iccid.isdigit() and 15 <= len(iccid) <= 22):
            return make_response(jsonify({
                "error_type": "validation_error",
                "message": "ICCID must be 15-22 digits.",
                "field": "iccid",
                "hint": "Provide a numeric ICCID between 15 and 22 digits long.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 422)
        if not (msisdn.isdigit() and 9 <= len(msisdn) <= 12):
            return make_response(jsonify({
                "error_type": "validation_error",
                "message": "MSISDN must be 9-12 digits.",
                "field": "msisdn",
                "hint": "Provide a numeric MSISDN between 9 and 12 digits long.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 422)
        if extension:
            try:
                require_valid_extension(extension)
            except ValidationFailed as exc:
                return make_response(jsonify({
                    "error_type": "validation_error",
                    "message": exc.message,
                    "field": "extension",
                    "hint": "Extension must be exactly 3 digits.",
                    "status": 422,
                    "path": request.path,
                    "method": request.method,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }), 422)

        plan_id = data.get("plan_id")
        if plan_id and not db.session.get(TelcoPlan, plan_id):
            return make_response(jsonify({
                "error_type": "plan_not_found",
                "message": "Telco plan not found.",
                "field": "plan_id",
                "hint": f"No telco plan exists with id {plan_id!r}. Check /telco-plans for valid ids.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)

        iccid_hash, msisdn_hash = blind_index(iccid), blind_index(msisdn)
        clash_filters = [SimCard.iccid_hash == iccid_hash, SimCard.msisdn_hash == msisdn_hash]
        ext_hash = None
        if extension:
            ext_hash = blind_index(extension)
            clash_filters.append(SimCard.msisdn_pbx_hash == ext_hash)
        if db.session.query(SimCard).filter(db.or_(*clash_filters)).first():
            return make_response(jsonify({
                "error_type": "duplicate_sim",
                "message": "A SIM with that ICCID, MSISDN, or extension already exists.",
                "hint": "Check the ICCID, MSISDN, and extension against existing SIM records.",
                "status": 409,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 409)

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
        return make_response(jsonify({
            "data": sim.to_dict(viewer=viewer),
            "message": "Created.",
        }), 201)


class SimById(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def patch(self, sim_id):
        viewer = loaded_user()
        sim = db.session.get(SimCard, sim_id)
        if not sim:
            return make_response(jsonify({
                "error_type": "sim_not_found",
                "message": "SIM not found.",
                "field": "sim_id",
                "hint": f"No SIM exists with id {sim_id!r}.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        data = request.get_json(silent=True) or {}

        if data.get("lifecycle_state"):
            if data["lifecycle_state"] not in {"active", "suspended", "decommissioned"}:
                return make_response(jsonify({
                    "error_type": "invalid_status",
                    "message": "Invalid lifecycle_state.",
                    "field": "lifecycle_state",
                    "hint": "lifecycle_state must be one of: active, suspended, decommissioned.",
                    "status": 422,
                    "path": request.path,
                    "method": request.method,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }), 422)
            sim.lifecycle_state = data["lifecycle_state"]
        if "provider" in data:
            sim.provider = data["provider"]
        if "plan_id" in data:
            if data["plan_id"] and not db.session.get(TelcoPlan, data["plan_id"]):
                return make_response(jsonify({
                    "error_type": "plan_not_found",
                    "message": "Telco plan not found.",
                    "field": "plan_id",
                    "hint": f"No telco plan exists with id {data['plan_id']!r}. Check /telco-plans for valid ids.",
                    "status": 404,
                    "path": request.path,
                    "method": request.method,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }), 404)
            sim.plan_id = data["plan_id"]

        db.session.commit()
        record_audit("sim_updated", "sim_card", sim.sim_id, meta={"fields": list(data.keys())})
        return make_response(jsonify({"data": sim.to_dict(viewer=viewer)}), 200)


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
            return make_response(jsonify({
                "error_type": "sim_not_found",
                "message": "SIM not found.",
                "field": "sim_id",
                "hint": f"No SIM exists with id {sim_id!r}.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        data = request.get_json(silent=True) or {}
        employee = db.session.get(Employee, data.get("employee_id", ""))
        if not employee:
            return make_response(jsonify({
                "error_type": "employee_not_found",
                "message": "Employee not found.",
                "field": "employee_id",
                "hint": "Provide the id of an existing Employee to allocate this SIM to.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        if sim.lifecycle_state != "active":
            return make_response(jsonify({
                "error_type": "sim_not_active",
                "message": "SIM is not active.",
                "field": "sim_id",
                "hint": f"This SIM's lifecycle_state is {sim.lifecycle_state!r}; only active SIMs can be allocated.",
                "status": 409,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 409)

        allocation = allocate_sim(sim, employee, actor)
        return make_response(jsonify({
            "data": allocation.to_dict(),
            "message": "SIM allocated.",
        }), 201)


class SimUnassign(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self, sim_id):
        actor = loaded_user()
        sim = db.session.get(SimCard, sim_id)
        if not sim:
            return make_response(jsonify({
                "error_type": "sim_not_found",
                "message": "SIM not found.",
                "field": "sim_id",
                "hint": f"No SIM exists with id {sim_id!r}.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        current = sim.get_current_allocation()
        if not current:
            return make_response(jsonify({
                "error_type": "no_active_allocation",
                "message": "This SIM has no active allocation.",
                "field": "sim_id",
                "hint": "There's nothing to unassign — this SIM isn't currently allocated to an employee.",
                "status": 409,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 409)
        current.close_allocation(utcnow())
        db.session.commit()
        record_audit("sim_unassigned", "sim_allocation", current.allocation_id, actor_id=actor.user_id, actor_role=actor.role.role_name)
        return make_response(jsonify({"message": "SIM unassigned."}), 200)


RESOURCES = [
    (Sims, "/sims"),
    (SimById, "/sims/<sim_id>"),
    (SimAllocate, "/sims/<sim_id>/allocate"),
    (SimUnassign, "/sims/<sim_id>/unassign"),
]
