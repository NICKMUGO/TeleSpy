"""Central, code-owned policy constants.

Nothing in this file is "seed data" — it's application configuration
(roles, cost ceilings, anomaly-detection carve-outs). Domain records
(users, employees, SIMs, departments, call history) are deliberately left
empty; that gets loaded separately once seeding is wanted (see seed.py).

The one exception, `ensure_default_roles()` in app.py: the `roles` table
needs *some* rows for `users.role_id` to be a satisfiable foreign key at
all — Admin/Manager/Employee are fixed, structural reference data (like a
status enum), not business/demo records, so the app upserts exactly those
three rows at startup. See the comment there for the full reasoning.
"""


class Role:
    ADMIN = "Admin"
    MANAGER = "Manager"
    EMPLOYEE = "Employee"


# roles.role_id (Design_Docs ERD types every PK/FK as "string"). Roles are
# a small, fixed reference set, so — unlike the UUIDs used for every other
# table's PK — role_id is a stable, human-readable slug. That keeps
# `role_id_required(...)` checks in app.py comparing against constants
# known at code-authoring time, exactly like the brief asks for, instead
# of a randomly-generated id that would only exist after the DB seeds it.
ROLE_SLUGS = {
    Role.ADMIN: "admin",
    Role.MANAGER: "manager",
    Role.EMPLOYEE: "employee",
}
SLUG_TO_ROLE_NAME = {slug: name for name, slug in ROLE_SLUGS.items()}
ALL_ROLES = tuple(ROLE_SLUGS.keys())

# Roles allowed to self-register through POST /auth/register. Every other
# role is provisioned by an admin via POST /users so privilege can't be
# self-granted at signup.
SELF_REGISTERABLE_ROLES = (Role.EMPLOYEE,)

# Default monthly telecom cost ceiling per role, in KES — written into
# roles.call_limit_kshs by ensure_default_roles() at startup. From then on
# the database row is the source of truth (editable via PUT /roles/<id>),
# these constants are only the bootstrap default. Admin has no personal
# ceiling (None).
DEFAULT_CALL_LIMIT_KES = {
    Role.ADMIN: None,
    Role.MANAGER: 2000,
    Role.EMPLOYEE: 1000,
}

# Password Bank: a new password may not match the current password or any
# of this many previous ones.
PASSWORD_HISTORY_LIMIT = 3

# Account lockout after repeated failed logins.
MAX_FAILED_LOGIN_ATTEMPTS = 5
ACCOUNT_LOCKOUT_MINUTES = 15

# --- Call classification -----------------------------------------------
# There are two kinds of chargeable outbound call, each recognised by its
# own pattern:
#
#   1. Kenyan external call  -> KENYAN_EXTERNAL_NUMBER_REGEX
#   2. International call     -> INTERNATIONAL_NUMBER_REGEX
#
# Kenyan external call: dialled out through the "9" trunk-access prefix
# followed by a 10-digit subscriber number -> 11 characters total, e.g.
# 9712345678X. This is the original EXTERNAL_NUMBER_REGEX, unchanged -
# only renamed now that it sits next to the international pattern. It still
# starts with "9".
KENYAN_EXTERNAL_NUMBER_REGEX = r"^9\d{10}$"
# Back-compat alias for anything still importing the old name.
EXTERNAL_NUMBER_REGEX = KENYAN_EXTERNAL_NUMBER_REGEX

# Kenyan number in plain local form: leading "0" + 9 digits, e.g.
# 0712345678. Not normally dialled this way through the PBX, but it's what
# a +254... number collapses to once normalised (see
# KENYAN_INTERNATIONAL_PREFIX_REGEX) - and such a call bills exactly like a
# KENYAN_EXTERNAL_NUMBER_REGEX one.
KENYAN_LOCAL_NUMBER_REGEX = r"^0\d{9}$"

# International call: "+" (or "00" / "000"), then the country code, then the
# subscriber number (with the local leading "0" dropped), 6-15 digits after
# the prefix. Kenya (+254) is deliberately excluded by the (?!254)
# lookahead: a +254 number is a Kenyan call written internationally, not an
# international one, and is normalised + billed as a Kenyan external call.
INTERNATIONAL_NUMBER_REGEX = r"^(?:\+|00|000)(?!254)\d{6,15}$"

# Recognises a Kenyan number that was dialled in international form
# (+254..., 00254..., 000254...). group(1) is the national part, which is
# re-prefixed with "0" to get the local form.
KENYAN_INTERNATIONAL_PREFIX_REGEX = r"^(?:\+|00|000)254(\d+)$"

# Internal call: a bare 3-digit extension, e.g. 206, 389, 400. Never
# charged - internal-cluster traffic carries no charge at all (see
# CHARGEABLE_CALL_CLASSES below and services/billing.py).
INTERNAL_EXTENSION_REGEX = r"^\d{3}$"

# Extensions permanently excluded from anomaly detection even though their
# calls are still logged normally (e.g. shared/IVR lines whose traffic
# pattern is expected to look "abnormal" by design).
ANOMALY_EXCLUDED_EXTENSIONS = frozenset({"256", "400"})

CALL_CLASS_INTERNAL = "Internal"
CALL_CLASS_EXTERNAL = "External"
CALL_CLASS_INTERNATIONAL = "International"
CALL_CLASS_UNKNOWN = "Unknown"

# The only call classes that accrue cost. Internal and Unknown calls are
# never billed, even when a CDR row carries a charge column. The billing
# service (services/billing.py) is the single place this is enforced.
CHARGEABLE_CALL_CLASSES = frozenset({CALL_CLASS_EXTERNAL, CALL_CLASS_INTERNATIONAL})

# Internal calls always bill at 0 (confirmed by the CUCM CDR exports, which
# carry no charge column for internal-cluster traffic). This is only a
# fallback rate for chargeable events (External / International) on a SIM
# whose telco_plan has no rate_per_minute_kes of its own (or isn't
# attributed to a plan at all) — see services/billing.py.
EXTERNAL_CALL_RATE_KES_PER_MINUTE = 5.0
