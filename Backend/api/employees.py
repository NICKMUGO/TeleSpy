"""Employees (HR records + their login): admin CRUD, manager read scoped
to their own department, employee read limited to themselves.
"""
from datetime import datetime, timezone

from flask import jsonify, make_response, request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from core.responses import paginate_args, paginate_meta
from core.time import utcnow
from models.models import Department, Employee, PasswordHistory, SimCard, User, db
from security import blind_index, generate_reset_token
from services.allocation import allocate_sim
from services.audit import record_audit
from validators import ValidationFailed, require_valid_email, require_valid_extension

from api.auth import issue_password_reset
from api.common import loaded_user, viewer_department_id


class Employees(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN], ROLE_SLUGS[Role.MANAGER])
    def get(self):
        viewer = loaded_user()
        page, limit = paginate_args()
        query = db.session.query(Employee)
        if viewer.role.role_name == Role.MANAGER:
            query = query.filter_by(department_id=viewer_department_id(viewer))
        if request.args.get("department_id"):
            query = query.filter_by(department_id=request.args["department_id"])

        total = query.count()
        rows = query.order_by(Employee.full_name).offset((page - 1) * limit).limit(limit).all()
        return make_response(jsonify({
            "data": [e.to_dict(viewer=viewer) for e in rows],
            "meta": paginate_meta(page, limit, total),
        }), 200)

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self):
        actor = loaded_user()
        data = request.get_json(silent=True) or {}
        try:
            email = require_valid_email(data.get("email", ""))
        except ValidationFailed as exc:
            return make_response(jsonify({
                "error_type": "validation_error",
                "message": exc.message,
                "field": "email",
                "hint": "Provide a valid email address, e.g. name@example.com.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 422)

        role_name = data.get("role")
        full_name = (data.get("full_name") or "").strip()
        department_id = data.get("department_id")
        staff_number = data.get("staff_number")
        extension = data.get("extension")

        if role_name not in ROLE_SLUGS:
            return make_response(jsonify({
                "error_type": "invalid_role",
                "message": "Unknown role.",
                "field": "role",
                "hint": f"role must be one of: {', '.join(sorted(ROLE_SLUGS))}.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 422)
        if not full_name:
            return make_response(jsonify({
                "error_type": "validation_error",
                "message": "full_name is required.",
                "field": "full_name",
                "hint": "Include the employee's full name in the request body.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 422)
        if department_id and not db.session.get(Department, department_id):
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
        if db.session.query(User).filter_by(email=email).first():
            return make_response(jsonify({
                "error_type": "email_taken",
                "message": "An account with that email already exists.",
                "field": "email",
                "hint": "Use a different email address for this employee.",
                "status": 409,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 409)
        if staff_number and db.session.query(Employee).filter_by(staff_number=staff_number).first():
            return make_response(jsonify({
                "error_type": "duplicate_staff_number",
                "message": "That staff number is already assigned.",
                "field": "staff_number",
                "hint": "Choose a staff number that isn't already in use.",
                "status": 409,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 409)

        employee = Employee(department_id=department_id, staff_number=staff_number, full_name=full_name)
        db.session.add(employee)
        db.session.flush()

        placeholder_password = generate_reset_token()  # never revealed; account starts via forced reset
        user = User(
            employee_id=employee.employee_id,
            email=email,
            role_id=ROLE_SLUGS[role_name],
            is_active=True,
            must_change_password=True,
        )
        user.password = placeholder_password
        db.session.add(user)
        db.session.flush()
        db.session.add(PasswordHistory(user_id=user.user_id, password_hash=user._password, created_at=utcnow()))
        db.session.commit()

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
            sim = db.session.query(SimCard).filter_by(msisdn_pbx_hash=blind_index(extension)).first()
            if not sim:
                return make_response(jsonify({
                    "error_type": "extension_not_found",
                    "message": "No SIM found with that extension to allocate.",
                    "field": "extension",
                    "hint": "Register a SIM with this extension before assigning it to an employee.",
                    "status": 404,
                    "path": request.path,
                    "method": request.method,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }), 404)
            allocate_sim(sim, employee, actor)

        issue_password_reset(user)
        record_audit("employee_created", "employee", employee.employee_id, actor_id=actor.user_id, actor_role=actor.role.role_name)
        return make_response(jsonify({
            "data": employee.to_dict(viewer=actor),
            "message": "Created.",
        }), 201)


class EmployeeById(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN], ROLE_SLUGS[Role.MANAGER], ROLE_SLUGS[Role.EMPLOYEE])
    def get(self, employee_id):
        viewer = loaded_user()
        employee = db.session.get(Employee, employee_id)
        if not employee:
            return make_response(jsonify({
                "error_type": "employee_not_found",
                "message": "Employee not found.",
                "field": "employee_id",
                "hint": f"No employee exists with id {employee_id!r}.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        if viewer.role.role_name == Role.MANAGER and viewer_department_id(viewer) != employee.department_id:
            return make_response(jsonify({
                "error_type": "employee_not_found",
                "message": "Employee not found.",
                "field": "employee_id",
                "hint": "Managers can only view employees in their own department.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        if viewer.role.role_name == Role.EMPLOYEE and viewer.employee_id != employee.employee_id:
            return make_response(jsonify({
                "error_type": "employee_not_found",
                "message": "Employee not found.",
                "field": "employee_id",
                "hint": "Employees can only view their own record.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        return make_response(jsonify({"data": employee.to_dict(viewer=viewer)}), 200)

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def patch(self, employee_id):
        actor = loaded_user()
        employee = db.session.get(Employee, employee_id)
        if not employee:
            return make_response(jsonify({
                "error_type": "employee_not_found",
                "message": "Employee not found.",
                "field": "employee_id",
                "hint": f"No employee exists with id {employee_id!r}.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        data = request.get_json(silent=True) or {}

        if data.get("full_name"):
            employee.full_name = data["full_name"].strip()
        if data.get("staff_number"):
            clash = db.session.query(Employee).filter(Employee.staff_number == data["staff_number"], Employee.employee_id != employee.employee_id).first()
            if clash:
                return make_response(jsonify({
                    "error_type": "duplicate_staff_number",
                    "message": "That staff number is already assigned.",
                    "field": "staff_number",
                    "hint": "Choose a staff number that isn't already in use.",
                    "status": 409,
                    "path": request.path,
                    "method": request.method,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }), 409)
            employee.staff_number = data["staff_number"]
        if data.get("department_id"):
            if not db.session.get(Department, data["department_id"]):
                return make_response(jsonify({
                    "error_type": "department_not_found",
                    "message": "Department not found.",
                    "field": "department_id",
                    "hint": f"No department exists with id {data['department_id']!r}. Check /departments for valid ids.",
                    "status": 404,
                    "path": request.path,
                    "method": request.method,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }), 404)
            employee.department_id = data["department_id"]
        if employee.user:
            if data.get("role"):
                if data["role"] not in ROLE_SLUGS:
                    return make_response(jsonify({
                        "error_type": "invalid_role",
                        "message": "Unknown role.",
                        "field": "role",
                        "hint": f"role must be one of: {', '.join(sorted(ROLE_SLUGS))}.",
                        "status": 422,
                        "path": request.path,
                        "method": request.method,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }), 422)
                employee.user.role_id = ROLE_SLUGS[data["role"]]
            if "is_active" in data:
                employee.user.is_active = bool(data["is_active"])

        db.session.commit()
        record_audit("employee_updated", "employee", employee.employee_id, meta={"fields": list(data.keys())})
        return make_response(jsonify({"data": employee.to_dict(viewer=actor)}), 200)

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def delete(self, employee_id):
        """"Deactivate user account" (use-case diagram) — disables login,
        keeps the HR record and all history intact."""
        employee = db.session.get(Employee, employee_id)
        if not employee or not employee.user:
            return make_response(jsonify({
                "error_type": "employee_not_found",
                "message": "Employee not found.",
                "field": "employee_id",
                "hint": f"No employee with a login exists for id {employee_id!r}.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        employee.user.is_active = False
        db.session.commit()
        record_audit("employee_deactivated", "employee", employee.employee_id)
        return "", 204


RESOURCES = [
    (Employees, "/employees"),
    (EmployeeById, "/employees/<employee_id>"),
]
