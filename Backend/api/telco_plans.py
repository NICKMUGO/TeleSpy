"""Telco plans (admin only): list + create."""
from datetime import datetime, timezone

from flask import jsonify, make_response, request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from models.models import TelcoPlan, db
from services.audit import record_audit


class TelcoPlans(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def get(self):
        plans = db.session.query(TelcoPlan).all()
        return make_response(jsonify({"data": [p.to_dict() for p in plans]}), 200)

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self):
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return make_response(jsonify({
                "error_type": "validation_error",
                "message": "Plan name is required.",
                "field": "name",
                "hint": "Include a non-empty name for the telco plan.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 422)
        if db.session.query(TelcoPlan).filter_by(name=name).first():
            return make_response(jsonify({
                "error_type": "duplicate_plan",
                "message": "A plan with that name already exists.",
                "field": "name",
                "hint": "Choose a different plan name, or update the existing plan instead.",
                "status": 409,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 409)

        plan = TelcoPlan(
            name=name,
            provider=data.get("provider"),
            plan_id_ref=data.get("plan_id_ref"),
            rate_per_minute_kes=data.get("rate_per_minute_kes"),
        )
        db.session.add(plan)
        db.session.commit()
        record_audit("telco_plan_created", "telco_plan", plan.plan_id)
        return make_response(jsonify({
            "data": plan.to_dict(),
            "message": "Created.",
        }), 201)


RESOURCES = [
    (TelcoPlans, "/telco-plans"),
]
