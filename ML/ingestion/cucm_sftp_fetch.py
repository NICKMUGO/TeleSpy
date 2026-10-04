#!/usr/bin/env python3
"""Fetch CDR files from a Cisco CUCM (Unified Communications Manager)
billing server via SFTP — a batch/pull connector, meant to run on a
schedule (cron / systemd timer), not continuously.

Why batch, not real-time: CUCM has no live CDR API. It periodically writes
CDR files to its own CDR Repository, and — when CDR Repository Manager is
configured with a "Billing Application Server" destination — pushes copies
out via FTP/SFTP on an interval you configure in CUCM itself (Cisco
Unified Serviceability > Tools > CDR Management), typically every few
minutes to an hour. This script is the *pull* side: it connects to
whatever SFTP endpoint receives those files (CUCM's own repository, or an
intermediary file server) and downloads anything new into
ML/data/cdr_incoming/, where ML/preprocessing/ already knows how to parse
CUCM's export format (see derive_cucm_fields() in
ML/preprocessing/cdr_preprocessing.ipynb / run_preprocessing.py).

Run standalone:
    python cucm_sftp_fetch.py

Recommended: cron, matching (or a bit more often than) CUCM's own configured
CDR file interval — see ML/ingestion/README (or the project's crontab) for
the actual schedule in use.
"""
from common import SeenFiles, landing_path, load_config, require  # this project's own shared helpers

SOURCE_LABEL = "cucm"  # prefix used on every landed filename, and the state-file name below


def fetch() -> int:
    import paramiko  # SSH/SFTP library; imported here (not at module top) so just importing this
    # file (e.g. to read SOURCE_LABEL elsewhere) doesn't require paramiko to be installed

    config = load_config()  # read ML/ingestion/.env into a dict
    # Pull the three mandatory settings; require() exits with a clear error if any are missing.
    host, user, remote_dir = require(config, "CUCM_SFTP_HOST", "CUCM_SFTP_USER", "CUCM_SFTP_REMOTE_DIR")
    port = int(config.get("CUCM_SFTP_PORT", "22"))  # SFTP runs over SSH; 22 is the standard SSH port
    password = config.get("CUCM_SFTP_PASSWORD")  # optional: password auth
    key_path = config.get("CUCM_SFTP_KEY_PATH")  # optional: private-key auth (preferred over password)
    if not password and not key_path:
        # Must have at least one way to authenticate.
        raise SystemExit("Set either CUCM_SFTP_PASSWORD or CUCM_SFTP_KEY_PATH in ML/ingestion/.env")

    seen = SeenFiles("cucm_sftp")  # loads (or starts) this connector's "already fetched" list
    transport = paramiko.Transport((host, port))  # the underlying SSH connection (not yet authenticated)
    try:
        if key_path:
            # Key-based auth: load the private key file, then authenticate with it.
            transport.connect(username=user, pkey=paramiko.RSAKey.from_private_key_file(key_path))
        else:
            # Password auth: simpler, but less secure than a key.
            transport.connect(username=user, password=password)
        sftp = paramiko.SFTPClient.from_transport(transport)  # SFTP session layered on the SSH transport
        try:
            fetched = 0  # counts how many new files we actually downloaded this run
            for filename in sftp.listdir(remote_dir):  # every filename currently in the remote directory
                if filename in seen or filename.startswith("."):
                    # Already downloaded before, or a hidden/dotfile (e.g. ".", "..", a
                    # lockfile) — skip either way.
                    continue
                # Build the full remote path; rstrip("/") avoids a doubled "//" if
                # remote_dir was configured with a trailing slash.
                remote_path = f"{remote_dir.rstrip('/')}/{filename}"
                # Where this file will land locally, prefixed with "cucm_" and the
                # original filename kept as a suffix for traceability.
                local_path = landing_path(SOURCE_LABEL, suffix=f"_{filename}")
                sftp.get(remote_path, str(local_path))  # the actual download
                seen.add(filename)  # remember it so a future run doesn't re-fetch it
                fetched += 1
                print(f"[CUCM SFTP] fetched {filename} -> {local_path}")
            return fetched  # how many new files this run pulled down
        finally:
            sftp.close()  # always close the SFTP session, even if a download raised
    finally:
        transport.close()  # always close the SSH transport too, even if the above raised


def main() -> None:
    fetched = fetch()  # run one fetch pass
    print(f"[CUCM SFTP] {fetched} new file(s) landed in cdr_incoming/.")


if __name__ == "__main__":  # only run when executed directly (`python cucm_sftp_fetch.py`), not on import
    main()
