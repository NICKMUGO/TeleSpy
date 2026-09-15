"""Analytics reads: anomaly flags (+ resolve), department spend forecast,
and usage profiles — see Design_Docs/MachineLearningDesignTeleSpy*.jpeg and
ML/training/. The Isolation Forest / KMeans / forecasting batch jobs behind
these tables are no longer run in-process by either backend: they live as
the shared Jupyter notebooks under ML/training/ (ml_models.ipynb +
run_ml.ipynb), which write straight to this database's anomaly_flags,
usage_profiles, and forecast_results tables since both backends share the
same schema. Forecast/profile/anomaly rows stay null/absent for data a
model hasn't scored yet, until ML/training/run_ml.ipynb is next run.
"""
from datetime import datetime, timezone

from flask import jsonify, make_response, request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from core.time import utcnow
from models.models import AnomalyFlag, Department, Employee, ForecastResult, UsageEvent, UsageProfile, UsageSummary, db
from services.audit import record_audit

from api.common import loaded_user, viewer_department_id

_ANALYTICS_ROLE_SLUGS = [ROLE_SLUGS[Role.ADMIN], ROLE_SLUGS[Role.MANAGER]]


class Anomalies(Resource):
    """Reads AnomalyFlag rows written by Isolation Forest
    (ML/training/anomaly_detection.py) rather than computing anything ad
    hoc. Employee is intentionally excluded: this surfaces
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
        return make_response(jsonify({"data": data}), 200)


class AnomalyResolve(Resource):
    """Admin-only "Resolve anomaly flag" (extends "Review anomaly flag")."""

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self, flag_id):
        actor = loaded_user()
        flag = db.session.get(AnomalyFlag, flag_id)
        if not flag:
            return make_response(jsonify({
                "error_type": "flag_not_found",
                "message": "Anomaly flag not found.",
                "field": "flag_id",
                "hint": f"No anomaly flag exists with id {flag_id!r}.",
                "status": 404,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 404)
        flag.resolved_at = utcnow()
        flag.resolved_by_user_id = actor.user_id
        db.session.commit()
        record_audit("anomaly_resolved", "anomaly_flag", flag.flag_id)
        return make_response(jsonify({
            "data": flag.to_dict(),
            "message": "Anomaly flag resolved.",
        }), 200)


class Forecasts(Resource):
    """GET /forecast/<department_id> — the real historical monthly-spend
    series, plus the latest stored forecast (ML/training/ml_models.ipynb),
    per Design_Docs/MachineLearningDesignTeleSpy2.jpeg. `forecast` is null
    until ML/training/run_ml.ipynb has run at least once for this
    department (e.g. a brand-new department with no UsageSummary history
    yet)."""

    @jwt_required()
    @role_id_required(*_ANALYTICS_ROLE_SLUGS)
    def get(self, department_id):
        viewer = loaded_user()
        if viewer.role.role_name == Role.MANAGER and viewer_department_id(viewer) != department_id:
            return make_response(jsonify({
                "error_type": "department_not_found",
                "message": "Department not found.",
                "field": "department_id",
                "hint": "Managers can only view the forecast for their own department.",
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

        employee_ids = [e.employee_id for e in dept.employees]
        history: dict[str, float] = {}
        if employee_ids:
            for summary in db.session.query(UsageSummary).filter(UsageSummary.employee_id.in_(employee_ids)).all():
                history[summary.month] = round(history.get(summary.month, 0) + summary.total_cost, 2)

        stored = db.session.query(ForecastResult).filter_by(department_id=department_id).order_by(ForecastResult.generated_at.desc()).first()
        body = {"data": {
            "department_id": department_id,
            "historical_monthly_spend": [{"month": m, "total_cost": c} for m, c in sorted(history.items())],
            "budget_ceiling": dept.budget_ceiling,
            "forecast": stored.to_dict() if stored else None,
        }}
        if not stored:
            body["message"] = "No forecast yet for this department — run ML/training/run_ml.ipynb. Historical series only."
        return make_response(jsonify(body), 200)


class Profiles(Resource):
    """GET /analytics/profiles — usage_profile rows, clustered by calling
    behavior via KMeans (ML/training/ml_models.ipynb). cluster_label is
    null for an employee with no usage history yet, or before
    ML/training/run_ml.ipynb has ever run."""

    @jwt_required()
    @role_id_required(*_ANALYTICS_ROLE_SLUGS)
    def get(self):
        viewer = loaded_user()
        query = db.session.query(Employee)
        if viewer.role.role_name == Role.MANAGER:
            query = query.filter_by(department_id=viewer_department_id(viewer))

        data = []
        any_labeled = False
        for employee in query.all():
            profile = db.session.query(UsageProfile).filter_by(employee_id=employee.employee_id).first()
            cluster_label = profile.cluster_label if profile else None
            any_labeled = any_labeled or cluster_label is not None
            data.append({
                "employee_id": employee.employee_id,
                "full_name": employee.full_name,
                "cluster_label": cluster_label,
            })
        body = {"data": data}
        if not any_labeled:
            body["message"] = "No usage profiles yet — run ML/training/run_ml.ipynb. cluster_label is null until then."
        return make_response(jsonify(body), 200)


class UsageSummaries(Resource):
    """GET /analytics/usage-summary — every usage_summaries row (employee
    name + extension_code + month + total_cost + everything else on the
    row), filled in by ML/training/billing.py rather than computed here.
    Sorted by total_cost descending, so the biggest spenders surface
    first; optionally narrowed to one month with ?month=YYYY-MM."""

    @jwt_required()
    @role_id_required(*_ANALYTICS_ROLE_SLUGS)
    def get(self):
        viewer = loaded_user()
        query = db.session.query(UsageSummary).join(Employee)
        if viewer.role.role_name == Role.MANAGER:
            query = query.filter(Employee.department_id == viewer_department_id(viewer))
        if request.args.get("month"):
            query = query.filter(UsageSummary.month == request.args["month"])

        data = []
        for summary in query.order_by(UsageSummary.total_cost.desc()).all():
            entry = summary.to_dict()
            entry["full_name"] = summary.employee.full_name
            data.append(entry)
        return make_response(jsonify({"data": data}), 200)


RESOURCES = [
    (Anomalies, "/analytics/anomalies"),
    (AnomalyResolve, "/analytics/anomalies/<flag_id>/resolve"),
    (Forecasts, "/forecast/<department_id>"),
    (Profiles, "/analytics/profiles"),
    (UsageSummaries, "/analytics/usage-summary"),
]
