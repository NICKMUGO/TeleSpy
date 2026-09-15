"""Roles + budget ceilings: list/patch roles, and the "who is over their
monthly cost ceiling" report.
"""
from datetime import datetime, timezone

from flask import jsonify, make_response, request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from models.models import Role as RoleModel, UsageSummary, db
from security import decrypt_value
from services.audit import record_audit

from api.common import current_month, loaded_user, viewer_department_id


class Roles(Resource):
    @jwt_required()
    def get(self):
        roles = db.session.query(RoleModel).all()
        return make_response(jsonify({"data": [r.to_dict() for r in roles]}), 200)


class RoleById(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def patch(self, role_id):
        role = db.session.get(RoleModel, role_id)
        if not role:
            return make_response(jsonify({
                "error_type": "role_not_found",
                "message": "Role not found.",
                "field": "role_id",
                "hint": f"No role exists with id {role_id!r}. Check /roles for valid ids.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        data = request.get_json(silent=True) or {}
        if "call_limit_kshs" in data:
            value = data["call_limit_kshs"]
            if value is not None and (not isinstance(value, (int, float)) or value <= 0):
                return make_response(jsonify({
                    "error_type": "validation_error",
                    "message": "call_limit_kshs must be a positive number or null.",
                    "field": "call_limit_kshs",
                    "hint": "Pass a positive number for the monthly limit, or null to remove the limit.",
                    "status": 422,
                    "path": request.path,
                    "method": request.method,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }), 422)
            role.call_limit_kshs = value
        if "permissions" in data and isinstance(data["permissions"], list):
            role.permissions = data["permissions"]
        db.session.commit()
        record_audit("role_limit_updated", "role", role.role_id, meta={"call_limit_kshs": role.call_limit_kshs})
        return make_response(jsonify({
            "data": role.to_dict(),
            "message": "Role updated.",
        }), 200)


def _employees_over_budget(month: str, department_id: str | None = None):
    query = db.session.query(UsageSummary).filter_by(month=month)
    over = []
    for summary in query.all():
        employee = summary.employee
        if department_id and employee.department_id != department_id:
            continue
        if not employee.user or not employee.user.role:
            continue
        limit = employee.user.role.call_limit_kshs
        if summary.check_threshold_breach(limit):
            allocation = employee.get_active_allocation()
            over.append({
                "employee_id": employee.employee_id,
                "staff_number": employee.staff_number,
                "full_name": employee.full_name,
                "department_id": employee.department_id,
                "role": employee.user.role.role_name,
                "extension": decrypt_value(allocation.sim.msisdn_pbx_enc) if (allocation and allocation.sim.msisdn_pbx_enc) else None,
                "limit_kshs": limit,
                "total_cost": summary.total_cost,
                "overage_kshs": round(summary.total_cost - limit, 2),
            })
    return over


class BudgetsOverLimit(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN], ROLE_SLUGS[Role.MANAGER])
    def get(self):
        viewer = loaded_user()
        month = request.args.get("month", current_month())
        scope_dept = viewer_department_id(viewer) if viewer.role.role_name == Role.MANAGER else None
        return make_response(jsonify({"data": _employees_over_budget(month, scope_dept)}), 200)


RESOURCES = [
    (Roles, "/roles"),
    (RoleById, "/roles/<role_id>"),
    (BudgetsOverLimit, "/budgets/over-limit"),
]
