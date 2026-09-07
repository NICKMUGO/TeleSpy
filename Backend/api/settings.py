"""Per-user self-service: profile (GET/PATCH /settings/me) and the
employee's own usage view (GET /me/usage).
"""
from flask import request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from core.responses import err, ok, paginate_args, paginate_meta
from models.models import UsageEvent, UsageProfile, db

from api.common import loaded_user


class Me(Resource):
    @jwt_required()
    def get(self):
        user = loaded_user()
        if not user:
            return err("Not found.", 404, "not_found")
        out = user.to_dict()
        if user.employee:
            out.update(user.employee.to_dict(viewer=user))
        return ok(data=out)

    @jwt_required()
    def patch(self):
        user = loaded_user()
        data = request.get_json(silent=True) or {}
        if data.get("full_name") and user.employee:
            user.employee.full_name = data["full_name"].strip()
        db.session.commit()
        out = user.to_dict()
        if user.employee:
            out.update(user.employee.to_dict(viewer=user))
        return ok(data=out, message="Profile updated.")


class MyUsage(Resource):
    """Employee self-service view — Design_Docs sequence diagram's
    GET /me/usage: own CDR events + allocation, cost totals, usage
    profile cluster. Any authenticated user with an Employee record can
    call this for their own data (Admin/Manager included)."""

    @jwt_required()
    def get(self):
        viewer = loaded_user()
        if not viewer or not viewer.employee:
            return err("No employee record for this account.", 404, "not_found")
        employee = viewer.employee
        page, limit = paginate_args()

        allocation_ids = [a.allocation_id for a in employee.allocations]
        # .in_([]) correctly matches zero rows — no ternary needed.
        query = db.session.query(UsageEvent).filter(UsageEvent.allocation_id.in_(allocation_ids))
        total = query.count()
        rows = query.order_by(UsageEvent.occured_at.desc()).offset((page - 1) * limit).limit(limit).all()

        current_allocation = employee.get_active_allocation()
        profile = db.session.query(UsageProfile).filter_by(employee_id=employee.employee_id).first()

        return ok(
            data={
                "usage": [r.to_dict() for r in rows],
                "cost_summaries": [s.to_dict() for s in employee.usage_summaries],
                "current_allocation": current_allocation.to_dict() if current_allocation else None,
                "current_sim": current_allocation.sim.to_dict(viewer=viewer) if current_allocation else None,
                "usage_profile_cluster": profile.cluster_label if profile else None,
            },
            meta=paginate_meta(page, limit, total),
        )


RESOURCES = [
    (Me, "/settings/me"),
    (MyUsage, "/me/usage"),
]
