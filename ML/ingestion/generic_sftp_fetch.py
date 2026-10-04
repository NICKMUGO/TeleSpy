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
from common import SeenFiles, landing_path, load_config, require  # this project's own shared helpers


def fetch() -> int:
    import paramiko  # SSH/SFTP library; imported here, not at module top, so importing this file
    # for its functions/constants doesn't force paramiko to be installed

    config = load_config()  # read ML/ingestion/.env into a dict
    # Pull the three mandatory settings; require() exits with a clear error if any are missing.
    host, user, remote_dir = require(config, "GENERIC_SFTP_HOST", "GENERIC_SFTP_USER", "GENERIC_SFTP_REMOTE_DIR")
    port = int(config.get("GENERIC_SFTP_PORT", "22"))  # SFTP runs over SSH; 22 is the standard SSH port
    password = config.get("GENERIC_SFTP_PASSWORD")  # optional: password auth
    key_path = config.get("GENERIC_SFTP_KEY_PATH")  # optional: private-key auth (preferred over password)
    if not password and not key_path:
        # Must have at least one way to authenticate.
        raise SystemExit("Set either GENERIC_SFTP_PASSWORD or GENERIC_SFTP_KEY_PATH in ML/ingestion/.env")
    # Which vendor this instance is configured for — used both to label
    # landed files and to give this vendor its own SeenFiles state file.
    vendor_label = config.get("GENERIC_SFTP_VENDOR_LABEL", "vendor")

    seen = SeenFiles(f"generic_sftp_{vendor_label}")  # loads (or starts) this vendor's "already fetched" list
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
                    # Already downloaded before, or a hidden/dotfile — skip either way.
                    continue
                # Build the full remote path; rstrip("/") avoids a doubled "//" if
                # remote_dir was configured with a trailing slash.
                remote_path = f"{remote_dir.rstrip('/')}/{filename}"
                # Where this file will land locally, prefixed with the vendor label
                # and the original filename kept as a suffix for traceability.
                local_path = landing_path(vendor_label, suffix=f"_{filename}")
                sftp.get(remote_path, str(local_path))  # the actual download
                seen.add(filename)  # remember it so a future run doesn't re-fetch it
                fetched += 1
                print(f"[{vendor_label} SFTP] fetched {filename} -> {local_path}")
            return fetched  # how many new files this run pulled down
        finally:
            sftp.close()  # always close the SFTP session, even if a download raised
    finally:
        transport.close()  # always close the SSH transport too, even if the above raised


def main() -> None:
    fetched = fetch()  # run one fetch pass
    print(f"[generic SFTP] {fetched} new file(s) landed in cdr_incoming/.")


if __name__ == "__main__":  # only run when executed directly, not on import
    main()
