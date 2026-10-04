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
import csv  # for writing flushed records out to a CSV landing file
import socket  # raw TCP server socket for accepting Avaya's connection
import threading  # background flush timer + a lock protecting the shared row buffer
from datetime import datetime, timezone  # for timestamping each ingested record

from common import landing_path, load_config  # this project's own shared helpers

SOURCE_LABEL = "avaya"  # prefix used on every flushed landing filename

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
        self._lock = threading.Lock()  # guards self._rows against the socket thread and timer thread racing
        self._rows: list[dict] = []  # parsed-but-not-yet-written records, one dict per CDR
        self._flush_records = flush_records  # flush early if this many rows accumulate (see add() below)
        self._stop = threading.Event()  # signals the background timer thread to exit
        # Daemon thread: won't keep the process alive on its own if the main
        # thread exits — this timer just calls flush() periodically forever.
        self._timer_thread = threading.Thread(target=self._flush_loop, args=(flush_seconds,), daemon=True)
        self._timer_thread.start()  # starts running _flush_loop immediately, in the background

    def _flush_loop(self, flush_seconds: int) -> None:
        # Event.wait(timeout) blocks for up to flush_seconds, returning True
        # early only if stop() sets the event — so this loops "flush every
        # flush_seconds" until told to stop.
        while not self._stop.wait(flush_seconds):
            self.flush()

    def add(self, row: dict) -> None:
        with self._lock:  # only one thread touches self._rows at a time
            self._rows.append(row)  # buffer this record rather than writing immediately
            due = len(self._rows) >= self._flush_records  # have we hit the size-based flush threshold?
        if due:
            self.flush()  # flush outside the lock, so add() calls from other threads aren't blocked by file I/O

    def flush(self) -> None:
        with self._lock:
            if not self._rows:
                return  # nothing buffered — nothing to write
            # Atomically swap out the buffer for an empty list, keeping the
            # old contents in `rows` — so new records can keep arriving via
            # add() while this flush writes the old batch to disk.
            rows, self._rows = self._rows, []
        path = landing_path(SOURCE_LABEL)  # a fresh timestamped CSV path for this batch
        # Not every record necessarily has the exact same keys (e.g. one
        # extra field on an unusual row) — union all keys across the batch
        # so DictWriter has a complete column list, sorted for stable output.
        fieldnames = sorted({key for row in rows for key in row})
        with path.open("w", newline="") as f:  # newline="" is the standard csv module recommendation on write
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()  # column names as the first CSV row
            writer.writerows(rows)  # one CSV row per buffered record
        print(f"[Avaya] flushed {len(rows)} record(s) -> {path}")

    def stop(self) -> None:
        self._stop.set()  # tells _flush_loop's wait() to return True and exit the loop
        self.flush()  # write out whatever's still buffered before the process exits


def _parse_delimited(line: str, field_order: list[str], delimiter: str) -> dict:
    values = [v.strip() for v in line.split(delimiter)]  # split the raw line, trim whitespace off each piece
    if len(values) < len(field_order):
        # Fewer values than expected columns — this line doesn't match the
        # administered format; raise so the caller logs and skips it.
        raise ValueError(f"expected {len(field_order)} {delimiter!r}-delimited fields, got {len(values)}")
    # Pairs each column name with its value positionally, e.g.
    # zip(["date","orig"], ["20260921","206"]) -> {"date": "20260921", "orig": "206"}.
    # If there are MORE values than names, zip just ignores the extras.
    return dict(zip(field_order, values))


def _parse_fixed_width(line: str, field_spec: list[tuple[str, int, int]]) -> dict:
    """field_spec: list of (name, start, end), 0-indexed / end-exclusive —
    from AVAYA_CDR_FIELD_SPEC, e.g. "date:0:6,orig_time:6:10,...". Must
    match the fixed-width layout actually administered on the Avaya
    system."""
    # The furthest "end" position across every field tells us the minimum
    # line length that could possibly contain all of them.
    required_length = max(end for _, _, end in field_spec)
    if len(line) < required_length:
        raise ValueError(f"expected at least {required_length} character(s), got {len(line)}")
    # For each (name, start, end) triple, slice out that character range and
    # trim padding whitespace — fixed-width formats pad fields to a fixed size.
    return {name: line[start:end].strip() for name, start, end in field_spec}


def _build_parser(config: dict):
    # Decides once, at startup, which of the two parse functions above this
    # run should use, and returns it pre-configured (a closure) so the hot
    # per-line loop in read_stream() below doesn't re-check config each time.
    fmt = config.get("AVAYA_CDR_FORMAT", "delimited")
    if fmt == "fixed_width":
        spec_raw = config.get("AVAYA_CDR_FIELD_SPEC", "")  # e.g. "date:0:6,orig_time:6:10,..."
        spec = []
        for part in spec_raw.split(","):  # split into individual "name:start:end" chunks
            name, start, end = part.split(":")  # split each chunk into its three pieces
            spec.append((name, int(start), int(end)))  # start/end are text in the .env value; convert to int
        if not spec:
            # AVAYA_CDR_FIELD_SPEC was empty/missing — fixed-width parsing is impossible without it.
            raise SystemExit("AVAYA_CDR_FORMAT=fixed_width requires AVAYA_CDR_FIELD_SPEC (see .env.example)")
        # Returns a one-argument function (just `line`) with `spec` already baked in.
        return lambda line: _parse_fixed_width(line, spec)

    # Default path: delimited format (e.g. comma-separated).
    delimiter = config.get("AVAYA_CDR_DELIMITER", ",")
    # Use the configured field order if set, otherwise fall back to
    # DEFAULT_FIELD_ORDER; either way, split the comma-separated names into a list.
    field_order = (config.get("AVAYA_CDR_FIELD_ORDER") or ",".join(DEFAULT_FIELD_ORDER)).split(",")
    # Returns a one-argument function (just `line`) with field_order/delimiter already baked in.
    return lambda line: _parse_delimited(line, field_order, delimiter)


def read_stream(conn: socket.socket, parser, buffer: RecordBuffer) -> None:
    """Reads newline-delimited records off one connection until the peer
    closes it or the link drops. One malformed line is logged and
    skipped, never fatal — a single bad record must not take down the
    link."""
    remainder = ""  # holds a partial (not-yet-newline-terminated) line carried over between recv() calls
    while True:  # keep reading until the connection closes or errors
        chunk = conn.recv(4096)  # read up to 4096 bytes off the socket (may be less, or a partial record)
        if not chunk:  # recv() returning empty bytes means the peer closed the connection
            return
        # Avaya CDR streams are plain ASCII; errors="replace" swaps any
        # unexpected byte for a placeholder character instead of crashing.
        remainder += chunk.decode("ascii", errors="replace")
        # Split on newlines; the LAST element after split is whatever comes
        # after the final "\n" so far — an incomplete line — which becomes
        # the new `remainder` to prepend to on the next recv(). Everything
        # before that is a complete, ready-to-parse line.
        *lines, remainder = remainder.split("\n")
        for line in lines:  # process each complete line pulled out above
            line = line.strip("\r").strip()  # drop a trailing \r (CRLF line endings) and any stray whitespace
            if not line:
                continue  # blank line — nothing to parse
            try:
                record = parser(line)  # the delimited/fixed-width parser chosen by _build_parser()
            except Exception as exc:  # noqa: BLE001 - one malformed line must not kill the link
                print(f"[Avaya] skipped unparseable line ({exc}): {line!r}")
                continue  # move on to the next line rather than aborting the whole stream
            # setdefault: only fills this in if the parser didn't already
            # produce an "ingested_at" field itself.
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
            buffer.add(record)  # hand the finished record off to the RecordBuffer


def serve_forever(host: str, port: int, parser, buffer: RecordBuffer) -> None:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)  # IPv4, TCP — a normal listening socket
    # Lets the socket rebind to the same port immediately after a restart,
    # instead of failing with "address already in use" while the OS still
    # has the old socket in TIME_WAIT.
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))  # claim this host/port combination
    server.listen(1)  # start listening; backlog of 1 is enough since Avaya opens one link at a time
    print(f"[Avaya] listening on {host}:{port} for the CDR adjunct link...")

    while True:  # accept a new connection forever — Avaya reconnects if the link drops
        conn, addr = server.accept()  # blocks here until Avaya connects; returns the new socket + its address
        print(f"[Avaya] connection from {addr[0]}:{addr[1]}")
        try:
            read_stream(conn, parser, buffer)  # blocks here for the life of this one connection
        except (ConnectionError, OSError) as exc:
            # The link dropped unexpectedly (network blip, Avaya restart,
            # etc.) — log it and fall through to retry via the outer loop.
            print(f"[Avaya] connection lost ({exc}); waiting for reconnect...")
        finally:
            conn.close()  # release this connection's socket
            buffer.flush()  # don't hold records hostage across a dropped link
            print("[Avaya] connection closed; waiting for reconnect...")


def main() -> None:
    config = load_config()  # read ML/ingestion/.env into a dict
    host = config.get("AVAYA_LISTEN_HOST", "0.0.0.0")  # 0.0.0.0 = listen on every network interface
    port = int(config.get("AVAYA_LISTEN_PORT", "9000"))  # must match the port administered on the Avaya side
    flush_seconds = int(config.get("AVAYA_FLUSH_SECONDS", "60"))  # time-based flush interval
    flush_records = int(config.get("AVAYA_FLUSH_RECORDS", "500"))  # size-based flush threshold

    parser = _build_parser(config)  # the delimited/fixed-width line parser, chosen once up front
    buffer = RecordBuffer(flush_seconds, flush_records)  # starts its own background flush timer immediately
    try:
        serve_forever(host, port, parser, buffer)  # runs until killed (Ctrl-C, systemd stop, etc.)
    finally:
        buffer.stop()  # on the way out, stop the timer thread and flush whatever's left buffered


if __name__ == "__main__":  # only run when executed directly, not on import
    main()
