# TeleSpy Backend (Flask-RESTful + SQLAlchemy)

Backend-only, per the brief — no frontend changes here. Flask-RESTful
`Resource` classes, SQLAlchemy ORM, Alembic migrations (via Flask-Migrate)
— SQL, not NoSQL. Same framework and language as before; the code is now
split into `core/` (cross-cutting), `services/` (reusable domain logic),
and `api/` (one module per route group) behind an application factory,
with `models/` left byte-for-byte unchanged.

**No seed data.** Every table starts empty; `seed.py` is a placeholder for
later.

## Layout

```
Backend/
  app.py                     # create_app() factory + module-level `app` (gunicorn app:app)
  constants.py                # roles, cost ceilings, call-classification rules/patterns
  security.py                 # field encryption + blind index + OTP/reset-token generation
  validators.py               # email/password/extension format checks
  core/
    config.py                 # Config (env-driven)
    extensions.py             # JWTManager/Mail singletons + JWT error/blocklist loaders
    decorators.py             # before_request auth + role_id_required
    responses.py              # ok()/err() envelope + pagination helpers
    time.py                   # utcnow() (naive-UTC, matches models._utcnow)
    legal.py                  # Terms & Conditions / Kenya DPA notice text
    tutorial_content.py       # in-app tutorial step content, per role
  services/
    call_classification.py    # Internal/External/International classification + carve-out
    billing.py                # single source of truth for call cost (KES)
    anomaly.py                # rule-based anomaly scoring (Isolation Forest seam)
    allocation.py             # time-bounded SIM <-> employee allocation
    audit.py                  # record_audit() writer
    mail.py                   # send_mail_safe()
    cache.py                  # Redis: JWT blocklist + MFA OTP
  api/
    __init__.py               # register_resources(api) — wires every module's RESOURCES
    common.py                 # loaded_user(), viewer_department_id(), current_month()
    auth.py settings.py roles.py departments.py employees.py telco_plans.py
    sims.py cdr.py analytics.py audit.py tutorial.py misc.py
  models/models.py            # SQLAlchemy models — UNCHANGED
  migrations/                 # Alembic, via `flask db migrate`/`upgrade`
  seed.py                     # placeholder — no seed data yet
  requirements.txt
```

Adding a route group = drop in `api/<name>.py` with a `RESOURCES` list of
`(Resource, *url_rules)` and append the module in `api/__init__.py`.

## Setup

```bash
cd Backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill in `.env`:
- `SECRET_KEY`, `JWT_SECRET_KEY` — any long random string each.
- `FIELD_ENCRYPTION_KEY` — `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- `BLIND_INDEX_KEY` — `python -c "import secrets; print(secrets.token_hex(32))"`
- `DATABASE_URL` — defaults to `sqlite:///telespy.db` (zero setup for local
  dev); point it at Postgres/MySQL in production.
- Real SMTP creds if you want actual emails; otherwise leave
  `MAIL_SUPPRESS_SEND=true` and OTP/reset emails print to the console log.

Create the schema and run:
```bash
FLASK_APP=app.py flask db upgrade   # applies migrations/versions/*
python app.py                        # dev server on :5000
# or
gunicorn app:app                      # production
```

Bootstrapping the first account: `POST /auth/register` only ever creates
an `Employee`. To get a first `Admin`, insert one directly (hash via
`models.models.User.password` setter), then use `POST /users` for every
account after that.

## How the pieces map to the brief

- **Flask + role check before granting access** —
  `app.before_request(load_current_user)` (from `core/decorators.py`,
  registered in the `create_app()` factory) requires a valid JWT on every
  route except the public auth endpoints (`core.decorators.PUBLIC_PATHS`),
  and attaches `role`/`role_id`/`department_id` for the request. Each
  `Resource` method then stacks `@role_id_required(...)` on top (alongside
  `@jwt_required()`) for the "only these roles" check.
- **In-built tutorial** — `GET/POST /tutorial/progress`, `POST
  /tutorial/restart` / `/dismiss` (`api/tutorial.py`). Step content is
  static and role-aware (`core/tutorial_content.py`), mirrored to the nav
  sections in `Frontend/src/components/layout/nav-items.ts`.
- **SQL via SQLAlchemy** — one `users` table doubling as the employee
  roster (see the design note at the top of the `User` model in
  `models/models.py` for why there's no separate `employees` table).
- **Encryption of SIMs/extensions/mapping** — Fernet (AES128-CBC+HMAC) at
  rest for ICCID, MSISDN, extension, and national ID, with a separate
  HMAC "blind index" fingerprint column alongside each so the DB can still
  enforce uniqueness/search without ever storing plaintext. See
  `security.py` and the `SimCard`/`User` models.
- **Password encryption** — bcrypt hashing via `User.password`
  (hybrid_property setter) / `User.check_password`; "encryption" of a
  password is a hash in practice since it must never be reversible.
- **Indexes for quick search** — `index=True` / composite `db.Index(...)`
  in `models/models.py`, applied for real via the generated Alembic
  migration (`migrations/versions/`).
- **Password bank (last 3)** — `api.auth.rotate_password()` +
  `password_history` table, enforced on both reset and change-password.
- **Password reset, "very good random number"** — `secrets.token_urlsafe(48)`
  for reset links and `secrets.choice` for OTP digits (`security.py`) — the
  OS CSPRNG via the `secrets` module, never `random`.
- **APIs check role_id before granting access** —
  `core.decorators.role_id_required(...)`, keyed off `constants.ROLE_SLUGS`.
- **CORS** — `flask-cors`, restricted to `FRONTEND_ORIGINS` from `.env`.
- **Terms & Conditions / Kenya DPA (2019) consent** — `GET
  /auth/legal-notice` serves the current notice text and version; `POST
  /auth/register` requires `accept_terms` and `accept_dpa_notice` both
  `true` and records a timestamped `Consent` row (`core/legal.py`,
  `api.auth.Register`). Have the notice text reviewed by counsel before
  relying on it in production — it's structurally complete, not legal advice.
- **MFA via email** — every login is two-step: `POST /auth/login` (password
  check) issues a short-lived `mfa_token` and emails a 6-digit OTP; `POST
  /auth/verify-otp` exchanges the OTP for real access/refresh tokens.
- **Total Cost per Employee is private** — stripped from `User.to_dict()`
  entirely (not nulled — omitted) unless the viewer is Admin, or the
  Manager of that employee's own department.
- **Call classification, 256/400 carve-out, cost ceilings (2000 manager /
  1000 employee)** — patterns in `constants.py`, logic in
  `services/call_classification.py`, cost in `services/billing.py`, budget
  helpers in `api/roles.py`. Three chargeable-or-not outcomes:
  - **External (Kenyan)** — the `9` trunk-access prefix + 10-digit number
    (`KENYAN_EXTERNAL_NUMBER_REGEX`, unchanged). A `+254…` / `00254…`
    number is normalised to local form and billed as one of these.
  - **International** — `+` / `00` / `000` + country code (not 254) +
    subscriber number (`INTERNATIONAL_NUMBER_REGEX`); billed like External
    (plan rate, or the flat fallback). Shows separately via
    `GET /usage?classification=International`.
  - **Internal** — a bare 3-digit extension (`INTERNAL_EXTENSION_REGEX`).
    **Never charged** — `services/billing.py` forces the cost to 0 even
    when the CDR row carries a `charge` column. `Unknown` is likewise not
    charged.

  A rule-based anomaly pass (cost-ceiling breaches) is live at `GET
  /analytics/anomalies` (`services/anomaly.py`). The trained-model layer
  (Isolation Forest / Prophet-or-trend / KMeans per `Design_Docs/`) is
  `ML/training/` — a single shared implementation (not duplicated per
  backend) that writes straight to `anomaly_flags`, `usage_profiles`, and
  `forecast_results` via plain SQL, since both backends share the same
  schema. Run `ML/training/run_ml.ipynb` to (re)populate those tables;
  `Forecasts`/`Profiles` in `api/analytics.py` just read what it wrote.

  Note: `UsageEvent.compute_cost()` / `TelcoPlan.calculate_cost()` remain
  on the models untouched (the DB layer is unchanged) but are no longer on
  the ingestion path — `services/billing.compute_event_cost()` is the
  single source of truth.

## What's deliberately NOT in this pass

The frontend-facing asks in the same message (no scrolling navbar,
full-page forms instead of multi-step, responsive layout) are frontend
work and out of scope here — noted for when that work starts.

## Verifying it works

Every flow below was exercised end-to-end against a real SQLite database
(migrated via `flask db upgrade`, not mocked): register → consent capture
→ missing-consent rejection → login → email OTP → verify → 401
unauthenticated / 403 wrong-role → employee creation with encrypted
extension+national_id → CDR ingestion → call classification (Internal/
External) → extension-256 anomaly exclusion → cost accrual → budget-ceiling
anomaly flagging → SIM encryption/uniqueness/masking → admin-provisioned
Manager + forced reset → Manager roster scoping → password-bank reuse
rejection → logout + revoked-token rejection. All
passed. Point `DATABASE_URL` at Postgres/MySQL in production — the same
code runs unchanged.
