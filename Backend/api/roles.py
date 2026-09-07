"""Roles + budget ceilings: list/patch roles, and the "who is over their
monthly cost ceiling" report.
"""
from flask import request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from core.responses import err, ok
from models.models import Role as RoleModel, UsageSummary, db
from security import decrypt_value
from services.audit import record_audit

from api.common import current_month, loaded_user, viewer_department_id


class Roles(Resource):
    @jwt_required()
    def get(self):
        roles = db.session.query(RoleModel).all()
        return ok(data=[r.to_dict() for r in roles])


class RoleById(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def patch(self, role_id):
        role = db.session.get(RoleModel, role_id)
        if not role:
            return err("Role not found.", 404, "role_not_found")
        data = request.get_json(silent=True) or {}
        if "call_limit_kshs" in data:
            value = data["call_limit_kshs"]
            if value is not None and (not isinstance(value, (int, float)) or value <= 0):
                return err("call_limit_kshs must be a positive number or null.", 422, "validation_error")
            role.call_limit_kshs = value
        if "permissions" in data and isinstance(data["permissions"], list):
            role.permissions = data["permissions"]
        db.session.commit()
        record_audit("role_limit_updated", "role", role.role_id, meta={"call_limit_kshs": role.call_limit_kshs})
        return ok(data=role.to_dict(), message="Role updated.")


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
        return ok(data=_employees_over_budget(month, scope_dept))


RESOURCES = [
    (Roles, "/roles"),
    (RoleById, "/roles/<role_id>"),
    (BudgetsOverLimit, "/budgets/over-limit"),
]
