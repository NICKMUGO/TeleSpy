"""SQLAlchemy models, matching Design_Docs/telespy_database_schema_erd.png
and Design_Docs/TeleSpy_Class_Diagram_Good.jpg table-for-table.

A few deliberate, documented departures from the raw diagrams:

- Every PK/FK in the ERD is typed "string". For business entities (User,
  Employee, SimCard, ...) that's a randomly generated UUID string — an
  opaque, non-enumerable id, which fits a system built around role-based
  access control. For `roles` specifically it's a fixed slug ("admin",
  "manager", "employee") instead, since it's a small, static reference
  set — see constants.ROLE_SLUGS for why.
- `usage_event.msisdn_pbx` (extension) and `.destination` are stored
  plain, not encrypted — the brief's "encryption of SIM cards, extensions"
  covers the SIM's *assigned* identity (SimCard.msisdn_pbx_enc below);
  encrypting every historical call record's copy of that same value would
  make the "indexes for quick search" requirement on usage_event
  impossible and adds no real confidentiality (it's already recoverable
  from the SIM record it's attributed to).
- A handful of tables (PasswordHistory, PasswordResetToken, Consent,
  TutorialProgress) don't appear in the diagrams at all — they're
  auth/security plumbing the diagrams don't model at that level of detail,
  needed for the password-bank/consent requirements. Two more auth-plumbing
  concerns that *would* otherwise live here — the JWT revocation blocklist
  and MFA OTPs — are TTL-bounded, high-frequency lookups better served by
  Redis than a SQL table; see cache.py, used from app.py.
- AuditLog and TelcoPlan/ForecastResult carry a few extra columns beyond
  what's drawn (rate_per_minute_kes, forecasted_cost, ...) — each is
  commented at the field explaining why it's there.
"""
import uuid
from datetime import datetime
from datetime import timezone as tz

from flask_bcrypt import Bcrypt
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import MetaData
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import configure_mappers, validates

bcrypt = Bcrypt()

metadata = MetaData(naming_convention={
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ix": "ix_%(table_name)s_%(column_0_name)s",
})

db = SQLAlchemy(metadata=metadata)


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    # Naive UTC, deliberately: SQLite (the default dev DB) has no real
    # timezone-aware storage — it silently drops tzinfo on write — so a
    # timezone-aware value here would come back naive on read and blow up
    # any "< _utcnow()" comparison. Keeping every stored timestamp naive
    # UTC (never local time) makes reads/writes/comparisons consistent
    # across SQLite, Postgres, and MySQL alike.
    return datetime.now(tz.utc).replace(tzinfo=None)


# ============================================================================
# role
# ============================================================================

class Role(db.Model):
    __tablename__ = "roles"

    role_id = db.Column(db.String(20), primary_key=True)  # fixed slug, see module docstring
    role_name = db.Column(db.String(32), unique=True, nullable=False)
    permissions = db.Column(db.JSON, default=list)  # list[str] of permission keys — descriptive today, not yet enforced per-action
    call_limit_kshs = db.Column(db.Float)  # monthly ceiling; NULL = no personal ceiling (e.g. Admin)

    users = db.relationship("User", back_populates="role")

    def has_permission(self, action: str) -> bool:
        return action in (self.permissions or [])

    def get_call_unit(self) -> float | None:
        return self.call_limit_kshs

    def to_dict(self) -> dict:
        return {
            "id": self.role_id,
            "role_name": self.role_name,
            "permissions": self.permissions or [],
            "call_limit_kshs": self.call_limit_kshs,
        }


# ============================================================================
# department
# ============================================================================

class Department(db.Model):
    __tablename__ = "departments"

    department_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    name = db.Column(db.String(120), unique=True, nullable=False)
    cost_centre_code = db.Column(db.String(40), unique=True)
    budget_ceiling = db.Column(db.Float)
    created_at = db.Column(db.DateTime, default=_utcnow)

    employees = db.relationship("Employee", back_populates="department")
    forecast_results = db.relationship("ForecastResult", back_populates="department")

    def get_budget_status(self, spend: float) -> str:
        if self.budget_ceiling is None:
            return "unmonitored"
        return "over_budget" if spend > self.budget_ceiling else "within_budget"

    def to_dict(self) -> dict:
        return {
            "id": self.department_id,
            "name": self.name,
            "cost_centre_code": self.cost_centre_code,
            "budget_ceiling": self.budget_ceiling,
        }


# ============================================================================
# employee  (HR/org record — NOT the login. See User below.)
# ============================================================================

class Employee(db.Model):
    __tablename__ = "employees"

    employee_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    department_id = db.Column(db.String(36), db.ForeignKey("departments.department_id"))
    # Nullable: a self-registered Employee (POST /auth/register) has no
    # staff_number/department yet — HR/Admin assigns those later via
    # PATCH /employees/<id>. Still unique whenever it IS set.
    staff_number = db.Column(db.String(32), unique=True)
    full_name = db.Column(db.String(120), nullable=False)
    created_at = db.Column(db.DateTime, default=_utcnow)

    department = db.relationship("Department", back_populates="employees")
    user = db.relationship("User", back_populates="employee", uselist=False)
    allocations = db.relationship("SimAllocation", back_populates="employee")
    usage_profile = db.relationship("UsageProfile", back_populates="employee", uselist=False)
    usage_summaries = db.relationship("UsageSummary", back_populates="employee")

    def get_active_allocation(self) -> "SimAllocation | None":
        now = _utcnow()
        return next((a for a in self.allocations if a.is_active_at(now)), None)

    def to_dict(self, *, viewer: "User | None" = None) -> dict:
        """Field-level protections the brief calls out: the assigned
        extension is decrypted only for authorized viewers, and
        total_cost_kes is stripped entirely (not nulled — omitted) unless
        the viewer is Admin, this employee's own Manager, or the employee
        themselves (private *from other employees*, not from the data
        subject — see Design_Docs use-case diagram's "View my cost")."""
        from constants import Role as RoleNames
        from security import decrypt_value

        out = {
            "id": self.employee_id,
            "staff_number": self.staff_number,
            "full_name": self.full_name,
            "department_id": self.department_id,
        }
        if self.user:
            out["email"] = self.user.email
            out["role"] = self.user.role.role_name if self.user.role else None
            out["role_id"] = self.user.role_id
            out["is_active"] = self.user.is_active

        viewer_role = viewer.role.role_name if (viewer and viewer.role) else None
        is_self = viewer is not None and viewer.employee_id == self.employee_id
        is_own_manager = viewer_role == RoleNames.MANAGER and viewer.employee and viewer.employee.department_id == self.department_id
        can_view_extension = viewer_role == RoleNames.ADMIN or is_own_manager or is_self
        can_view_cost = viewer_role == RoleNames.ADMIN or is_own_manager or is_self

        allocation = self.get_active_allocation()
        if allocation and can_view_extension:
            out["extension"] = decrypt_value(allocation.sim.msisdn_pbx_enc) if allocation.sim.msisdn_pbx_enc else None
            out["sim_id"] = allocation.sim_id

        if can_view_cost:
            current_month = _utcnow().strftime("%Y-%m")
            summary = next((s for s in self.usage_summaries if s.month == current_month), None)
            out["total_cost_kes"] = summary.total_cost if summary else 0

        return out


# ============================================================================
# user  (login identity — 1:1 with employee)
# ============================================================================

class User(db.Model):
    __tablename__ = "users"

    user_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    # Every login is tied to an HR record — Admins/Managers get an
    # Employee row too (department + staff_number), provisioned the same
    # way as any Employee; the ERD's "has account" 1:1 arrow requires it.
    employee_id = db.Column(db.String(36), db.ForeignKey("employees.employee_id"), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    _password = db.Column("password_hash", db.String(128), nullable=False)
    role_id = db.Column(db.String(20), db.ForeignKey("roles.role_id"), nullable=False)

    is_active = db.Column(db.Boolean, default=True)
    must_change_password = db.Column(db.Boolean, default=False)
    failed_login_attempts = db.Column(db.Integer, default=0)
    locked_until = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=_utcnow)
    updated_at = db.Column(db.DateTime, default=_utcnow, onupdate=_utcnow)

    employee = db.relationship("Employee", back_populates="user")
    role = db.relationship("Role", back_populates="users")
    password_history = db.relationship("PasswordHistory", back_populates="user", cascade="all, delete-orphan")
    audit_entries = db.relationship("AuditLog", back_populates="actor")

    @hybrid_property
    def password(self):
        raise AttributeError("password is write-only")

    @password.setter
    def password(self, raw_password: str):
        self._password = bcrypt.generate_password_hash(raw_password).decode("utf-8")

    def check_password(self, raw_password: str) -> bool:
        if not self._password:
            return False
        return bcrypt.check_password_hash(self._password, raw_password)

    @validates("email")
    def _lowercase_email(self, key, value):
        return value.strip().lower()

    def to_dict(self) -> dict:
        out = {
            "id": self.user_id,
            "email": self.email,
            "role": self.role.role_name if self.role else None,
            "role_id": self.role_id,
            "is_active": self.is_active,
            "must_change_password": self.must_change_password,
        }
        if self.employee:
            out.update({
                "employee_id": self.employee.employee_id,
                "full_name": self.employee.full_name,
                "staff_number": self.employee.staff_number,
                "department_id": self.employee.department_id,
            })
        return out

    def __repr__(self):
        return f"<User {self.email}>"


class PasswordHistory(db.Model):
    """The Password Bank: a hash of every password a user has set, so a
    new one can be checked against the last PASSWORD_HISTORY_LIMIT. Not in
    the design docs — auth plumbing they don't model at this detail."""

    __tablename__ = "password_history"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.user_id"), nullable=False, index=True)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=_utcnow)

    user = db.relationship("User", back_populates="password_history")


class PasswordResetToken(db.Model):
    __tablename__ = "password_reset_tokens"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.user_id"), nullable=False, index=True)
    token_hash = db.Column(db.String(64), unique=True, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    consumed = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=_utcnow)


class Consent(db.Model):
    """Kenya Data Protection Act (2019) + Terms & Conditions consent,
    captured explicitly at registration — never inferred."""

    __tablename__ = "consents"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.user_id"), nullable=False, index=True)
    accepted_terms = db.Column(db.Boolean, nullable=False)
    accepted_dpa_notice = db.Column(db.Boolean, nullable=False)
    dpa_policy_version = db.Column(db.String(20), nullable=False)
    created_at = db.Column(db.DateTime, default=_utcnow)


class TutorialProgress(db.Model):
    __tablename__ = "tutorial_progress"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey("users.user_id"), unique=True, nullable=False)
    completed_step_ids = db.Column(db.JSON, default=list)
    dismissed = db.Column(db.Boolean, default=False)
    updated_at = db.Column(db.DateTime, default=_utcnow, onupdate=_utcnow)


# ============================================================================
# telco_plan
# ============================================================================

class TelcoPlan(db.Model):
    __tablename__ = "telco_plans"

    plan_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    name = db.Column(db.String(80), unique=True, nullable=False)
    provider = db.Column(db.String(60))
    # Self-referential per the class diagram's "+FK plan_id" on TELCO_PLAN
    # itself — models a plan being superseded by a successor plan.
    plan_id_ref = db.Column(db.String(36), db.ForeignKey("telco_plans.plan_id"))
    lifecycle_state = db.Column(db.String(20), default="active")
    # The diagram draws calculateCost(event)/getRateCard() as methods but
    # not their backing data — a plan needs an actual rate to calculate
    # anything, so this is the minimal field that backs them.
    rate_per_minute_kes = db.Column(db.Float)

    sims = db.relationship("SimCard", back_populates="plan", foreign_keys="SimCard.plan_id")

    def calculate_cost(self, duration_minutes: float) -> float:
        from constants import EXTERNAL_CALL_RATE_KES_PER_MINUTE
        rate = self.rate_per_minute_kes if self.rate_per_minute_kes is not None else EXTERNAL_CALL_RATE_KES_PER_MINUTE
        return round(duration_minutes * rate, 2)

    def get_rate_card(self) -> dict:
        return {"rate_per_minute_kes": self.rate_per_minute_kes}

    def to_dict(self) -> dict:
        return {
            "id": self.plan_id,
            "name": self.name,
            "provider": self.provider,
            "plan_id_ref": self.plan_id_ref,
            "lifecycle_state": self.lifecycle_state,
            "rate_per_minute_kes": self.rate_per_minute_kes,
        }


# ============================================================================
# sim_card
# ============================================================================

class SimCard(db.Model):
    """ICCID/MSISDN/extension are encrypted at rest, with blind-index
    fingerprints for uniqueness checks and lookups (see security.py)."""

    __tablename__ = "sim_cards"

    sim_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    iccid_enc = db.Column(db.String(255), nullable=False)
    iccid_hash = db.Column(db.String(64), unique=True, nullable=False)
    msisdn_enc = db.Column(db.String(255), nullable=False)  # the SIM's own subscriber number
    msisdn_hash = db.Column(db.String(64), unique=True, nullable=False)
    provider = db.Column(db.String(60))
    plan_id = db.Column(db.String(36), db.ForeignKey("telco_plans.plan_id"))
    lifecycle_state = db.Column(db.String(20), default="active")  # active | suspended | decommissioned
    # msisdn_pbx: the internal PBX extension this SIM answers to — this is
    # the "extension" the brief asks to encrypt. It lives on the SIM (a
    # fixed property of the physical line), not the employee; who
    # currently holds it is tracked by SimAllocation below.
    msisdn_pbx_enc = db.Column(db.String(255))
    msisdn_pbx_hash = db.Column(db.String(64), unique=True, index=True)
    created_at = db.Column(db.DateTime, default=_utcnow)
    updated_at = db.Column(db.DateTime, default=_utcnow, onupdate=_utcnow)

    plan = db.relationship("TelcoPlan", back_populates="sims", foreign_keys=[plan_id])
    allocations = db.relationship("SimAllocation", back_populates="sim")

    def get_current_allocation(self) -> "SimAllocation | None":
        now = _utcnow()
        return next((a for a in self.allocations if a.is_active_at(now)), None)

    def is_available_for_allocation(self) -> bool:
        return self.lifecycle_state == "active" and self.get_current_allocation() is None

    def to_dict(self, *, viewer: "User") -> dict:
        from constants import Role as RoleNames
        from security import decrypt_value

        current = self.get_current_allocation()
        out = {
            "id": self.sim_id,
            "provider": self.provider,
            "plan_id": self.plan_id,
            "lifecycle_state": self.lifecycle_state,
            "employee_id": current.employee_id if current else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if viewer.role and viewer.role.role_name == RoleNames.ADMIN:
            out["iccid"] = decrypt_value(self.iccid_enc)
            out["msisdn"] = decrypt_value(self.msisdn_enc)
            out["extension"] = decrypt_value(self.msisdn_pbx_enc) if self.msisdn_pbx_enc else None
        else:
            msisdn = decrypt_value(self.msisdn_enc) or ""
            out["msisdn_masked"] = ("*" * max(0, len(msisdn) - 4) + msisdn[-4:]) if len(msisdn) >= 4 else "****"
        return out


# ============================================================================
# sim_allocation  (the employee <-> SIM/extension mapping, time-bounded)
# ============================================================================

class SimAllocation(db.Model):
    __tablename__ = "sim_allocations"

    allocation_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    sim_id = db.Column(db.String(36), db.ForeignKey("sim_cards.sim_id"), nullable=False)
    employee_id = db.Column(db.String(36), db.ForeignKey("employees.employee_id"), nullable=False)
    start_at = db.Column(db.DateTime, nullable=False, default=_utcnow)
    end_at = db.Column(db.DateTime)  # NULL = currently active

    sim = db.relationship("SimCard", back_populates="allocations")
    employee = db.relationship("Employee", back_populates="allocations")
    usage_events = db.relationship("UsageEvent", back_populates="allocation")

    def is_active_at(self, timestamp: datetime) -> bool:
        return self.start_at <= timestamp and (self.end_at is None or timestamp < self.end_at)

    def close_allocation(self, end_at: datetime | None = None):
        self.end_at = end_at or _utcnow()

    def to_dict(self) -> dict:
        return {
            "id": self.allocation_id,
            "sim_id": self.sim_id,
            "employee_id": self.employee_id,
            "start_at": self.start_at.isoformat() if self.start_at else None,
            "end_at": self.end_at.isoformat() if self.end_at else None,
        }


# ============================================================================
# usage_event  (one CDR row)
# ============================================================================

class UsageEvent(db.Model):
    __tablename__ = "usage_events"

    event_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    # Nullable: an event whose msisdn_pbx doesn't match any known SIM at
    # the time of the call is stored anyway, just unattributed — see
    # attribution_state / flag_as_unattributed().
    allocation_id = db.Column(db.String(36), db.ForeignKey("sim_allocations.allocation_id"), index=True)
    msisdn_pbx = db.Column(db.String(20), nullable=False, index=True)  # the internal extension side of the call
    destination = db.Column(db.String(20), nullable=False)
    occured_at = db.Column(db.DateTime, nullable=False, index=True)
    duration_minutes = db.Column(db.Float, nullable=False)
    computed_cost = db.Column(db.Float, default=0)
    attribution_state = db.Column(db.String(20), default="unattributed")  # attributed | unattributed
    # Not in the ERD, but required to implement the brief's classification
    # + 256/400 anomaly carve-out rule without re-deriving it on every read.
    call_classification = db.Column(db.String(20), index=True)  # Internal | External | Unknown
    excluded_from_anomaly_detection = db.Column(db.Boolean, default=False)
    source_file = db.Column(db.String(255))
    ingested_at = db.Column(db.DateTime, default=_utcnow)

    allocation = db.relationship("SimAllocation", back_populates="usage_events")
    anomaly_flag = db.relationship("AnomalyFlag", back_populates="event", uselist=False)

    def attribute_to_allocation(self, allocation: "SimAllocation | None"):
        self.allocation_id = allocation.allocation_id if allocation else None
        self.attribution_state = "attributed" if allocation else "unattributed"

    def flag_as_unattributed(self):
        self.allocation_id = None
        self.attribution_state = "unattributed"

    def compute_cost(self, plan: "TelcoPlan | None" = None) -> float:
        from constants import CALL_CLASS_EXTERNAL, EXTERNAL_CALL_RATE_KES_PER_MINUTE
        if self.call_classification != CALL_CLASS_EXTERNAL:
            self.computed_cost = 0.0
        elif plan is not None:
            self.computed_cost = plan.calculate_cost(self.duration_minutes)
        else:
            self.computed_cost = round(self.duration_minutes * EXTERNAL_CALL_RATE_KES_PER_MINUTE, 2)
        return self.computed_cost

    def to_dict(self) -> dict:
        return {
            "id": self.event_id,
            "allocation_id": self.allocation_id,
            "msisdn_pbx": self.msisdn_pbx,
            "destination": self.destination,
            "occured_at": self.occured_at.isoformat() if self.occured_at else None,
            "duration_minutes": self.duration_minutes,
            "computed_cost": self.computed_cost,
            "attribution_state": self.attribution_state,
            "call_classification": self.call_classification,
            "excluded_from_anomaly_detection": self.excluded_from_anomaly_detection,
        }


# ============================================================================
# anomaly_flag
# ============================================================================

class AnomalyFlag(db.Model):
    """Persisted per usage_event at ingestion time (see app.py's CdrIngest),
    matching the sequence diagram: scoring happens during ingest, not
    on-demand at GET /analytics/anomalies time. `score()` is the seam an
    Isolation Forest model swaps into later — see analytics comments in
    app.py."""

    __tablename__ = "anomaly_flags"

    flag_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    event_id = db.Column(db.String(36), db.ForeignKey("usage_events.event_id"), unique=True, nullable=False)
    anomaly_score = db.Column(db.Float, nullable=False)
    contributing_features = db.Column(db.JSON, default=dict)
    created_at = db.Column(db.DateTime, default=_utcnow)
    # Backs the use-case diagram's "Resolve anomaly flag" (Admin only,
    # extends "Review anomaly flag") — not in the ERD's column list, but
    # a flag with no way to close it out isn't reviewable in practice.
    resolved_at = db.Column(db.DateTime)
    resolved_by_user_id = db.Column(db.String(36), db.ForeignKey("users.user_id"))

    event = db.relationship("UsageEvent", back_populates="anomaly_flag")

    def get_contributing_features(self) -> dict:
        return self.contributing_features or {}

    def to_dict(self) -> dict:
        return {
            "id": self.flag_id,
            "event_id": self.event_id,
            "anomaly_score": self.anomaly_score,
            "contributing_features": self.contributing_features or {},
            "resolved": self.resolved_at is not None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
        }


# ============================================================================
# usage_profile  (KMeans cluster per employee)
# ============================================================================

class UsageProfile(db.Model):
    __tablename__ = "usage_profiles"

    profile_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    employee_id = db.Column(db.String(36), db.ForeignKey("employees.employee_id"), unique=True, nullable=False)
    cluster_label = db.Column(db.String(40))  # NULL until the KMeans model is wired up
    updated_at = db.Column(db.DateTime, default=_utcnow, onupdate=_utcnow)

    employee = db.relationship("Employee", back_populates="usage_profile")

    def to_dict(self) -> dict:
        return {"id": self.profile_id, "employee_id": self.employee_id, "cluster_label": self.cluster_label}


# ============================================================================
# usage_summary  (per employee, per month — the source of "Total Cost per
# Employee" and what cost-ceiling checks compare against)
# ============================================================================

class UsageSummary(db.Model):
    __tablename__ = "usage_summaries"
    __table_args__ = (db.UniqueConstraint("employee_id", "month", name="uq_usage_summaries_employee_month"),)

    summary_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    employee_id = db.Column(db.String(36), db.ForeignKey("employees.employee_id"), nullable=False)
    month = db.Column(db.String(7), nullable=False)  # "YYYY-MM"
    total_cost = db.Column(db.Float, default=0)
    updated_at = db.Column(db.DateTime, default=_utcnow, onupdate=_utcnow)

    employee = db.relationship("Employee", back_populates="usage_summaries")

    def check_threshold_breach(self, limit_kshs: float | None) -> bool:
        return limit_kshs is not None and self.total_cost > limit_kshs

    def to_dict(self) -> dict:
        return {
            "id": self.summary_id,
            "employee_id": self.employee_id,
            "month": self.month,
            "total_cost": self.total_cost,
        }


# ============================================================================
# forecast_result  (Prophet output per department/period)
# ============================================================================

class ForecastResult(db.Model):
    __tablename__ = "forecast_results"

    forecast_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    department_id = db.Column(db.String(36), db.ForeignKey("departments.department_id"), nullable=False)
    period = db.Column(db.String(20), nullable=False)  # e.g. "2026-10"
    # Not in the visible diagram fields, but a forecast without a
    # predicted value is meaningless — the minimal fields the class
    # diagram's generateForecast(period) needs to produce.
    forecasted_cost = db.Column(db.Float)
    confidence_low = db.Column(db.Float)
    confidence_high = db.Column(db.Float)
    generated_at = db.Column(db.DateTime, default=_utcnow)

    department = db.relationship("Department", back_populates="forecast_results")

    def to_dict(self) -> dict:
        return {
            "id": self.forecast_id,
            "department_id": self.department_id,
            "period": self.period,
            "forecasted_cost": self.forecasted_cost,
            "confidence_low": self.confidence_low,
            "confidence_high": self.confidence_high,
        }


# ============================================================================
# audit_log
# ============================================================================

class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    audit_id = db.Column(db.String(36), primary_key=True, default=_uuid)
    actor_user_id = db.Column(db.String(36), db.ForeignKey("users.user_id"))
    action = db.Column(db.String(60), nullable=False)
    occured_at = db.Column(db.DateTime, default=_utcnow, index=True)
    # Extra columns beyond the ERD's 4, kept for a genuinely useful trail:
    actor_role = db.Column(db.String(32))
    resource = db.Column(db.String(60))
    resource_id = db.Column(db.String(60))
    meta = db.Column(db.JSON, default=dict)

    actor = db.relationship("User", back_populates="audit_entries")

    def to_dict(self) -> dict:
        return {
            "id": self.audit_id,
            "actor_user_id": self.actor_user_id,
            "actor_role": self.actor_role,
            "action": self.action,
            "resource": self.resource,
            "resource_id": self.resource_id,
            "meta": self.meta or {},
            "occured_at": self.occured_at.isoformat() if self.occured_at else None,
        }


configure_mappers()
