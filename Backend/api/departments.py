"""Departments: CRUD (admin) + department spend / budget status
(admin or the department's own manager).
"""
from datetime import datetime, timezone

from flask import jsonify, make_response, request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from models.models import Department, UsageSummary, db
from services.audit import record_audit

from api.common import current_month, loaded_user, viewer_department_id


class Departments(Resource):
    @jwt_required()
    def get(self):
        depts = db.session.query(Department).order_by(Department.name).all()
        return make_response(jsonify({"data": [d.to_dict() for d in depts]}), 200)

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self):
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return make_response(jsonify({
                "error_type": "validation_error",
                "message": "Department name is required.",
                "field": "name",
                "hint": "Include a non-empty name for the department.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 422)
        if db.session.query(Department).filter_by(name=name).first():
            return make_response(jsonify({
                "error_type": "duplicate_department",
                "message": "A department with that name already exists.",
                "field": "name",
                "hint": "Choose a different department name, or update the existing one instead.",
                "status": 409,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 409)

        dept = Department(name=name, cost_centre_code=data.get("cost_centre_code"), budget_ceiling=data.get("budget_ceiling"))
        db.session.add(dept)
        db.session.commit()
        record_audit("department_created", "department", dept.department_id)
        return make_response(jsonify({
            "data": dept.to_dict(),
            "message": "Created.",
        }), 201)


class DepartmentById(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def patch(self, department_id):
        dept = db.session.get(Department, department_id)
        if not dept:
            return make_response(jsonify({
                "error_type": "department_not_found",
                "message": "Department not found.",
                "field": "department_id",
                "hint": f"No department exists with id {department_id!r}. Check /departments for valid ids.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        data = request.get_json(silent=True) or {}
        if data.get("name"):
            dept.name = data["name"].strip()
        if "cost_centre_code" in data:
            dept.cost_centre_code = data["cost_centre_code"]
        if "budget_ceiling" in data:
            dept.budget_ceiling = data["budget_ceiling"]
        db.session.commit()
        record_audit("department_updated", "department", dept.department_id)
        return make_response(jsonify({"data": dept.to_dict()}), 200)


class DepartmentSpend(Resource):
    """Manager's "View department spend" / "View budget status" — real
    aggregation over usage_summary, no ML involved."""

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN], ROLE_SLUGS[Role.MANAGER])
    def get(self, department_id):
        viewer = loaded_user()
        if viewer.role.role_name == Role.MANAGER and viewer_department_id(viewer) != department_id:
            return make_response(jsonify({
                "error_type": "department_not_found",
                "message": "Department not found.",
                "field": "department_id",
                "hint": "Managers can only view spend for their own department.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        dept = db.session.get(Department, department_id)
        if not dept:
            return make_response(jsonify({
                "error_type": "department_not_found",
                "message": "Department not found.",
                "field": "department_id",
                "hint": f"No department exists with id {department_id!r}. Check /departments for valid ids.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)

        month = request.args.get("month", current_month())
        employee_ids = [e.employee_id for e in dept.employees]
        total = 0.0
        if employee_ids:
            summaries = db.session.query(UsageSummary).filter(UsageSummary.employee_id.in_(employee_ids), UsageSummary.month == month).all()
            total = round(sum(s.total_cost for s in summaries), 2)

        return make_response(jsonify({"data": {
            "department_id": department_id,
            "month": month,
            "total_spend": total,
            "budget_ceiling": dept.budget_ceiling,
            "budget_status": dept.get_budget_status(total),
        }}), 200)


RESOURCES = [
    (Departments, "/departments"),
    (DepartmentById, "/departments/<department_id>"),
    (DepartmentSpend, "/departments/<department_id>/spend"),
]
