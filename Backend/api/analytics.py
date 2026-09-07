"""Analytics reads: anomaly flags (+ resolve), department spend forecast,
and usage profiles. The forecast/profile ML layers have marked seams and
stay null until a trained model is wired up (see Design_Docs/ML).
"""
from flask import request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from core.responses import err, ok
from core.time import utcnow
from models.models import AnomalyFlag, Department, Employee, ForecastResult, UsageEvent, UsageProfile, UsageSummary, db
from services.audit import record_audit

from api.common import loaded_user, viewer_department_id

_ANALYTICS_ROLE_SLUGS = [ROLE_SLUGS[Role.ADMIN], ROLE_SLUGS[Role.MANAGER]]


class Anomalies(Resource):
    """Reads AnomalyFlag rows persisted at CDR-ingest time (see
    services/anomaly.py) rather than computing anything ad hoc — matches
    the sequence diagram's "score usage features" happening during
    ingestion. Employee is intentionally excluded: this surfaces
    total_cost_kes, a field private from other employees."""

    @jwt_required()
    @role_id_required(*_ANALYTICS_ROLE_SLUGS)
    def get(self):
        viewer = loaded_user()
        query = db.session.query(AnomalyFlag).join(UsageEvent)
        if request.args.get("resolved") is not None:
            want_resolved = request.args["resolved"].lower() == "true"
            query = query.filter(AnomalyFlag.resolved_at.isnot(None) if want_resolved else AnomalyFlag.resolved_at.is_(None))

        flags = query.order_by(AnomalyFlag.created_at.desc()).all()
        data = []
        for flag in flags:
            allocation = flag.event.allocation
            employee = allocation.employee if allocation else None
            if viewer.role.role_name == Role.MANAGER and (not employee or employee.department_id != viewer_department_id(viewer)):
                continue
            entry = flag.to_dict()
            entry["event"] = flag.event.to_dict()
            entry["employee"] = {"id": employee.employee_id, "full_name": employee.full_name} if employee else None
            data.append(entry)
        return ok(data=data)


class AnomalyResolve(Resource):
    """Admin-only "Resolve anomaly flag" (extends "Review anomaly flag")."""

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self, flag_id):
        actor = loaded_user()
        flag = db.session.get(AnomalyFlag, flag_id)
        if not flag:
            return err("Anomaly flag not found.", 404, "flag_not_found")
        flag.resolved_at = utcnow()
        flag.resolved_by_user_id = actor.user_id
        db.session.commit()
        record_audit("anomaly_resolved", "anomaly_flag", flag.flag_id)
        return ok(data=flag.to_dict(), message="Anomaly flag resolved.")


class Forecasts(Resource):
    """GET /forecast/<department_id> — fetches the real historical
    monthly-spend series (no ML needed for that part); the forward
    prediction itself is the Prophet seam and stays null until that
    model is wired up, per Design_Docs/MachineLearningDesignTeleSpy2.jpeg."""

    @jwt_required()
    @role_id_required(*_ANALYTICS_ROLE_SLUGS)
    def get(self, department_id):
        viewer = loaded_user()
        if viewer.role.role_name == Role.MANAGER and viewer_department_id(viewer) != department_id:
            return err("Department not found.", 404, "department_not_found")
        dept = db.session.get(Department, department_id)
        if not dept:
            return err("Department not found.", 404, "department_not_found")

        employee_ids = [e.employee_id for e in dept.employees]
        history: dict[str, float] = {}
        if employee_ids:
            for summary in db.session.query(UsageSummary).filter(UsageSummary.employee_id.in_(employee_ids)).all():
                history[summary.month] = round(history.get(summary.month, 0) + summary.total_cost, 2)

        stored = db.session.query(ForecastResult).filter_by(department_id=department_id).order_by(ForecastResult.generated_at.desc()).first()
        return ok(data={
            "department_id": department_id,
            "historical_monthly_spend": [{"month": m, "total_cost": c} for m, c in sorted(history.items())],
            "budget_ceiling": dept.budget_ceiling,
            "forecast": stored.to_dict() if stored else None,
        }, message=None if stored else "Prophet forecasting model not yet wired up — see ML/. Historical series only.")


class Profiles(Resource):
    """GET /analytics/profiles — usage_profile rows are real; cluster_label
    stays null per employee until the KMeans model (Design_Docs ML
    pipeline) is wired up to populate it."""

    @jwt_required()
    @role_id_required(*_ANALYTICS_ROLE_SLUGS)
    def get(self):
        viewer = loaded_user()
        query = db.session.query(Employee)
        if viewer.role.role_name == Role.MANAGER:
            query = query.filter_by(department_id=viewer_department_id(viewer))

        data = []
        for employee in query.all():
            profile = db.session.query(UsageProfile).filter_by(employee_id=employee.employee_id).first()
            data.append({
                "employee_id": employee.employee_id,
                "full_name": employee.full_name,
                "cluster_label": profile.cluster_label if profile else None,
            })
        return ok(data=data, message="KMeans clustering not yet wired up — see ML/. cluster_label is null until it runs.")


RESOURCES = [
    (Anomalies, "/analytics/anomalies"),
    (AnomalyResolve, "/analytics/anomalies/<flag_id>/resolve"),
    (Forecasts, "/forecast/<department_id>"),
    (Profiles, "/analytics/profiles"),
]
