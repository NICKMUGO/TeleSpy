#!/usr/bin/env python3
"""Fetch CDR files via SFTP from any vendor that just drops files into a
directory rather than streaming — a batch/pull connector, meant to run on
a schedule (cron), not continuously.

This covers most PBX/gateway vendors that aren't CUCM or Avaya: Mitel
(SMDR export to file), many SBC/gateway CDR exports, 3CX's scheduled CDR
export, cloud UCaaS platforms that offer bulk file export instead of (or
alongside) a REST API — anything where "the vendor periodically drops a
CSV/text file somewhere reachable over SFTP" is the whole integration.
Same mechanics as cucm_sftp_fetch.py, just generic: it doesn't assume
CUCM's specific export format, and ML/preprocessing/'s RAW_COLUMNS mapping
is what has to recognize whatever column names this vendor's file actually
uses (see that module for how to add a new vendor's column names).

Configure one vendor per .env (GENERIC_SFTP_*) — for more than one
non-CUCM/Avaya source, copy this file per vendor with its own state name,
or extend load_config() to key settings by a vendor prefix.

Run standalone:
    python generic_sftp_fetch.py

Recommended: cron, matching how often the vendor actually produces new
files (ask them, or start daily and tighten if you see backlog).
"""
from common import SeenFiles, landing_path, load_config, require


def fetch() -> int:
    import paramiko

    config = load_config()
    host, user, remote_dir = require(config, "GENERIC_SFTP_HOST", "GENERIC_SFTP_USER", "GENERIC_SFTP_REMOTE_DIR")
    port = int(config.get("GENERIC_SFTP_PORT", "22"))
    password = config.get("GENERIC_SFTP_PASSWORD")
    key_path = config.get("GENERIC_SFTP_KEY_PATH")
    if not password and not key_path:
        raise SystemExit("Set either GENERIC_SFTP_PASSWORD or GENERIC_SFTP_KEY_PATH in ML/ingestion/.env")
    vendor_label = config.get("GENERIC_SFTP_VENDOR_LABEL", "vendor")

    seen = SeenFiles(f"generic_sftp_{vendor_label}")
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
                local_path = landing_path(vendor_label, suffix=f"_{filename}")
                sftp.get(remote_path, str(local_path))
                seen.add(filename)
                fetched += 1
                print(f"[{vendor_label} SFTP] fetched {filename} -> {local_path}")
            return fetched
        finally:
            sftp.close()
    finally:
        transport.close()


def main() -> None:
    fetched = fetch()
    print(f"[generic SFTP] {fetched} new file(s) landed in cdr_incoming/.")


if __name__ == "__main__":
    main()
