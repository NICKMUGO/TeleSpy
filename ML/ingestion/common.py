# Shared helpers for the CDR fetch connectors — cucm_sftp_fetch.py,
# generic_sftp_fetch.py, avaya_cdr_listener.py. Every connector's only job
# is landing raw vendor files into ML/data/cdr_incoming/, in whatever
# format the vendor provides them, untouched — ML/preprocessing/ is what
# already knows how to clean/normalize/append them
# (ML/data/processed/cdr_preprocessed.csv), and ML/training/billing.py is
# what already knows how to cost them. Nothing here talks to a database.
import json
from datetime import datetime
from pathlib import Path

INGESTION_DIR = Path(__file__).resolve().parent
REPO_ROOT = INGESTION_DIR.parent.parent
CDR_INCOMING_DIR = REPO_ROOT / "ML" / "data" / "cdr_incoming"
STATE_DIR = INGESTION_DIR / "state"
ENV_PATH = INGESTION_DIR / ".env"


def _parse_env_file(path: Path) -> dict[str, str]:
    """Minimal KEY=VALUE .env reader — same convention as
    ML/training/common.py and both backends' own .env loaders."""
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


def load_config() -> dict[str, str]:
    """Reads ML/ingestion/.env — copy .env.example there and fill in real
    values (gitignored, same as every other .env in this project)."""
    return _parse_env_file(ENV_PATH)


def require(config: dict[str, str], *keys: str) -> list[str]:
    """Fail fast with a clear message if required config is missing,
    rather than a confusing connection error later."""
    missing = [k for k in keys if not config.get(k)]
    if missing:
        raise SystemExit(
            f"Missing required setting(s) in {ENV_PATH}: {', '.join(missing)}. "
            f"Copy .env.example to .env in ML/ingestion/ and fill them in."
        )
    return [config[k] for k in keys]


def landing_path(source_label: str, suffix: str = ".csv") -> Path:
    """A fresh, collision-free filename in cdr_incoming/ for one fetched
    batch — timestamped so the preprocessing step's archive-after-ingest
    step never clobbers an earlier file from the same source."""
    CDR_INCOMING_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
    return CDR_INCOMING_DIR / f"{source_label}_{stamp}{suffix}"


class SeenFiles:
    """Tracks which remote filenames a pull connector (SFTP) has already
    fetched, in a small local JSON file — so re-running the connector
    (e.g. the next cron tick) only pulls what's new, without needing write
    access to rename/delete anything on the remote server."""

    def __init__(self, state_name: str):
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        self._path = STATE_DIR / f"{state_name}.json"
        self._seen: set[str] = set(json.loads(self._path.read_text())) if self._path.exists() else set()

    def __contains__(self, name: str) -> bool:
        return name in self._seen

    def add(self, name: str) -> None:
        self._seen.add(name)
        self._path.write_text(json.dumps(sorted(self._seen)))
