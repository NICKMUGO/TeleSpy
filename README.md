# TeleSpy

AI-driven SIM management and telecom cost accountability system, built for
Kenya Airways as a university capstone project.

TeleSpy tracks which employee holds which SIM card and desk extension, turns
raw PBX call detail records (CDRs) into per-employee and per-department costs
in KES, and uses machine learning to flag unusual calling behaviour, group
employees by usage pattern, and forecast next month's departmental spend.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Backend API](#1-backend-api)
  - [2. Frontend](#2-frontend)
  - [3. ML pipeline](#3-ml-pipeline)
- [Roles and access](#roles-and-access)
- [API overview](#api-overview)
- [ML pipeline in detail](#ml-pipeline-in-detail)
- [Billing rules](#billing-rules)
- [Security](#security)
- [Testing and CI](#testing-and-ci)

## Features

- **SIM inventory and allocation** — register SIM cards, assign them to
  employees, unassign them, and keep the full allocation history.
- **Employees and departments** — manage staff, their extension codes, and
  each department's telecom budget.
- **CDR ingestion** — pull call records from Cisco CUCM (SFTP), Avaya
  (real-time TCP stream), or any vendor that drops files over SFTP, or upload
  them through the web UI.
- **Call classification and billing** — every call is classified as Internal,
  External (Kenyan), or International and priced from admin-editable rate
  tables.
- **Anomaly detection** — an Isolation Forest flags unusual calls for an
  admin to review and resolve.
- **Usage profiling** — KMeans groups employees into low, moderate, and high
  usage tiers.
- **Spend forecasting** — Prophet forecasts next-period spend per department.
- **Budgets and invoices** — per-role monthly cost ceilings, over-limit
  reports, and monthly invoice emails.
- **Audit log** — every sensitive change is recorded and visible to admins.
- **Secure sign-in** — email OTP as a second factor, account lockout,
  password history, and one active session per user.

## Architecture

```mermaid
flowchart LR
    PBX["PBX systems<br/>Cisco CUCM · Avaya · other vendors"]
    ING["ML/ingestion<br/>fetch connectors"]
    PRE["ML/preprocessing<br/>clean + normalise"]
    TRN["ML/training<br/>billing · anomalies · profiles · forecasts"]
    DB[("PostgreSQL")]
    API["BackendDotNet<br/>ASP.NET Core API"]
    REDIS[("Redis")]
    WEB["Frontend<br/>Next.js"]

    PBX --> ING --> PRE --> TRN --> DB
    API <--> DB
    API <--> REDIS
    WEB <--> API
```

The three parts are deliberately separate:

| Part            | Responsibility                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `Frontend/`     | Presentation only. A role-gated Next.js client with no business logic.                           |
| `BackendDotNet/` | The REST API. Owns authentication, access control, the database schema, and all CRUD.            |
| `ML/`           | Batch jobs. Fetches and cleans CDRs, prices calls, and writes ML results straight into the database. |

The API does not run any ML in-process. The ML jobs write their results
(`usage_summaries`, `anomaly_flags`, `usage_profiles`, `forecast_results`) to
the same database the API reads from, each on its own schedule.

## Tech stack

| Layer    | Technology                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Query and Table, Zustand, Zod, Recharts |
| Backend  | ASP.NET Core on .NET 10, Entity Framework Core 10, JWT, BCrypt                                        |
| Data     | PostgreSQL (SQLite also supported for local development), Redis                                       |
| ML       | Python, pandas, NumPy, scikit-learn (Isolation Forest, KMeans), Prophet, Paramiko                     |
| Tooling  | pnpm, Vitest, Playwright, axe-core, ESLint, Prettier, Husky, GitHub Actions                           |

## Repository layout

```text
TeleSpy/
├── BackendDotNet/          ASP.NET Core API
│   ├── Api/                Controllers, one per domain
│   ├── Core/               Config, JWT, middleware, role attributes, startup bootstrap
│   ├── Models/             EF Core entities and DbContext
│   ├── Services/           Allocation, audit, cache, mail, call classification, password reset
│   ├── Migrations/         EF Core migrations
│   ├── Program.cs          Application entry point
│   └── Seed.cs             Demo data generator
├── Frontend/               Next.js web client
│   ├── src/app/            Routes (dashboard, SIMs, employees, analytics, ...)
│   ├── src/features/       Feature modules (auth, billing, anomalies, ingestion)
│   ├── src/components/     Shared UI and layout
│   ├── src/lib/            API client, auth session store, helpers
│   └── tests/              Playwright end-to-end tests
└── ML/
    ├── ingestion/          CDR fetch connectors (CUCM, Avaya, generic SFTP)
    ├── preprocessing/      CDR cleaning and normalisation
    ├── training/           Billing, anomaly detection, usage profiling, forecasting
    └── data/               cdr_incoming/, processed/, archive/ (contents not committed)
```

## Getting started

### Prerequisites

| Tool       | Version                         |
| ---------- | ------------------------------- |
| .NET SDK   | 10.0                            |
| Node.js    | 20.9 or newer (CI uses Node 22) |
| pnpm       | 11                              |
| Python     | 3.10 or newer                   |
| PostgreSQL | 14 or newer                     |
| Redis      | any recent version              |

### 1. Backend API

Create `BackendDotNet/.env`. The four secrets marked required must be set or
the API refuses to start.

```dotenv
ASPNETCORE_ENVIRONMENT=Development

# Required secrets. Generate each one with: openssl rand -base64 32
SECRET_KEY=
JWT_SECRET_KEY=
FIELD_ENCRYPTION_KEY=
# Generate with: openssl rand -hex 32
BLIND_INDEX_KEY=

# Database and cache
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/telespy
REDIS_URL=redis://localhost:6379/0

# Frontend origins allowed to call the API (comma-separated)
FRONTEND_ORIGINS=http://localhost:3000

# Outbound email (login codes, password reset, invoices)
MAIL_SERVER=localhost
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_DEFAULT_SENDER=TeleSpy <no-reply@telespy.local>
# true = emails are written to the log instead of being sent
MAIL_SUPPRESS_SEND=true
```

Optional settings and their defaults:

| Variable                               | Default   | Purpose                                  |
| -------------------------------------- | --------- | ---------------------------------------- |
| `JWT_ACCESS_TOKEN_EXPIRES_MINUTES`     | `15`      | Access token lifetime                    |
| `JWT_REFRESH_TOKEN_EXPIRES_DAYS`       | `7`       | Refresh token and session lifetime       |
| `JWT_MFA_TOKEN_EXPIRES_MINUTES`        | `5`       | Token issued between password and OTP    |
| `MFA_OTP_EXPIRES_MINUTES`              | `5`       | Login code lifetime                      |
| `PASSWORD_RESET_TOKEN_EXPIRES_MINUTES` | `30`      | Password reset link lifetime             |
| `DPA_KE_POLICY_VERSION`                | `2026-01` | Privacy policy version users consent to  |

For a quick local setup without PostgreSQL, point `DATABASE_URL` at a SQLite
file instead: `sqlite:///telespy.db`.

Then apply the migrations, load the demo data, and start the server:

```bash
cd BackendDotNet

dotnet tool install --global dotnet-ef   # once, if you do not have it
dotnet ef database update                # create the schema
dotnet run -- --seed                     # optional: load demo data
dotnet run --urls http://localhost:5299  # start the API
```

Check that it is up:

```bash
curl http://localhost:5299/health
```

The seed is built from the preprocessed CDR dataset
(`ML/data/processed/cdr_preprocessed.csv`, so run the preprocessing stage
first; set `CDR_DATASET_PATH` to use a file elsewhere). Every extension that
places a call in the dataset becomes an employee with a SIM allocation, and
every call placed from one of those extensions becomes a usage event (calls
coming in from outside numbers are not tracked). Departments, telco plans,
names, and email addresses are not in the dataset, so those are generated: five
departments, three telco plans, an admin, and a manager per department. It
skips itself if any department already exists. The demo account credentials
are defined at the top of `BackendDotNet/Seed.cs`. Never run the seed against
a real environment.

With `MAIL_SUPPRESS_SEND=true`, login codes are printed in the API log rather
than emailed, so you can sign in locally without an SMTP server.

### 2. Frontend

```bash
cd Frontend

pnpm install
cp .env.example .env.local
pnpm dev
```

Open <http://localhost:3000>. `.env.local` holds one setting,
`NEXT_PUBLIC_API_URL`, which defaults to `http://localhost:5299`.

Common scripts:

| Command               | Does                                              |
| --------------------- | ------------------------------------------------- |
| `pnpm dev`            | Start the development server                      |
| `pnpm build`          | Production build                                  |
| `pnpm lint`           | ESLint                                            |
| `pnpm typecheck`      | TypeScript check                                  |
| `pnpm test`           | Vitest unit tests                                 |
| `pnpm test:e2e`       | Playwright end-to-end and accessibility tests     |
| `pnpm check-contrast` | WCAG 2.2 AA contrast check over the colour tokens |

### 3. ML pipeline

```bash
cd ML

python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The ML jobs read `DATABASE_URL` from `BackendDotNet/.env`, so the backend must
be configured and migrated first. No separate database setting is needed.

Place CDR files in `ML/data/cdr_incoming/`, then run the stages in order:

```bash
python preprocessing/run_preprocessing.py   # clean and append to data/processed/

cd training
python billing.py             # price calls, write usage_summaries
python anomaly_detection.py   # flag unusual calls
python usage_profiling.py     # cluster employees
python forecasting.py         # forecast department spend
```

To run all four training jobs at once during development, open
`ML/training/run_ml.ipynb`.

## Roles and access

There are three roles. The API enforces access on every request; the frontend
hides navigation a role cannot use, but only as a convenience.

| Area                                   | Admin | Manager | Employee |
| -------------------------------------- | :---: | :-----: | :------: |
| Own settings, own usage, own profile   |  Yes  |   Yes   |   Yes    |
| View SIMs, employees, usage events     |  Yes  |   Yes   |    No    |
| View analytics, forecasts, budgets     |  Yes  |   Yes   |    No    |
| View department spend                  |  Yes  |   Yes   |    No    |
| Create and edit SIMs, employees, departments |  Yes  |   No    |    No    |
| Allocate and unassign SIMs             |  Yes  |   No    |    No    |
| Ingest CDRs                            |  Yes  |   No    |    No    |
| Resolve anomalies                      |  Yes  |   No    |    No    |
| Edit call rates and role cost limits   |  Yes  |   No    |    No    |
| Send monthly invoices                  |  Yes  |   No    |    No    |
| Read the audit log                     |  Yes  |   No    |    No    |

Only the Employee role can self-register. Admin and Manager accounts are
created by an admin.

## API overview

All routes except the sign-in routes and `/health` require a bearer token.

| Area        | Endpoints                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Auth        | `POST /auth/register`, `/auth/login`, `/auth/verify-otp`, `/auth/resend-otp`, `/auth/refresh`, `/auth/logout` |
| Passwords   | `POST /auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`                                 |
| Employees   | `GET` `POST /employees`, `GET` `PATCH` `DELETE /employees/{id}`                                               |
| Directory   | `GET /directory` (name and extension lookup, every role)                                                      |
| Departments | `GET` `POST /departments`, `PATCH /departments/{id}`, `GET /departments/{id}/spend`                           |
| SIMs        | `GET` `POST /sims`, `PATCH /sims/{id}`, `POST /sims/{id}/allocate`, `POST /sims/{id}/unassign`                |
| Telco plans | `GET` `POST /telco-plans`                                                                                     |
| Usage       | `POST /cdr/ingest`, `GET /usage`, `GET /me/usage`                                                             |
| Analytics   | `GET /analytics/anomalies`, `POST /analytics/anomalies/{id}/resolve`, `GET /analytics/profiles`, `GET /analytics/usage-summary`, `GET /forecast/{departmentId}` |
| Call rates  | `GET` `PATCH /call-rates/local`, `GET /call-rates/international`, `PATCH /call-rates/international/{countryCode}` |
| Budgets     | `GET /roles`, `PATCH /roles/{id}`, `GET /budgets/over-limit`                                                  |
| Reconciliation | `GET /reconciliation`, `PUT /reconciliation/{month}`                                                       |
| Invoices    | `POST /invoices/send-monthly`                                                                                 |
| Audit       | `GET /audit`                                                                                                  |
| Account     | `GET` `PATCH /settings/me`, `GET` `POST /tutorial/progress`, `POST /tutorial/restart`, `POST /tutorial/dismiss` |
| Health      | `GET /health`                                                                                                 |

## ML pipeline in detail

### Ingestion

Each connector only lands raw vendor files in `ML/data/cdr_incoming/`. None
of them touch the database.

| Script                   | Source                         | How it runs                                   |
| ------------------------ | ------------------------------ | --------------------------------------------- |
| `cucm_sftp_fetch.py`     | Cisco CUCM                     | Scheduled batch pull over SFTP                |
| `avaya_cdr_listener.py`  | Avaya CM, Aura, IP Office      | Long-running TCP listener, as a systemd service |
| `generic_sftp_fetch.py`  | Any vendor that drops files    | Scheduled batch pull over SFTP                |

Copy `ML/ingestion/.env.example` to `ML/ingestion/.env` and fill in the
connection details. A sample unit file for the Avaya listener is in
`ML/ingestion/systemd/`; update its paths for your machine before installing
it.

### Preprocessing

`ML/preprocessing/run_preprocessing.py` reads everything in `cdr_incoming/`,
cleans and normalises it, converts call times to Nairobi local time, appends
the result to `ML/data/processed/cdr_preprocessed.csv`, and moves the source
files to `archive/`. `cdr_preprocessing.ipynb` is the same logic for
interactive exploration.

### Training jobs

Each job is a standalone script, so each can be scheduled independently.

| Job                    | Model                                 | Writes to           | Suggested schedule |
| ---------------------- | ------------------------------------- | ------------------- | ------------------ |
| `billing.py`           | Rule-based rating                     | `usage_summaries`   | Monthly            |
| `anomaly_detection.py` | Isolation Forest                      | `anomaly_flags`     | Every 4 hours      |
| `usage_profiling.py`   | KMeans, 3 clusters                    | `usage_profiles`    | Every 3 months     |
| `forecasting.py`       | Prophet, with a log-linear fallback   | `forecast_results`  | Monthly            |

How each model is evaluated:

- **Anomaly detection and usage profiling** are unsupervised, so there are no
  labels to compute accuracy against. Both use a grid search with repeated
  K-fold cross-validation and compare scores on the training fold with scores
  on a held-out fold.
- **Forecasting** uses walk-forward cross-validation, so future months never
  leak into training, and reports MAE, RMSE, and MAPE.

## Billing rules

Calls are classified from the dialled number, after stripping the leading `9`
used for an outside line:

| Class         | Pattern                                        | Charged |
| ------------- | ---------------------------------------------- | :-----: |
| Internal      | A bare 3-digit extension                       |   No    |
| External      | A Kenyan number, in local or `+254` form       |   Yes   |
| International | `+`, `00`, or `000` followed by a non-Kenyan country code |   Yes   |
| Unknown       | Anything else                                  |   No    |

Cost is call duration multiplied by a list rate, less the contract discount
for that call type. Everything is read from the database:

- **Local calls** use a peak and an off-peak list rate, tax-inclusive. The
  defaults come from the organisation's itemised Safaricom bill: KES 4.67 per
  minute from 08:00 to 22:00 and KES 2.40 per minute otherwise.
- **International calls** use a per-country rate, with a fallback of KES 40
  per minute for any country code that has no rate.
- **The contract discount** is a percentage per call type. The defaults are
  54% on peak calls and on off-peak calls to other networks, and none on
  off-peak calls to Safaricom numbers or on international calls. Safaricom
  numbers are told apart from other networks by prefix.

Each employee's monthly figure is stored both at list price and after the
discount. The line's fixed monthly charge (KES 26,086.96 before 15% excise and
16% VAT by default) is a company-level cost and is not charged to anyone.

Admins can change all of this from the web UI, under Settings. A change takes
effect the next time `billing.py` runs. The rate tables are filled with
defaults on first startup and are never overwritten after that.

**Bill reconciliation** (Admin) rebuilds each month's bill from these figures
and sets it beside the telco's actual invoice total, which an admin enters.

## Security

- **Two-step sign-in** — a password check followed by a one-time code sent by
  email.
- **One session per user** — signing in on a second device asks for
  confirmation and then signs the first device out.
- **Account lockout** — 15 minutes after 5 failed sign-in attempts.
- **Password history** — a new password cannot match the current one or any
  of the previous three.
- **Token revocation** — signed-out tokens are blocklisted in Redis.
- **Encryption at rest** — SIM ICCIDs, phone numbers, and extensions are
  encrypted in the database, with a separate blind index so they stay
  searchable.
- **Consent** — users accept a versioned privacy notice aligned with Kenya's
  Data Protection Act.
- **Audit trail** — sensitive actions are logged with who did them and when.

## Testing and CI

The frontend has unit tests (Vitest and Testing Library) and end-to-end tests
(Playwright) that include axe-core accessibility checks.

`Frontend/.github/workflows/ci.yml` defines two jobs: lint, format check,
contrast check, typecheck, unit tests, and build; then Playwright end-to-end
tests.
