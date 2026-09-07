"""Rule-based anomaly scoring - the seam a trained Isolation Forest model
(Design_Docs ML pipeline) swaps into later without changing how
AnomalyFlag rows are created or read.

Today it flags an event only when the employee's running monthly total has
breached their role's cost ceiling; everything else is left unflagged
rather than filling the table with all-zero rows.
"""
from models.models import AnomalyFlag, db


def score_usage_event(event, summary, limit_kshs) -> bool:
    """Score `event` against the running monthly `summary`; persist an
    AnomalyFlag (staged on the session, not committed) when the ceiling is
    breached. Returns True iff a flag was staged."""
    if event.excluded_from_anomaly_detection or summary is None or limit_kshs is None:
        return False
    if summary.total_cost <= limit_kshs:
        return False
    overage = summary.total_cost - limit_kshs
    score = min(1.0, overage / limit_kshs)
    db.session.add(AnomalyFlag(
        event_id=event.event_id,
        anomaly_score=round(score, 4),
        contributing_features={
            "reason": "cost_ceiling_exceeded",
            "monthly_total": summary.total_cost,
            "limit_kshs": limit_kshs,
            "overage_kshs": round(overage, 2),
        },
    ))
    return True
