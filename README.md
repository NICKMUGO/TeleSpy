# TeleSpy

AI-driven SIM management and telecom cost accountability system, built for
Kenya Airways as a university capstone project.

TeleSpy tracks which employee holds which phone line (SIM card, desk
extension and company number), turns raw PBX call detail records (CDRs) into
per-employee and per-department costs in KES, and uses machine learning to
flag unusual calling behaviour, group employees by usage pattern, and
forecast next month's departmental spend. It also runs a customer service
ticketing desk with SLA tracking and customer ratings.

The development data (the PBX CDR export and the itemised Safaricom bills
behind the default call rates) comes from KenyaRe.

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
- [Customer service ticketing](#customer-service-ticketing)
- [Security](#security)
- [Testing and CI](#testing-and-ci)
- [Deployment](#deployment)

## Features

- **Lines and allocation** — register SIM cards, extensions and company
  numbers and keep the full allocation history. A person holds at most one
  line and a SIM has one holder (enforced in the database). Lines are handed
  over by swapping or removing the current holder; removal needs a step-up
  check and emails HR, and spend on unheld lines is still tracked.
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
- **Bill reconciliation** — each month's computed bill side by side with the
  telco's actual invoice.
- **Customer service tickets** — the customer service desk raises tickets for
  customers; anyone else raises internal tickets. A ticket has a quick
  category (which routes it to a department) or a custom reason, a priority,
  and a deadline the raiser sets. Handlers claim, resolve, reject, hand back,
  transfer, or forward it for action with a reply-by time. The raiser can
  resend or withdraw a rejected ticket and reopen a resolved one (up to 14
  days, with a reason and a new deadline); an Admin can close any ticket.
  The SLA clock pauses while a ticket is rejected or forwarded. Past a
  deadline, the handling department's Manager is alerted (overdue forwards
  alert the forwarder and the other side's Manager). Each ticket has a live
  chat thread with read ticks, a full history, and email and web push
  notifications.
- **SLA report and customer ratings** — compliance by priority, department
  and person, a desk scorecard, what's overdue now, and CSAT: customers rate
  a resolved ticket 1–5 from a one-tap email link.
- **Guided tour** — an in-app tutorial for each role.
- **Installable app** — a PWA for desktop, Android and iPhone/iPad, with push
  notifications.
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
| `BackendDotNet/` | The REST API. Owns authentication, access control, the database schema, business rules, and live ticket updates (SignalR). |
| `ML/`           | Batch jobs. Fetches and cleans CDRs, prices calls, and writes ML results straight into the database. |

The API does not run any ML in-process. The ML jobs write their results
(`usage_summaries`, `anomaly_flags`, `usage_profiles`, `forecast_results`) to
the same database the API reads from, each on its own schedule.

## Tech stack

| Layer    | Technology                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Query and Table, Zustand, Zod, Recharts |
| Backend  | ASP.NET Core on .NET 10, Entity Framework Core 10, SignalR, Web Push, JWT, BCrypt                     |
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
│   ├── Services/           Allocation, cache, mail, notifications, push, step-up, call classification
│   ├── Migrations/         EF Core migrations
│   ├── Program.cs          Application entry point
│   └── Seed.cs             Demo data generator
├── Frontend/               Next.js web client
│   ├── src/app/            Routes (dashboard, SIMs, employees, analytics, ...)
│   ├── src/features/       Feature modules (auth, billing, anomalies, ingestion, tickets, ...)
│   ├── src/components/     Shared UI and layout
│   ├── src/lib/            API client, auth session store, helpers
│   └── tests/              Playwright end-to-end tests
├── deploy/                 Azure VM deployment (compose, Caddy, cloud-init, cron)
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

# The first Admin. While no active Admin exists, the API creates this account
# on startup and emails it a set-password link; ignored after that.
BOOTSTRAP_ADMIN_EMAIL=you@company.com
BOOTSTRAP_ADMIN_NAME=System Administrator
```

Variables already set in your shell override `.env`, so
`DATABASE_URL=… dotnet run` points at another database without editing it.

Optional settings and their defaults:

| Variable                               | Default   | Purpose                                  |
| -------------------------------------- | --------- | ---------------------------------------- |
| `JWT_ACCESS_TOKEN_EXPIRES_MINUTES`     | `15`      | Access token lifetime                    |
| `JWT_REFRESH_TOKEN_EXPIRES_DAYS`       | `30`      | Signed out after this many idle days     |
| `SESSION_MAX_DAYS`                     | `90`      | Signed out this long after sign-in       |
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
departments, three telco plans, and a manager per department. It skips itself
if any department already exists. Never run the seed against a real
environment.

No real person or known password is seeded: every seeded account is a
placeholder on an `@telespy.local` address with a random password nobody is
told, so none of them can sign in. To get in, set `BOOTSTRAP_ADMIN_EMAIL` and
start the API — it creates that Admin and emails a set-password link (with
`MAIL_SUPPRESS_SEND=true` the link is printed in the API log). Lost or expired
links: use "Forgot password?" on the sign-in page. The Admin then adds the
real Managers and Employees.

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
| Raise internal tickets                 |  Yes  |   Yes   |   Yes    |
| Handle tickets sent to own department  |  Yes  |   Yes   |   Yes    |
| Manage ticket categories, choose the customer service desk |  Yes  |   No    |    No    |

Tickets for customers are raised only by people in the customer service
desk department (one department is the desk, chosen in Settings). Nobody
can assign a ticket to themselves.

There is no self-registration: every account, whatever its role, is created
by an Admin (Employees → Add employee), and the new employee sets their own
password from the emailed link. A department has one Manager: making someone
its Manager (on create or edit) makes the previous Manager an Employee. Only
an Admin can change who holds a SIM and its extension.

## API overview

All routes except the sign-in routes and `/health` require a bearer token.

| Area        | Endpoints                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Auth        | `POST /auth/login`, `/auth/verify-otp`, `/auth/resend-otp`, `/auth/refresh`, `/auth/logout` |
| Passwords   | `POST /auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`                                 |
| Employees   | `GET` `POST /employees`, `GET` `PATCH` `DELETE /employees/{id}`                                               |
| Directory   | `GET /directory` (name and extension lookup, every role)                                                      |
| Departments | `GET` `POST /departments`, `PATCH /departments/{id}`, `GET /departments/{id}/spend`                           |
| SIMs        | `GET` `POST /sims`, `PATCH /sims/{id}`, `POST /sims/{id}/allocate`, `POST /sims/{id}/unassign`                |
| Telco plans | `GET` `POST /telco-plans`                                                                                     |
| Usage       | `POST /cdr/ingest`, `GET /cdr/batches`, `GET /usage`, `GET /me/usage`                                         |
| Analytics   | `GET /analytics/anomalies`, `POST /analytics/anomalies/{id}/resolve`, `GET /analytics/profiles`, `GET /analytics/usage-summary`, `GET /forecast/{departmentId}` |
| Call rates  | `GET` `PATCH /call-rates/local`, `GET /call-rates/international`, `PATCH /call-rates/international/{countryCode}` |
| Budgets     | `GET /roles`, `PATCH /roles/{id}`, `GET /budgets/over-limit`                                                  |
| Reconciliation | `GET /reconciliation`, `PUT /reconciliation/{month}`                                                       |
| Invoices    | `POST /invoices/send-monthly`                                                                                 |
| Reports     | `GET /reports/monthly?month=YYYY-MM` (the printable monthly report; Manager: own department only)          |
| Numbers     | `GET` `PATCH /settings/number-format` (Admin: the company number prefix; extension = last 3 digits)          |
| Tickets     | `GET` `POST /tickets`, `GET /tickets/{id}`, `GET /tickets/me`, `GET /tickets/stats`, `GET /tickets/sla`, `GET /tickets/assignees`, `GET` `POST /tickets/categories`, `PATCH /tickets/categories/{id}` |
| Ticket actions | `POST /tickets/{id}/` `claim`, `notes`, `read`, `resolve`, `return`, `release`, `resend`, `withdraw`, `reopen`, `close` (Admin), `transfer`, `forward`; `POST /tickets/{id}/forwards/{forwardId}/return`, `/recall` |
| Live updates | SignalR hub for ticket threads and queues; `GET /push/key`, `POST /push/subscribe`, `POST /push/unsubscribe` |
| Ratings     | `GET /feedback/r`, `POST /feedback` (public, token-gated: the customer's one-tap rating page) |
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

Before archiving, it sends the new calls to the API (`POST
/cdr/ingest/automatic`), the same path an upload on the Ingestion page takes,
so fetched calls are stored, attributed, checked for repeats and billed like
uploaded ones. It needs `CDR_INGEST_KEY` set in `BackendDotNet/.env` (the API
reads the same value) and, outside Docker, `TELESPY_API_URL`. If the API can't
take the calls, the files stay in `cdr_incoming/` for the next run. Use
`--csv-only` to update the CSV without sending anything. The fetchers and
preprocessing are not scheduled yet; they'll be added to `deploy/ml.crontab`
once the live CUCM/Avaya feeds are connected.

### Training jobs

Each job is a standalone script, so each can be scheduled independently.
The production schedule is in `deploy/ml.crontab`.

| Job                    | Model                                 | Writes to           | Suggested schedule |
| ---------------------- | ------------------------------------- | ------------------- | ------------------ |
| `billing.py`           | Rule-based rating                     | `usage_summaries`   | Within 15 minutes of an upload or rate change, plus monthly |
| `anomaly_detection.py` | Isolation Forest                      | `anomaly_flags`     | Every 24 hours     |
| `usage_profiling.py`   | KMeans, 3 clusters                    | `usage_profiles`    | Every 3 months     |
| `forecasting.py`       | Prophet, with a log-linear fallback   | `forecast_results`  | Every 3 months     |

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

Billing prices every call stored in `usage_events`: the seed dataset and
every CDR uploaded on the Ingestion page. A call's time is when it was
answered, in Nairobi time, so peak or off-peak is decided from pickup, not
ringing. The upload converts raw Cisco (CUCM) exports the same way the
preprocessing stage does, and skips calls that are already stored, so no call
is billed twice. Each call is charged to whoever held the line when it was
made; calls on a pool line nobody held are shown on the bill on their own.

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

Admins can change all of this from the web UI, under Settings. A change, or a
new CDR upload, is picked up by `billing.py` within 15 minutes. The rate tables are filled with
defaults on first startup and are never overwritten after that.

**Bill reconciliation** (Admin) rebuilds each month's bill from these figures
and sets it beside the telco's actual invoice total, which an admin enters.

## Customer service ticketing

TeleSpy includes a ticketing desk for customer issues and internal requests,
with SLA tracking, live chat on every ticket, and customer ratings.

### Who raises what

- **Customer tickets** are raised only by people in the customer service desk
  department. An Admin chooses which department is the desk in Settings.
- **Internal tickets** can be raised by anyone, in any role.
- Nobody can assign a ticket to themselves.

### Raising a ticket

Every ticket has:

| Field     | Meaning                                                                 |
| --------- | ----------------------------------------------------------------------- |
| Category  | A quick category that routes the ticket to a department, or a custom reason |
| Priority  | How urgent the ticket is; SLA compliance is reported per priority       |
| Deadline  | Set by the raiser; drives SLA tracking and overdue alerts               |

Admins manage the list of quick categories and the department each one routes
to.

### Lifecycle

```mermaid
flowchart LR
    NEW["Raised"] --> CLAIM["Claimed"]
    CLAIM --> RES["Resolved"]
    CLAIM --> REJ["Rejected"]
    CLAIM -->|transfer| NEW
    CLAIM -->|forward for action| FWD["Forwarded"]
    FWD -->|returned| CLAIM
    REJ -->|resend| NEW
    REJ -->|withdraw| CLOSED["Closed"]
    RES -->|reopen, within 14 days| NEW
    RES --> CLOSED
```

**Handlers** (anyone in the department the ticket is routed to) can:

- **Claim** a ticket to work on it, or **release** it back to the queue.
- **Resolve** it, or **reject** it back to the raiser.
- **Hand back** (return) it, or **transfer** it to another department.
- **Forward** it to another person or department for action, with a reply-by
  time. The forward can be returned with a reply or recalled by the forwarder.

**Raisers** can:

- **Resend** or **withdraw** a rejected ticket.
- **Reopen** a resolved ticket within 14 days, giving a reason and a new
  deadline.

**Admins** can close any ticket.

### SLA tracking and escalation

- The SLA clock runs from when a ticket is raised to its deadline, and
  **pauses** while the ticket is rejected or forwarded.
- When a ticket passes its deadline, the handling department's **Manager is
  alerted**.
- When a forward passes its reply-by time, both the **forwarder** and the
  **Manager on the receiving side** are alerted.

### Collaboration and notifications

- Each ticket has a **live chat thread** (SignalR) with read ticks, plus a
  full history of every action taken on it.
- Raisers, handlers and Managers get **email and web push notifications**;
  the installable PWA receives push on desktop, Android and iPhone/iPad.

### SLA report and customer ratings

The SLA report shows:

- Compliance by **priority**, **department** and **person**
- A **desk scorecard** for the customer service desk
- What is **overdue right now**
- **CSAT**: once a customer ticket is resolved, the customer receives an email
  with a one-tap link to rate it from 1 to 5. The rating page is public but
  token-gated, so only that customer can rate that ticket.

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

## Testing and CI

The frontend has unit tests (Vitest and Testing Library) and end-to-end tests
(Playwright) that include axe-core accessibility checks.

`Frontend/.github/workflows/ci.yml` defines two jobs: lint, format check,
contrast check, typecheck, unit tests, and build; then Playwright end-to-end
tests.

## Deployment

Production runs on one Azure VM (the Azure for Students free B1s), with
Docker Compose: Caddy, the Next.js web app, the .NET API, PostgreSQL, Redis,
and the ML jobs on cron. Caddy serves the frontend at `/` and the API at
`/api` over HTTPS. On every push to `main`, GitHub Actions
(`.github/workflows/deploy.yml`) rebuilds only the images whose code
changed, pushes them to GHCR and rolls the server forward. For the one-time setup, see [`deploy/README.md`](deploy/README.md).
