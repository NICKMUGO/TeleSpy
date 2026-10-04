# Shared helpers for the CDR fetch connectors — cucm_sftp_fetch.py,
# generic_sftp_fetch.py, avaya_cdr_listener.py. Every connector's only job
# is landing raw vendor files into ML/data/cdr_incoming/, in whatever
# format the vendor provides them, untouched — ML/preprocessing/ is what
# already knows how to clean/normalize/append them
# (ML/data/processed/cdr_preprocessed.csv), and ML/training/billing.py is
# what already knows how to cost them. Nothing here talks to a database.
import json  # for reading/writing the SeenFiles state file below
from datetime import datetime  # for timestamping landed filenames
from pathlib import Path  # for all filesystem path handling in this module

# __file__ is this common.py's own path; .resolve() makes it absolute,
# .parent is the ML/ingestion/ directory it lives in.
INGESTION_DIR = Path(__file__).resolve().parent
# Two levels up from ML/ingestion/ is the repo root (ML/ingestion -> ML -> repo root).
REPO_ROOT = INGESTION_DIR.parent.parent
# Where every connector below drops its fetched/received files.
CDR_INCOMING_DIR = REPO_ROOT / "ML" / "data" / "cdr_incoming"
# Where SeenFiles (below) persists its "already fetched" bookkeeping between runs.
STATE_DIR = INGESTION_DIR / "state"
# Per-connector secrets (SFTP host/user/password, etc.) live here, not in code.
ENV_PATH = INGESTION_DIR / ".env"


def _parse_env_file(path: Path) -> dict[str, str]:
    """Minimal KEY=VALUE .env reader — same convention as
    ML/training/common.py and both backends' own .env loaders."""
    values: dict[str, str] = {}  # accumulates KEY -> VALUE as we read lines
    if not path.exists():
        # No .env file yet (e.g. fresh checkout) — return an empty config
        # rather than raising; require() below is what actually complains,
        # with a clearer message pointing at what to do about it.
        return values
    for line in path.read_text().splitlines():  # read the whole file, split into lines
        line = line.strip()  # drop leading/trailing whitespace on this line
        # Skip blank lines, "# comment" lines, and anything without a "="
        # (i.e. not a KEY=VALUE pair).
        if not line or line.startswith("#") or "=" not in line:
            continue  # nothing to parse on this line, move to the next one
        # partition splits on the FIRST "=" only, so a value that itself
        # contains "=" (e.g. a base64 secret) isn't truncated.
        key, _, value = line.partition("=")  # _, is the "=" separator itself, discarded
        values[key.strip()] = value.strip()  # store, trimming stray whitespace around each side
    return values  # the fully parsed KEY -> VALUE map


def load_config() -> dict[str, str]:
    """Reads ML/ingestion/.env — copy .env.example there and fill in real
    values (gitignored, same as every other .env in this project)."""
    return _parse_env_file(ENV_PATH)  # delegate to the generic parser above, pointed at our .env


def require(config: dict[str, str], *keys: str) -> list[str]:
    """Fail fast with a clear message if required config is missing,
    rather than a confusing connection error later."""
    # Any requested key that's missing or empty in config gets collected here.
    missing = [k for k in keys if not config.get(k)]
    if missing:  # at least one required key wasn't set
        # SystemExit (not a regular exception) so this prints the message
        # and exits cleanly with a non-zero status when run as a script,
        # instead of dumping a Python traceback.
        raise SystemExit(
            f"Missing required setting(s) in {ENV_PATH}: {', '.join(missing)}. "
            f"Copy .env.example to .env in ML/ingestion/ and fill them in."
        )
    # Caller does `host, user, remote_dir = require(config, "HOST", "USER", "DIR")` —
    # returns the values in the same order the keys were asked for.
    return [config[k] for k in keys]


def landing_path(source_label: str, suffix: str = ".csv") -> Path:
    """A fresh, collision-free filename in cdr_incoming/ for one fetched
    batch — timestamped so the preprocessing step's archive-after-ingest
    step never clobbers an earlier file from the same source."""
    # exist_ok=True: don't error if cdr_incoming/ is already there (the
    # normal case) — only create it the first time. parents=True creates
    # any missing parent directories too (ML/data/ etc.) in one call.
    CDR_INCOMING_DIR.mkdir(parents=True, exist_ok=True)
    # Microsecond-precision timestamp packed into the filename itself, so
    # two files landed moments apart never collide.
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
    # e.g. cucm_20260921T091530123456.csv — source label, timestamp, extension.
    return CDR_INCOMING_DIR / f"{source_label}_{stamp}{suffix}"


class SeenFiles:
    """Tracks which remote filenames a pull connector (SFTP) has already
    fetched, in a small local JSON file — so re-running the connector
    (e.g. the next cron tick) only pulls what's new, without needing write
    access to rename/delete anything on the remote server."""

    def __init__(self, state_name: str):
        # e.g. state_name="cucm_sftp" -> ML/ingestion/state/cucm_sftp.json —
        # one small JSON file per connector, so each keeps its own "seen" list.
        STATE_DIR.mkdir(parents=True, exist_ok=True)  # ensure state/ exists before we try to read/write into it
        self._path = STATE_DIR / f"{state_name}.json"  # this instance's own state file
        # Load the previously-seen filenames from disk (a JSON array) into
        # an in-memory set for fast "have I fetched this before?" lookups;
        # on first-ever run the file doesn't exist yet, so start empty.
        self._seen: set[str] = set(json.loads(self._path.read_text())) if self._path.exists() else set()

    # Lets callers write `if filename in seen:` directly on a SeenFiles
    # instance, instead of `if filename in seen._seen:`.
    def __contains__(self, name: str) -> bool:
        return name in self._seen  # O(1) set membership check

    def add(self, name: str) -> None:
        self._seen.add(name)  # remember this filename in memory
        # Rewrite the whole state file on every add — these lists are small
        # (one connector's recent filenames), so this is simpler and safer
        # than an append-only log that could get out of sync with `_seen`.
        # sorted() just keeps the JSON output deterministic/diff-friendly.
        self._path.write_text(json.dumps(sorted(self._seen)))  # persist immediately, not batched
