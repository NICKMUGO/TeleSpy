#!/usr/bin/env python3
"""Real-time CDR collector for Avaya Communication Manager / Aura / IP
Office — a push/streaming connector, meant to run continuously as a
service (systemd), never as a cron job.

Why real-time, not batch: Avaya's CDR "adjunct" link is a persistent TCP
connection *Avaya makes to you* (configured on the Avaya system: the CDR
link's IP/port via `change ip-services`, the record format via
`change system-parameters cdr`) — Avaya streams one CDR record per
completed call over that connection as it happens, with no batch/file
alternative built in. This script is the server side of that link: it
binds and listens, accepts Avaya's connection, and parses records as they
arrive.

The exact record layout is configurable *on the Avaya system itself*
(`display system-parameters cdr` shows what's actually administered —
"customized", "int-direct", "isdn-enhanced", etc.) — there is no one true
Avaya CDR format, so this doesn't assume one. It defaults to a
comma-delimited layout (the common case for a "customized" format) with a
configurable field order (AVAYA_CDR_FIELD_ORDER); set
AVAYA_CDR_FORMAT=fixed_width (with AVAYA_CDR_FIELD_SPEC) if the
administered format is fixed-width instead. Verify against
`display system-parameters cdr` on the real system before trusting this.

Bridges the real-time stream into the same file-based pipeline the batch
connectors use: buffers parsed records and flushes them to a timestamped
CSV in ML/data/cdr_incoming/ every AVAYA_FLUSH_SECONDS (default 60) or
AVAYA_FLUSH_RECORDS (default 500), whichever comes first — so
ML/preprocessing/ and ML/training/billing.py need no changes to consume
Avaya data alongside CUCM's.

Run standalone (stays running until killed):
    python avaya_cdr_listener.py

Recommended: a systemd service with Restart=always (see
ML/ingestion/systemd/telespy-avaya-listener.service) — NOT cron. A
persistent socket listener that must reconnect automatically and never
miss an in-progress call is exactly what cron *can't* do (cron starts a
new process on a schedule and expects it to exit; this process is meant to
never exit).
"""
import csv
import socket
import threading
from datetime import datetime, timezone

from common import landing_path, load_config

SOURCE_LABEL = "avaya"

# Default field order for AVAYA_CDR_FORMAT=delimited — override via
# AVAYA_CDR_FIELD_ORDER (comma-separated) to match what's actually
# administered. Unrecognized/extra fields are kept as extra columns rather
# than dropped, so nothing is silently lost.
DEFAULT_FIELD_ORDER = ["date", "orig_time", "duration_sec", "orig", "dest", "condition_code"]


class RecordBuffer:
    """Thread-safe accumulator that flushes to a landing file when full,
    or on a background timer — so records aren't held indefinitely during
    a quiet period with no new calls. Decouples the socket-reading thread
    from file I/O."""

    def __init__(self, flush_seconds: int, flush_records: int):
        self._lock = threading.Lock()
        self._rows: list[dict] = []
        self._flush_records = flush_records
        self._stop = threading.Event()
        self._timer_thread = threading.Thread(target=self._flush_loop, args=(flush_seconds,), daemon=True)
        self._timer_thread.start()

    def _flush_loop(self, flush_seconds: int) -> None:
        while not self._stop.wait(flush_seconds):
            self.flush()

    def add(self, row: dict) -> None:
        with self._lock:
            self._rows.append(row)
            due = len(self._rows) >= self._flush_records
        if due:
            self.flush()

    def flush(self) -> None:
        with self._lock:
            if not self._rows:
                return
            rows, self._rows = self._rows, []
        path = landing_path(SOURCE_LABEL)
        fieldnames = sorted({key for row in rows for key in row})
        with path.open("w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"[Avaya] flushed {len(rows)} record(s) -> {path}")

    def stop(self) -> None:
        self._stop.set()
        self.flush()


def _parse_delimited(line: str, field_order: list[str], delimiter: str) -> dict:
    values = [v.strip() for v in line.split(delimiter)]
    if len(values) < len(field_order):
        raise ValueError(f"expected {len(field_order)} {delimiter!r}-delimited fields, got {len(values)}")
    return dict(zip(field_order, values))


def _parse_fixed_width(line: str, field_spec: list[tuple[str, int, int]]) -> dict:
    """field_spec: list of (name, start, end), 0-indexed / end-exclusive —
    from AVAYA_CDR_FIELD_SPEC, e.g. "date:0:6,orig_time:6:10,...". Must
    match the fixed-width layout actually administered on the Avaya
    system."""
    required_length = max(end for _, _, end in field_spec)
    if len(line) < required_length:
        raise ValueError(f"expected at least {required_length} character(s), got {len(line)}")
    return {name: line[start:end].strip() for name, start, end in field_spec}


def _build_parser(config: dict):
    fmt = config.get("AVAYA_CDR_FORMAT", "delimited")
    if fmt == "fixed_width":
        spec_raw = config.get("AVAYA_CDR_FIELD_SPEC", "")
        spec = []
        for part in spec_raw.split(","):
            name, start, end = part.split(":")
            spec.append((name, int(start), int(end)))
        if not spec:
            raise SystemExit("AVAYA_CDR_FORMAT=fixed_width requires AVAYA_CDR_FIELD_SPEC (see .env.example)")
        return lambda line: _parse_fixed_width(line, spec)

    delimiter = config.get("AVAYA_CDR_DELIMITER", ",")
    field_order = (config.get("AVAYA_CDR_FIELD_ORDER") or ",".join(DEFAULT_FIELD_ORDER)).split(",")
    return lambda line: _parse_delimited(line, field_order, delimiter)


def read_stream(conn: socket.socket, parser, buffer: RecordBuffer) -> None:
    """Reads newline-delimited records off one connection until the peer
    closes it or the link drops. One malformed line is logged and
    skipped, never fatal — a single bad record must not take down the
    link."""
    remainder = ""
    while True:
        chunk = conn.recv(4096)
        if not chunk:  # peer closed
            return
        remainder += chunk.decode("ascii", errors="replace")
        *lines, remainder = remainder.split("\n")
        for line in lines:
            line = line.strip("\r").strip()
            if not line:
                continue
            try:
                record = parser(line)
            except Exception as exc:  # noqa: BLE001 - one malformed line must not kill the link
                print(f"[Avaya] skipped unparseable line ({exc}): {line!r}")
                continue
            record.setdefault("ingested_at", datetime.now(timezone.utc).isoformat())
            # ML/preprocessing/run_preprocessing.py requires these columns
            # on every landed file (see its RAW_COLUMNS/REQUIRED_COLUMNS) —
            # CUCM's export gets them from derive_cucm_fields(); Avaya's
            # doesn't provide either in this raw stream, and
            # ML/training/billing.py recomputes call_classification from
            # orig/dest itself regardless, so these are just placeholders
            # satisfying the shared schema, not used for costing.
            record.setdefault("call_classification", "Unknown")
            record.setdefault("charge", 0)
            buffer.add(record)


def serve_forever(host: str, port: int, parser, buffer: RecordBuffer) -> None:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen(1)
    print(f"[Avaya] listening on {host}:{port} for the CDR adjunct link...")

    while True:  # accept a new connection forever — Avaya reconnects if the link drops
        conn, addr = server.accept()
        print(f"[Avaya] connection from {addr[0]}:{addr[1]}")
        try:
            read_stream(conn, parser, buffer)
        except (ConnectionError, OSError) as exc:
            print(f"[Avaya] connection lost ({exc}); waiting for reconnect...")
        finally:
            conn.close()
            buffer.flush()  # don't hold records hostage across a dropped link
            print("[Avaya] connection closed; waiting for reconnect...")


def main() -> None:
    config = load_config()
    host = config.get("AVAYA_LISTEN_HOST", "0.0.0.0")
    port = int(config.get("AVAYA_LISTEN_PORT", "9000"))
    flush_seconds = int(config.get("AVAYA_FLUSH_SECONDS", "60"))
    flush_records = int(config.get("AVAYA_FLUSH_RECORDS", "500"))

    parser = _build_parser(config)
    buffer = RecordBuffer(flush_seconds, flush_records)
    try:
        serve_forever(host, port, parser, buffer)
    finally:
        buffer.stop()


if __name__ == "__main__":
    main()
