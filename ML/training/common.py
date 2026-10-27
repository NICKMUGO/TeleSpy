# Shared helpers for the ML batch jobs — used by anomaly_detection.py,
# usage_profiling.py, and forecasting.py (each independently runnable, so
# each can sit on its own schedule: anomaly detection every 24 hours,
# forecasting and usage profiling every 3 months — see deploy/ml.crontab).
#
# Mirrors BackendDotNet/Core/Time.cs: naive UTC timestamps, and the shared
# UUID primary-key format the backend uses. Every function elsewhere in
# this package takes a Backend (below) and reads/writes with raw SQL
# written in sqlite's '?' placeholder style — Backend below adapts that to
# '%s' when the connection is Postgres, so model files never have to
# branch on which driver they're talking to.
# uuid: generates the same-format primary keys the backend uses.
import uuid
# warnings: lets us silence one specific noisy pandas warning below.
import warnings
# datetime: used to build naive UTC timestamp strings.
from datetime import datetime
# Path: filesystem path handling for locating the repo root / .env file.
from pathlib import Path
# unquote/urlparse: used to pull host/port/user/password back out of a
# Postgres connection-string URL.
from urllib.parse import unquote, urlparse

# pandas: used for read_sql_query (turning a SQL result into a DataFrame).
import pandas as pd

# pandas only formally tests sqlite3/SQLAlchemy connections for
# read_sql_query; a raw psycopg2 connection works fine (it's a normal
# DBAPI2 connection) but triggers this warning on every query — silence it
# rather than letting it spam the scheduled jobs' logs.
# Register the filter: suppress that exact UserWarning message everywhere
# in this process from now on.
warnings.filterwarnings(
    "ignore", message="pandas only supports SQLAlchemy connectable", category=UserWarning
)

# Call-classification label constants, reused by callers that need to
# check "is this row External or International" without hardcoding strings.
CALL_CLASS_EXTERNAL = "External"
CALL_CLASS_INTERNATIONAL = "International"

# TRAINING_DIR: the absolute path of the directory this file lives in
# (ML/training).
TRAINING_DIR = Path(__file__).resolve().parent
# REPO_ROOT: two directories up from ML/training, i.e. the repository root.
REPO_ROOT = TRAINING_DIR.parent.parent

# Path to BackendDotNet's own .env file, read (not loaded into os.environ)
# purely to pull its DATABASE_URL out below.
DOTNET_ENV_PATH = REPO_ROOT / "BackendDotNet" / ".env"


def new_id() -> str:
    """36-char hyphenated UUID string — the same primary-key format both
    Python's uuid.uuid4() and .NET's Guid.NewGuid().ToString() produce, so
    rows created here are indistinguishable from rows either backend would
    have created itself."""
    # Generate a random UUID (version 4) and format it as the standard
    # 36-character hyphenated string, e.g. "3fa85f64-5717-4562-...".
    return str(uuid.uuid4())


def now_str() -> str:
    """Naive UTC timestamp as 'YYYY-MM-DD HH:MM:SS.ffffff' — the exact
    text format SQLAlchemy's SQLite DATETIME type reads back into a Python
    datetime, and Npgsql reads into a Postgres `timestamp without time
    zone` column (see BackendDotNet/Models/TeleSpyDbContext.cs's
    ConfigureConventions). Both backends deliberately store naive UTC (see
    core/time.py's and Core/Time.cs's docstrings) — never write
    timezone-aware timestamps into either database."""
    # Get the current UTC time as a naive datetime, then format it as
    # "YYYY-MM-DD HH:MM:SS.microseconds".
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")


class Backend:
    """One open DB connection plus the one thing that differs per driver:
    SQLite (sqlite3) uses '?' placeholders and a .execute() shorthand on
    the connection itself; Postgres (psycopg2) uses '%s' placeholders and
    requires a cursor. Model files write every query in '?' style; this
    class translates it for Postgres so that code never has to branch on
    which backend it's talking to."""

    def __init__(self, name: str, conn, is_postgres: bool):
        # Human-readable label for this connection, used in log/print
        # output (e.g. "BackendDotNet (ASP.NET Core)").
        self.name = name
        # The underlying DB-API connection object (sqlite3 or psycopg2).
        self.conn = conn
        # Flag driving the '?' -> '%s' placeholder translation below.
        self.is_postgres = is_postgres

    def _adapt(self, sql: str) -> str:
        # Postgres uses %s placeholders; sqlite uses ?. Swap them only when
        # talking to Postgres, otherwise return the SQL unchanged.
        return sql.replace("?", "%s") if self.is_postgres else sql

    def execute(self, sql: str, params=()):
        # Open a new cursor on the connection.
        cur = self.conn.cursor()
        # Run the (placeholder-adapted) SQL with the given parameters.
        cur.execute(self._adapt(sql), params)
        # Return the cursor so the caller can fetchone()/fetchall() from it.
        return cur

    def read_sql(self, sql: str, params=None) -> pd.DataFrame:
        # Run the query via pandas, returning the result set directly as a
        # DataFrame instead of a raw cursor.
        return pd.read_sql_query(self._adapt(sql), self.conn, params=params)

    def commit(self) -> None:
        # Persist any pending writes on this connection.
        self.conn.commit()

    def close(self) -> None:
        # Close the underlying DB connection.
        self.conn.close()


def _parse_env_file(path: Path) -> dict[str, str]:
    """Minimal KEY=VALUE .env reader (same files DotNetEnv/python-dotenv
    load for the backends themselves) — avoids adding a dependency just to
    read one connection string."""
    # Result dict, KEY -> VALUE, built up as we scan the file.
    values: dict[str, str] = {}
    # No .env file at all (e.g. not configured yet) -> return empty dict.
    if not path.exists():
        return values
    # Read the whole file and split it into individual lines.
    for line in path.read_text().splitlines():
        # Strip leading/trailing whitespace from this line.
        line = line.strip()
        # Skip blank lines, comment lines (#...), and anything without an
        # "=" (not a KEY=VALUE pair).
        if not line or line.startswith("#") or "=" not in line:
            continue
        # Split on the first "=" only: key is everything before it, value
        # is everything after.
        key, _, value = line.partition("=")
        # Store the trimmed key/value pair.
        values[key.strip()] = value.strip()
    return values


def _dotnet_database_url() -> str | None:
    """Reads BackendDotNet's own DATABASE_URL out of its .env — the exact
    same connection string the .NET app itself connects with, so there's
    only one place these credentials live."""
    # Parse BackendDotNet's .env file and pull out just the DATABASE_URL
    # value (None if the file or key is missing).
    return _parse_env_file(DOTNET_ENV_PATH).get("DATABASE_URL")


def _connect_postgres(database_url: str):
    # Imported here (not at module level) so this file doesn't hard-require
    # psycopg2 to be installed unless a Postgres connection is actually
    # attempted.
    import psycopg2

    # Normalize the "postgres://" scheme to "postgresql://" (urlparse/some
    # drivers expect the longer form), then split the URL into its parts
    # (host, port, path, username, password).
    parsed = urlparse(database_url.replace("postgres://", "postgresql://", 1))
    # Open the actual Postgres connection using the parsed pieces, with a
    # default port of 5432 and URL-decoded (unquote) credentials.
    return psycopg2.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        dbname=parsed.path.lstrip("/"),
        user=unquote(parsed.username) if parsed.username else None,
        password=unquote(parsed.password) if parsed.password else None,
    )


def open_backend_connections():
    """Yields a Backend for BackendDotNet if it's currently reachable,
    skipping (with a printed warning) if it isn't — e.g. its database
    hasn't been migrated/seeded yet. A generator (not a single connect
    call) so callers keep the `for backend in open_backend_connections():`
    shape even though there's only one backend now."""
    # Read BackendDotNet's configured connection string, if any.
    database_url = _dotnet_database_url()
    # No URL, or it's not a Postgres one (e.g. blank, or a sqlite DSN) ->
    # print a warning and stop the generator (yields nothing).
    if not database_url or not database_url.startswith(("postgres://", "postgresql://")):
        print(f"[skip] BackendDotNet (ASP.NET Core): no Postgres DATABASE_URL found in {DOTNET_ENV_PATH}")
        return
    # Open the real Postgres connection.
    conn = _connect_postgres(database_url)
    try:
        # Hand a wrapped Backend to the caller (via the `for backend in
        # open_backend_connections():` loop) — execution pauses here until
        # the caller's loop body finishes or moves to the next iteration.
        yield Backend("BackendDotNet (ASP.NET Core)", conn, is_postgres=True)
    finally:
        # Always close the connection once the caller is done with it,
        # even if the loop body raised an exception.
        conn.close()
