"""Static, code-owned in-app tutorial content, one track per role, mirrored
to the frontend nav (Frontend/src/components/layout/nav-items.ts). This is
app configuration, not seed data — it ships with the code and needs no
database record to exist.
"""
from constants import Role

_COMMON = [
    {"id": "welcome", "title": "Welcome to TeleSpy", "body": "TeleSpy tracks company SIMs, call usage, and telecom cost across departments.", "href": "/dashboard"},
    {"id": "dashboard", "title": "Your dashboard", "body": "See usage and cost trends for your scope at a glance.", "href": "/dashboard"},
    {"id": "settings", "title": "Your settings", "body": "Update your profile and review your security settings here.", "href": "/settings"},
]

TUTORIAL_TRACKS: dict[str, list[dict]] = {
    Role.ADMIN: _COMMON + [
        {"id": "sims", "title": "SIM inventory", "body": "Provision, assign, and decommission company SIM cards.", "href": "/sims"},
        {"id": "employees", "title": "Employees", "body": "Manage employee records and their extension/department mapping.", "href": "/employees"},
        {"id": "departments", "title": "Departments", "body": "Organize employees into departments for budgeting and reporting.", "href": "/departments"},
        {"id": "ingestion", "title": "CDR upload", "body": "Ingest new Call Detail Record batches for processing.", "href": "/ingestion"},
        {"id": "usage", "title": "Usage events", "body": "Browse individual call records, filterable by date, extension, and type.", "href": "/usage"},
        {"id": "anomalies", "title": "Anomalies", "body": "Review calls and employees flagged for unusual cost or usage.", "href": "/analytics/anomalies"},
        {"id": "forecasts", "title": "Forecasts", "body": "Projected telecom spend for upcoming periods.", "href": "/analytics/forecasts"},
        {"id": "profiles", "title": "Usage profiles", "body": "Employees clustered by calling behavior.", "href": "/analytics/profiles"},
        {"id": "budgets", "title": "Budgets", "body": "Set the monthly cost ceiling per role.", "href": "/budgets"},
        {"id": "audit", "title": "Audit log", "body": "A full, tamper-evident trail of sensitive actions across the system.", "href": "/audit"},
        {"id": "users", "title": "User provisioning", "body": "Create Admin and Manager accounts.", "href": "/settings/users"},
    ],
    Role.MANAGER: _COMMON + [
        {"id": "employees", "title": "Your team", "body": "View the employees in your department.", "href": "/employees"},
        {"id": "usage", "title": "Usage events", "body": "Browse call records for your department.", "href": "/usage"},
        {"id": "anomalies", "title": "Anomalies", "body": "Review employees in your department flagged for unusual cost.", "href": "/analytics/anomalies"},
        {"id": "budgets", "title": "Budgets", "body": "See the monthly cost ceiling that applies to your team.", "href": "/budgets"},
    ],
    Role.EMPLOYEE: _COMMON + [
        {"id": "usage", "title": "Your usage", "body": "See your own recent call activity.", "href": "/usage"},
    ],
}


def steps_for_role(role: str) -> list[dict]:
    return TUTORIAL_TRACKS.get(role, _COMMON)
