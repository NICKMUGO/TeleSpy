"""Departments: CRUD (admin) + department spend / budget status
(admin or the department's own manager).
"""
from flask import request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from core.responses import err, ok
from models.models import Department, UsageSummary, db
from services.audit import record_audit

from api.common import current_month, loaded_user, viewer_department_id


class Departments(Resource):
    @jwt_required()
    def get(self):
        depts = db.session.query(Department).order_by(Department.name).all()
        return ok(data=[d.to_dict() for d in depts])

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self):
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return err("Department name is required.", 422, "validation_error")
        if db.session.query(Department).filter_by(name=name).first():
            return err("A department with that name already exists.", 409, "duplicate_department")

        dept = Department(name=name, cost_centre_code=data.get("cost_centre_code"), budget_ceiling=data.get("budget_ceiling"))
        db.session.add(dept)
        db.session.commit()
        record_audit("department_created", "department", dept.department_id)
        return ok(data=dept.to_dict(), status=201, message="Created.")


class DepartmentById(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def patch(self, department_id):
        dept = db.session.get(Department, department_id)
        if not dept:
            return err("Department not found.", 404, "department_not_found")
        data = request.get_json(silent=True) or {}
        if data.get("name"):
            dept.name = data["name"].strip()
        if "cost_centre_code" in data:
            dept.cost_centre_code = data["cost_centre_code"]
        if "budget_ceiling" in data:
            dept.budget_ceiling = data["budget_ceiling"]
        db.session.commit()
        record_audit("department_updated", "department", dept.department_id)
        return ok(data=dept.to_dict())


class DepartmentSpend(Resource):
    """Manager's "View department spend" / "View budget status" — real
    aggregation over usage_summary, no ML involved."""

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN], ROLE_SLUGS[Role.MANAGER])
    def get(self, department_id):
        viewer = loaded_user()
        if viewer.role.role_name == Role.MANAGER and viewer_department_id(viewer) != department_id:
            return err("Department not found.", 404, "department_not_found")
        dept = db.session.get(Department, department_id)
        if not dept:
            return err("Department not found.", 404, "department_not_found")

        month = request.args.get("month", current_month())
        employee_ids = [e.employee_id for e in dept.employees]
        total = 0.0
        if employee_ids:
            summaries = db.session.query(UsageSummary).filter(UsageSummary.employee_id.in_(employee_ids), UsageSummary.month == month).all()
            total = round(sum(s.total_cost for s in summaries), 2)

        return ok(data={
            "department_id": department_id,
            "month": month,
            "total_spend": total,
            "budget_ceiling": dept.budget_ceiling,
            "budget_status": dept.get_budget_status(total),
        })


RESOURCES = [
    (Departments, "/departments"),
    (DepartmentById, "/departments/<department_id>"),
    (DepartmentSpend, "/departments/<department_id>/spend"),
]
