"""CDR ingestion + the operational usage list.

Ingestion is where each raw call row is classified, attributed to the SIM
allocation active at call time, costed (via services/billing.py), rolled
into the employee's monthly summary, and scored for anomalies.
"""
from datetime import datetime

from flask import request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from core.responses import ok, paginate_args, paginate_meta
from core.time import utcnow
from models.models import Employee, SimAllocation, SimCard, UsageEvent, UsageSummary, db
from security import blind_index
from services.anomaly import score_usage_event
from services.audit import record_audit
from services.billing import compute_event_cost
from services.call_classification import classify_call, is_excluded_from_anomaly_detection

from api.common import loaded_user, viewer_department_id


class CdrIngest(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def post(self):
        actor = loaded_user()
        data = request.get_json(silent=True) or {}
        records = data.get("records") or []
        source_file = data.get("source_file")

        ingested = attributed = unattributed = anomalies_flagged = 0

        for row in records:
            orig, dest = row.get("orig", ""), row.get("dest", "")
            duration_sec = int(row.get("duration_sec", 0))
            duration_minutes = duration_sec / 60.0
            call_classification = classify_call(orig, dest)
            excluded = is_excluded_from_anomaly_detection(orig, dest, call_classification)
            try:
                occured_at = datetime.strptime(f"{row.get('date')} {row.get('orig_time')}", "%Y-%m-%d %H:%M:%S")
            except (ValueError, TypeError):
                occured_at = utcnow()

            # Resolve MSISDN (the CDR's own extension, `orig`) to the SIM
            # allocation that was active at the time of the call.
            sim = db.session.query(SimCard).filter_by(msisdn_pbx_hash=blind_index(orig)).first()
            allocation = None
            if sim:
                allocation = next((a for a in sim.allocations if a.is_active_at(occured_at)), None)

            event = UsageEvent(
                msisdn_pbx=orig, destination=dest, occured_at=occured_at, duration_minutes=duration_minutes,
                call_classification=call_classification, excluded_from_anomaly_detection=excluded,
                source_file=source_file, ingested_at=utcnow(),
            )
            event.attribute_to_allocation(allocation)
            # Cost is decided in one place (services/billing.py): Internal /
            # Unknown calls are always 0 even if the CDR row carries a
            # `charge`; External / International calls use that charge when
            # present, else duration * plan rate.
            event.computed_cost = compute_event_cost(
                call_classification,
                duration_minutes,
                plan=allocation.sim.plan if allocation else None,
                provided_charge=row.get("charge"),
            )

            db.session.add(event)
            db.session.flush()
            ingested += 1

            summary = None
            if allocation:
                attributed += 1
                month = (row.get("date") or occured_at.strftime("%Y-%m-%d"))[:7]
                summary = db.session.query(UsageSummary).filter_by(employee_id=allocation.employee_id, month=month).first()
                if not summary:
                    summary = UsageSummary(employee_id=allocation.employee_id, month=month, total_cost=0)
                    db.session.add(summary)
                summary.total_cost = round((summary.total_cost or 0) + event.computed_cost, 2)
                db.session.flush()

                limit_kshs = allocation.employee.user.role.call_limit_kshs if allocation.employee.user and allocation.employee.user.role else None
                if score_usage_event(event, summary, limit_kshs):
                    anomalies_flagged += 1
            else:
                unattributed += 1

        db.session.commit()
        record_audit("cdr_ingested", "usage_event", actor_id=actor.user_id, actor_role=actor.role.role_name,
                     meta={"ingested": ingested, "attributed": attributed, "unattributed": unattributed, "source_file": source_file})
        return ok(
            data={"ingested": ingested, "attributed": attributed, "unattributed": unattributed, "anomalies_flagged": anomalies_flagged},
            message="CDR batch ingested.", status=201,
        )


class Usage(Resource):
    """Operational list view for Admin/Manager — not in the diagrams, but
    a reasonable addition alongside the self-service GET /me/usage."""

    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN], ROLE_SLUGS[Role.MANAGER])
    def get(self):
        viewer = loaded_user()
        page, limit = paginate_args()
        query = db.session.query(UsageEvent)

        if request.args.get("classification"):
            query = query.filter_by(call_classification=request.args["classification"])
        if request.args.get("extension"):
            ext = request.args["extension"]
            query = query.filter((UsageEvent.msisdn_pbx == ext) | (UsageEvent.destination == ext))

        if viewer.role.role_name == Role.MANAGER:
            allocation_ids = (
                db.session.query(SimAllocation.allocation_id)
                .join(Employee, SimAllocation.employee_id == Employee.employee_id)
                .filter(Employee.department_id == viewer_department_id(viewer))
            )
            # .in_(<empty subquery>) correctly matches zero rows.
            query = query.filter(UsageEvent.allocation_id.in_(allocation_ids))

        total = query.count()
        rows = query.order_by(UsageEvent.occured_at.desc()).offset((page - 1) * limit).limit(limit).all()
        return ok(data=[r.to_dict() for r in rows], meta=paginate_meta(page, limit, total))


RESOURCES = [
    (CdrIngest, "/cdr/ingest"),
    (Usage, "/usage"),
]
