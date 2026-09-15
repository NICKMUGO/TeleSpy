"""Seed data for local development / demos — realistic-looking but entirely
fake records, generated with Faker. Never point this at a real environment.

Creates: departments, telco plans, an Admin account, one Manager per
department, several Employees per department, a SIM card + allocation for
every Manager/Employee, and a few months of CDR-shaped usage history (run
through the same classify/cost/anomaly-score functions the real CDR
ingestion endpoint uses, so seeded data obeys the same business rules real
traffic would).

Idempotent: skips entirely if any Department already exists, so re-running
this after real data has accumulated is a no-op rather than a
duplicate-data hazard.

Run with:
    python seed.py
"""
import random

from faker import Faker

from app import app
from constants import ROLE_SLUGS, Role
from core.time import utcnow
from models.models import (
    Department,
    Employee,
    PasswordHistory,
    SimAllocation,
    SimCard,
    TelcoPlan,
    UsageEvent,
    UsageSummary,
    User,
    db,
)
from security import blind_index, encrypt_value
from services.audit import record_audit
from services.call_classification import classify_call, is_excluded_from_anomaly_detection

SEED = 20260912
fake = Faker()
Faker.seed(SEED)
random.seed(SEED)

# Every seeded account uses one of these two passwords, so the demo has
# known, working credentials out of the box (must_change_password=False).
ADMIN_EMAIL = "admin@telespy.local"
ADMIN_PASSWORD = "Admin@12345!"
DEMO_PASSWORD = "Passw0rd@1"

DEPARTMENTS = [
    ("Engineering", "ENG", 250_000.0),
    ("Sales", "SLS", 180_000.0),
    ("Finance", "FIN", 90_000.0),
    ("Human Resources", "HR", 60_000.0),
    ("Operations", "OPS", 120_000.0),
]
TELCO_PLANS = [
    ("Safaricom Corporate 500", "Safaricom", 4.5),
    ("Airtel Business Flex", "Airtel", 4.0),
    ("Telkom Enterprise", "Telkom", 5.5),
]
EMPLOYEES_PER_DEPARTMENT = 4
MONTHS_OF_HISTORY = 3
EVENTS_PER_EMPLOYEE_PER_MONTH = 12
# A few real country codes from constants.INTERNATIONAL_COUNTRY_CODE_ZONES,
# used to generate a realistic slice of international traffic.
INTERNATIONAL_SAMPLE_CODES = ["44", "1", "971", "256"]

# employees.extension_code values, drawn from the 3-digit codes that
# actually appear as a call's origin in the real CDR dataset
# (ML/data/processed/cdr_preprocessed.csv) with billable (External /
# International) traffic — so ML/training/billing.py's per-employee cost
# rollup has real data to attribute to seeded employees out of the box,
# rather than every seeded extension_code missing the dataset entirely.
KNOWN_BILLABLE_EXTENSIONS = [
    "201", "206", "222", "225", "228", "229", "264", "277", "288", "292",
    "298", "313", "332", "335", "345", "347", "351", "352", "355", "356",
    "364", "365", "366", "367", "368", "369", "372", "376", "379", "382",
    "383", "384", "389", "391", "393", "419", "424", "425", "427", "431",
    "433", "435", "436", "437",
]


def _make_sim(index: int) -> SimCard:
    iccid = f"8925{index:015d}"  # deterministic, guaranteed-unique 19-digit ICCID
    msisdn = fake.numerify("07########")
    extension = f"{100 + index:03d}"
    return SimCard(
        iccid_enc=encrypt_value(iccid), iccid_hash=blind_index(iccid),
        msisdn_enc=encrypt_value(msisdn), msisdn_hash=blind_index(msisdn),
        msisdn_pbx_enc=encrypt_value(extension), msisdn_pbx_hash=blind_index(extension),
        provider=random.choice(["Safaricom", "Airtel", "Telkom"]),
        lifecycle_state="active",
    )


def _make_user(employee: Employee, email: str, role: str, password: str) -> User:
    user = User(
        employee_id=employee.employee_id, email=email, role_id=ROLE_SLUGS[role],
        is_active=True, must_change_password=False,
    )
    user.password = password
    db.session.add(user)
    db.session.flush()
    db.session.add(PasswordHistory(user_id=user.user_id, password_hash=user._password, created_at=utcnow()))
    return user


def _random_destination(other_extensions: list[str], own_extension: str, intl_chance: float) -> str:
    """Weighted mix of internal/external/international destinations, mirroring
    a realistic office calling pattern for classify_call() to work with. At
    up to 300 KES/minute (INTL_ZONE_SATELLITE) a single long international
    call can dwarf an entire monthly ceiling, so `intl_chance` is kept low
    for most employees — see `_seed_usage_for`'s heavy-caller minority,
    which is where most breached ceilings should come from."""
    roll = random.random()
    if roll < 1 - intl_chance - 0.40 and other_extensions:
        candidates = [e for e in other_extensions if e != own_extension] or other_extensions
        return random.choice(candidates)
    if roll < 1 - intl_chance:
        return "9" + fake.numerify("##########")  # Kenyan external, 10 digits after the 9
    code = random.choice(INTERNATIONAL_SAMPLE_CODES)
    return f"+{code}{fake.numerify('#######')}"


def _add_months(anchor, months: int):
    """Shift `anchor` (a day-1 datetime) by `months` (may be negative)."""
    year, month = anchor.year, anchor.month + months
    while month < 1:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    return anchor.replace(year=year, month=month)


def _seed_usage_for(employee: Employee, allocation: SimAllocation, extension: str, all_extensions: list[str], heavy: bool):
    now = utcnow()
    # ~15% of employees are "heavy callers" (more calls, more international)
    # — the deliberate minority whose monthly total is meant to actually
    # breach their role's cost ceiling, so /budgets/over-limit and
    # /analytics/anomalies have a realistic few-not-most story to tell.
    event_count = int(EVENTS_PER_EMPLOYEE_PER_MONTH * (2.2 if heavy else 1))
    intl_chance = 0.18 if heavy else 0.04

    # Costing (computed_cost) and usage_summaries are no longer produced
    # here, or at real CDR ingestion time — see
    # ML/training/billing.py, the sole place a KES figure now gets
    # attached to usage, computed straight from the CDR dataset rather
    # than from these seeded events. Run `python ML/training/billing.py`
    # after seeding to populate initial usage_summaries / cost figures.
    for month_offset in range(MONTHS_OF_HISTORY - 1, -1, -1):
        month_anchor = _add_months(now.replace(day=1), -month_offset)
        month_end = _add_months(month_anchor, 1)

        for _ in range(event_count):
            dest = _random_destination(all_extensions, extension, intl_chance)
            call_classification = classify_call(extension, dest)
            excluded = is_excluded_from_anomaly_detection(extension, dest, call_classification)
            occured_at = fake.date_time_between(start_date=month_anchor, end_date=month_end)
            # International calls are capped much shorter than local ones —
            # a long satellite/premium-zone call is expensive per minute
            # (see INTERNATIONAL_ZONE_RATE_KES_PER_MINUTE), so keeping these
            # brief avoids a single call dominating the whole month's cost.
            duration_minutes = round(
                random.uniform(0.5, 5.0) if call_classification == "International" else random.uniform(0.5, 20.0), 2,
            )

            event = UsageEvent(
                allocation_id=allocation.allocation_id, msisdn_pbx=extension, destination=dest,
                occured_at=occured_at, duration_minutes=duration_minutes,
                call_classification=call_classification, excluded_from_anomaly_detection=excluded,
                attribution_state="attributed", source_file="seed.py", ingested_at=utcnow(),
            )
            db.session.add(event)
            db.session.flush()


def run():
    with app.app_context():
        if db.session.query(Department).first():
            print("Seed data already present (a Department row exists) — skipping.")
            return

        departments = {}
        for name, code, budget in DEPARTMENTS:
            dept = Department(name=name, cost_centre_code=code, budget_ceiling=budget)
            db.session.add(dept)
            departments[code] = dept
        db.session.flush()

        plans = []
        for name, provider, rate in TELCO_PLANS:
            plan = TelcoPlan(name=name, provider=provider, rate_per_minute_kes=rate, lifecycle_state="active")
            db.session.add(plan)
            plans.append(plan)
        db.session.flush()

        # --- Admin (no department, no SIM — matches how ensure_default_roles
        # treats Admin as having no personal cost ceiling either). ----------
        admin_employee = Employee(full_name="System Administrator", staff_number="ADM-0001")
        db.session.add(admin_employee)
        db.session.flush()
        _make_user(admin_employee, ADMIN_EMAIL, Role.ADMIN, ADMIN_PASSWORD)

        sim_index = 0
        roster = []  # (employee, allocation, extension) for usage generation

        for code, dept in departments.items():
            # One Manager per department.
            manager_employee = Employee(
                department_id=dept.department_id, full_name=fake.name(), staff_number=f"{code}-MGR-01",
                extension_code=KNOWN_BILLABLE_EXTENSIONS[sim_index],
            )
            db.session.add(manager_employee)
            db.session.flush()
            manager_user = _make_user(
                manager_employee, f"{code.lower()}.manager@telespy.local", Role.MANAGER, DEMO_PASSWORD,
            )
            manager_employee.user = manager_user

            sim = _make_sim(sim_index)
            sim.plan_id = random.choice(plans).plan_id
            db.session.add(sim)
            db.session.flush()
            allocation = SimAllocation(sim_id=sim.sim_id, employee_id=manager_employee.employee_id, start_at=utcnow())
            db.session.add(allocation)
            db.session.flush()
            allocation.sim = sim
            roster.append((manager_employee, allocation, f"{100 + sim_index:03d}", random.random() < 0.15))
            sim_index += 1

            # A handful of Employees per department.
            for i in range(1, EMPLOYEES_PER_DEPARTMENT + 1):
                employee = Employee(
                    department_id=dept.department_id, full_name=fake.name(), staff_number=f"{code}-{i:03d}",
                    extension_code=KNOWN_BILLABLE_EXTENSIONS[sim_index],
                )
                db.session.add(employee)
                db.session.flush()
                user = _make_user(employee, fake.unique.email(), Role.EMPLOYEE, DEMO_PASSWORD)
                employee.user = user

                sim = _make_sim(sim_index)
                sim.plan_id = random.choice(plans).plan_id
                db.session.add(sim)
                db.session.flush()
                allocation = SimAllocation(sim_id=sim.sim_id, employee_id=employee.employee_id, start_at=utcnow())
                db.session.add(allocation)
                db.session.flush()
                allocation.sim = sim
                roster.append((employee, allocation, f"{100 + sim_index:03d}", random.random() < 0.15))
                sim_index += 1

        all_extensions = [ext for _, _, ext, _ in roster]
        for employee, allocation, extension, heavy in roster:
            _seed_usage_for(employee, allocation, extension, all_extensions, heavy)

        db.session.commit()
        record_audit("system_seeded", "database", actor_id=None, actor_role=None,
                     meta={"departments": len(DEPARTMENTS), "employees": len(roster), "plans": len(plans)})

        print(f"Seeded {len(DEPARTMENTS)} departments, {len(plans)} telco plans, "
              f"{len(roster)} Manager/Employee accounts (+1 Admin), and "
              f"{MONTHS_OF_HISTORY} months of usage history.")
        print(f"Admin login:  {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
        print(f"All other seeded accounts share the password: {DEMO_PASSWORD}")
        print("(MFA OTP codes are logged to the console when MAIL_SUPPRESS_SEND=true.)")


if __name__ == "__main__":
    run()
