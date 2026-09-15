# Shared helpers for the ML batch jobs — used by anomaly_detection.py,
# usage_profiling.py, and forecasting.py (each independently runnable, so
# each can sit on its own schedule: e.g. anomaly detection every 24 hours,
# forecasting monthly, usage profiling every 6 months).
#
# Mirrors Backend/core/time.py / BackendDotNet/Core/Time.cs: naive UTC
# timestamps, and the shared UUID primary-key format both backends use.
# Every function elsewhere in this package takes a Backend (below) and
# reads/writes with raw SQL written in sqlite's '?' placeholder style —
# works unmodified against either backend's database, since both SQL
# schemas are mirrored 1:1 (see BackendDotNet/Models/TeleSpyDbContext.cs).
# Backend (Flask) is still SQLite; BackendDotNet is Postgres — Backend below
# hides that difference so the model files don't need to know which is which.
import sqlite3
import uuid
import warnings
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

import pandas as pd

# pandas only formally tests sqlite3/SQLAlchemy connections for
# read_sql_query; a raw psycopg2 connection works fine (it's a normal
# DBAPI2 connection) but triggers this warning on every query — silence it
# rather than letting it spam the scheduled jobs' logs.
warnings.filterwarnings(
    "ignore", message="pandas only supports SQLAlchemy connectable", category=UserWarning
)

CALL_CLASS_EXTERNAL = "External"
CALL_CLASS_INTERNATIONAL = "International"

TRAINING_DIR = Path(__file__).resolve().parent
REPO_ROOT = TRAINING_DIR.parent.parent

FLASK_SQLITE_PATH = REPO_ROOT / "Backend" / "instance" / "telespy.db"
DOTNET_ENV_PATH = REPO_ROOT / "BackendDotNet" / ".env"


def new_id() -> str:
    """36-char hyphenated UUID string — the same primary-key format both
    Python's uuid.uuid4() and .NET's Guid.NewGuid().ToString() produce, so
    rows created here are indistinguishable from rows either backend would
    have created itself."""
    return str(uuid.uuid4())


def now_str() -> str:
    """Naive UTC timestamp as 'YYYY-MM-DD HH:MM:SS.ffffff' — the exact
    text format SQLAlchemy's SQLite DATETIME type reads back into a Python
    datetime, and Npgsql reads into a Postgres `timestamp without time
    zone` column (see BackendDotNet/Models/TeleSpyDbContext.cs's
    ConfigureConventions). Both backends deliberately store naive UTC (see
    core/time.py's and Core/Time.cs's docstrings) — never write
    timezone-aware timestamps into either database."""
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")


class Backend:
    """One open DB connection plus the one thing that differs per driver:
    SQLite (sqlite3) uses '?' placeholders and a .execute() shorthand on
    the connection itself; Postgres (psycopg2) uses '%s' placeholders and
    requires a cursor. Model files write every query in '?' style; this
    class translates it for Postgres so that code never has to branch on
    which backend it's talking to."""

    def __init__(self, name: str, conn, is_postgres: bool):
        self.name = name
        self.conn = conn
        self.is_postgres = is_postgres

    def _adapt(self, sql: str) -> str:
        return sql.replace("?", "%s") if self.is_postgres else sql

    def execute(self, sql: str, params=()):
        cur = self.conn.cursor()
        cur.execute(self._adapt(sql), params)
        return cur

    def read_sql(self, sql: str, params=None) -> pd.DataFrame:
        return pd.read_sql_query(self._adapt(sql), self.conn, params=params)

    def commit(self) -> None:
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()


def _parse_env_file(path: Path) -> dict[str, str]:
    """Minimal KEY=VALUE .env reader (same files DotNetEnv/python-dotenv
    load for the backends themselves) — avoids adding a dependency just to
    read one connection string."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def _dotnet_database_url() -> str | None:
    """Reads BackendDotNet's own DATABASE_URL out of its .env — the exact
    same connection string the .NET app itself connects with, so there's
    only one place these credentials live."""
    return _parse_env_file(DOTNET_ENV_PATH).get("DATABASE_URL")


def _connect_postgres(database_url: str):
    import psycopg2

    parsed = urlparse(database_url.replace("postgres://", "postgresql://", 1))
    return psycopg2.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        dbname=parsed.path.lstrip("/"),
        user=unquote(parsed.username) if parsed.username else None,
        password=unquote(parsed.password) if parsed.password else None,
    )


def open_backend_connections():
    """Yields a Backend for each backend that's currently reachable,
    skipping (with a printed warning) any that aren't — e.g. a backend
    that hasn't been seeded/migrated yet."""
    if FLASK_SQLITE_PATH.exists():
        conn = sqlite3.connect(FLASK_SQLITE_PATH)
        try:
            yield Backend("Backend (Flask)", conn, is_postgres=False)
        finally:
            conn.close()
    else:
        print(f"[skip] Backend (Flask): no database at {FLASK_SQLITE_PATH} — seed it first.")

    database_url = _dotnet_database_url()
    if not database_url or not database_url.startswith(("postgres://", "postgresql://")):
        print(f"[skip] BackendDotNet (ASP.NET Core): no Postgres DATABASE_URL found in {DOTNET_ENV_PATH}")
        return
    conn = _connect_postgres(database_url)
    try:
        yield Backend("BackendDotNet (ASP.NET Core)", conn, is_postgres=True)
    finally:
        conn.close()
