"""Telco plans (admin only): list + create. Rate cards back
services/billing.py's cost calculation.
"""
from flask import request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from core.responses import err, ok
from models.models import TelcoPlan, db
from services.audit import record_audit


class TelcoPlans(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def get(self):
        plans = db.session.query(TelcoPlan).all()
        return ok(data=[p.to_dict() for p in plans])

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self):
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return err("Plan name is required.", 422, "validation_error")
        if db.session.query(TelcoPlan).filter_by(name=name).first():
            return err("A plan with that name already exists.", 409, "duplicate_plan")

        plan = TelcoPlan(
            name=name,
            provider=data.get("provider"),
            plan_id_ref=data.get("plan_id_ref"),
            rate_per_minute_kes=data.get("rate_per_minute_kes"),
        )
        db.session.add(plan)
        db.session.commit()
        record_audit("telco_plan_created", "telco_plan", plan.plan_id)
        return ok(data=plan.to_dict(), status=201, message="Created.")


RESOURCES = [
    (TelcoPlans, "/telco-plans"),
]
