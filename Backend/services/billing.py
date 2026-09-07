"""Call-cost computation - the single source of truth for turning a
classified usage event into a KES figure.

Rules:

- Internal / Unknown calls are never charged, even if the CDR row carried
  a `charge` column (internal-cluster traffic is not billed at all).
- External (Kenyan) and International calls are chargeable: the
  telco-provided charge is used when present, otherwise
  duration * plan rate, falling back to
  EXTERNAL_CALL_RATE_KES_PER_MINUTE when the event isn't attributed to a
  plan.

This supersedes UsageEvent.compute_cost() / TelcoPlan.calculate_cost() as
the path CDR ingestion uses; those model methods are left untouched (the
DB layer is unchanged) but are no longer on the ingestion hot path.
"""
from constants import CHARGEABLE_CALL_CLASSES, EXTERNAL_CALL_RATE_KES_PER_MINUTE


def is_chargeable(call_classification: str) -> bool:
    return call_classification in CHARGEABLE_CALL_CLASSES


def rate_per_minute(plan=None) -> float:
    """The plan's own per-minute rate, or the flat fallback when there is
    no plan (or the plan doesn't set one)."""
    if plan is not None and getattr(plan, "rate_per_minute_kes", None) is not None:
        return plan.rate_per_minute_kes
    return EXTERNAL_CALL_RATE_KES_PER_MINUTE


def compute_event_cost(call_classification, duration_minutes, plan=None, provided_charge=None) -> float:
    """Authoritative cost for one CDR row, in KES (rounded to 2dp)."""
    if not is_chargeable(call_classification):
        return 0.0
    if provided_charge is not None:
        return round(float(provided_charge), 2)
    return round(float(duration_minutes) * rate_per_minute(plan), 2)
