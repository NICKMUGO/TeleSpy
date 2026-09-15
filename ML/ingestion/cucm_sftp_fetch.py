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
from common import SeenFiles, landing_path, load_config, require

SOURCE_LABEL = "cucm"


def fetch() -> int:
    import paramiko

    config = load_config()
    host, user, remote_dir = require(config, "CUCM_SFTP_HOST", "CUCM_SFTP_USER", "CUCM_SFTP_REMOTE_DIR")
    port = int(config.get("CUCM_SFTP_PORT", "22"))
    password = config.get("CUCM_SFTP_PASSWORD")
    key_path = config.get("CUCM_SFTP_KEY_PATH")
    if not password and not key_path:
        raise SystemExit("Set either CUCM_SFTP_PASSWORD or CUCM_SFTP_KEY_PATH in ML/ingestion/.env")

    seen = SeenFiles("cucm_sftp")
    transport = paramiko.Transport((host, port))
    try:
        if key_path:
            transport.connect(username=user, pkey=paramiko.RSAKey.from_private_key_file(key_path))
        else:
            transport.connect(username=user, password=password)
        sftp = paramiko.SFTPClient.from_transport(transport)
        try:
            fetched = 0
            for filename in sftp.listdir(remote_dir):
                if filename in seen or filename.startswith("."):
                    continue
                remote_path = f"{remote_dir.rstrip('/')}/{filename}"
                local_path = landing_path(SOURCE_LABEL, suffix=f"_{filename}")
                sftp.get(remote_path, str(local_path))
                seen.add(filename)
                fetched += 1
                print(f"[CUCM SFTP] fetched {filename} -> {local_path}")
            return fetched
        finally:
            sftp.close()
    finally:
        transport.close()


def main() -> None:
    fetched = fetch()
    print(f"[CUCM SFTP] {fetched} new file(s) landed in cdr_incoming/.")


if __name__ == "__main__":
    main()
