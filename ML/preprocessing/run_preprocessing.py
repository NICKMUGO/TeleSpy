#!/usr/bin/env python3
"""Standalone script version of cdr_preprocessing.ipynb — reads every CDR
file dropped into ML/data/cdr_incoming/ (by the fetch connectors under
ML/ingestion/, or dropped there manually), cleans/normalizes/encodes them,
appends the result to ML/data/processed/cdr_preprocessed.csv, and archives
the source files so the next run only picks up what's new.

The notebook still exists for interactive/manual exploration — this is the
unattended path, meant to run on a schedule (cron) between the fetch
connectors landing new files and ML/training/billing.py's monthly run, so
cdr_preprocessed.csv stays continuously up to date rather than piling up a
month's backlog right before billing runs.

Run standalone:
    python run_preprocessing.py
"""
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INCOMING_DIR = DATA_DIR / "cdr_incoming"
PROCESSED_DIR = DATA_DIR / "processed"
ARCHIVE_DIR = DATA_DIR / "archive"

OUTLIER_IQR_MULTIPLIER = 1.5
REDUNDANCY_CORR_THRESHOLD = 0.9

RAW_COLUMNS = {
    "date": "date",
    "orig. time": "orig_time",
    "orig time": "orig_time",
    "orig.": "orig",
    "orig": "orig",
    "dest.": "dest",
    "dest": "dest",
    "call classification": "call_classification",
    "duration (sec)": "duration_sec",
    "duration": "duration_sec",
    "charge": "charge",
}
REQUIRED_COLUMNS = set(RAW_COLUMNS.values())
SUPPORTED_EXTENSIONS = {".csv", ".txt", ".tsv"}

# Fixed regardless of which values actually appear in a given run's batch —
# pd.get_dummies() only creates a column for a value it actually sees, so
# without pinning the full set here, two runs with different classification
# values present (e.g. a CUCM-only historical batch vs. a later batch that
# also has Avaya's "Unknown" placeholder) produce different column counts,
# and appending the second to the first's CSV corrupts it (a real bug this
# surfaced: "Expected 10 fields, saw 11").
CALL_CLASSIFICATIONS = ["Internal", "External", "International", "Unknown"]


def derive_cucm_fields(raw: pd.DataFrame) -> pd.DataFrame:
    """Map a real Cisco CallManager CDR export onto the columns
    normalize_columns() expects.

    This export's own column names (dateTimeOrigination, callingPartyNumber,
    finalCalledPartyNumber, duration, ...) don't match RAW_COLUMNS, and it
    has no call-classification/charge columns at all since it's an
    internal cluster's own CDRs, not a billed telco feed."""
    cols = {c.strip().lower(): c for c in raw.columns}
    if "datetimeorigination" not in cols or "callingpartynumber" not in cols:
        return raw

    raw = raw.copy()
    origination = pd.to_datetime(pd.to_numeric(raw[cols["datetimeorigination"]], errors="coerce"), unit="s")
    raw["date"] = origination.dt.strftime("%Y-%m-%d")
    raw["orig_time"] = origination.dt.strftime("%H:%M:%S")
    raw["orig"] = raw[cols["callingpartynumber"]]
    dest_col = cols.get("finalcalledpartynumber") or cols.get("originalcalledpartynumber")
    raw["dest"] = raw[dest_col]
    if "duration" in cols:
        raw["duration_sec"] = raw[cols["duration"]]
        raw = raw.drop(columns=[cols["duration"]])
    raw["charge"] = 0  # CUCM CDRs carry no billing charge; internal calls bill at 0
    raw["call_classification"] = "Internal"  # this export is an internal cluster's own CDRs
    return raw


def normalize_columns(raw: pd.DataFrame) -> pd.DataFrame:
    raw = derive_cucm_fields(raw)
    raw = raw.rename(columns={c: RAW_COLUMNS.get(c.strip().lower(), c.strip().lower()) for c in raw.columns})
    missing = REQUIRED_COLUMNS - set(raw.columns)
    if missing:
        raise ValueError(f"missing expected columns: {sorted(missing)}")
    return raw[list(REQUIRED_COLUMNS)]


def read_one(path: Path) -> pd.DataFrame:
    sep = "\t" if path.suffix.lower() == ".tsv" else ","
    file_df = pd.read_csv(path, sep=sep, dtype=str)
    file_df = normalize_columns(file_df)
    file_df["source_file"] = path.name
    return file_df


def load_incoming() -> tuple[pd.DataFrame, list[Path]]:
    """Loads every supported file currently in cdr_incoming/. A file that
    doesn't match the expected CDR schema is skipped with a warning rather
    than failing the whole run, since the folder accumulates files from
    multiple connectors (CUCM, Avaya, generic) of mixed provenance."""
    files = sorted(p for p in INCOMING_DIR.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS)
    frames = []
    loaded_files = []
    for path in files:
        try:
            frames.append(read_one(path))
            loaded_files.append(path)
        except (ValueError, pd.errors.ParserError) as exc:
            print(f"skipping {path.name}: {exc}")

    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=list(REQUIRED_COLUMNS) + ["source_file"])
    return df, loaded_files


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Drop the never-populated QoS column, coerce types, and drop
    physically invalid records (negative duration/charge, unparseable
    timestamp)."""
    df = df.drop(columns=["qos"], errors="ignore")
    df["call_timestamp"] = pd.to_datetime(df["date"].astype(str) + " " + df["orig_time"].astype(str), errors="coerce")
    df["duration_sec"] = pd.to_numeric(df["duration_sec"], errors="coerce")
    df["charge"] = pd.to_numeric(df["charge"], errors="coerce")

    before = len(df)
    df = df.dropna(subset=["call_timestamp"])
    df = df[(df["duration_sec"].fillna(0) >= 0) & (df["charge"].fillna(0) >= 0)]
    print(f"dropped {before - len(df)} noisy record(s), {len(df)} remain")
    return df


def flag_outliers(df: pd.DataFrame) -> pd.DataFrame:
    """Flag statistical outliers in call duration via IQR fencing — not
    removed, since these are exactly what Isolation Forest anomaly
    detection needs to see downstream."""
    q1, q3 = df["duration_sec"].quantile([0.25, 0.75])
    iqr = q3 - q1
    lower, upper = q1 - OUTLIER_IQR_MULTIPLIER * iqr, q3 + OUTLIER_IQR_MULTIPLIER * iqr
    df["is_outlier"] = ~df["duration_sec"].between(lower, upper)
    print(f"{df['is_outlier'].sum()} of {len(df)} records flagged as duration outliers")
    return df


def drop_redundant_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Drop one column from any pair of numeric columns whose Pearson
    correlation exceeds REDUNDANCY_CORR_THRESHOLD."""
    numeric = df.select_dtypes(include="number")
    corr = numeric.corr(method="pearson").abs()
    to_drop = set()
    for i, col_a in enumerate(corr.columns):
        for col_b in corr.columns[i + 1:]:
            if col_a in to_drop or col_b in to_drop:
                continue
            if corr.loc[col_a, col_b] > REDUNDANCY_CORR_THRESHOLD:
                to_drop.add(col_b)
    print(f"dropping redundant column(s): {sorted(to_drop) or 'none'}")
    return df.drop(columns=list(to_drop))


def encode_and_scale(df: pd.DataFrame) -> pd.DataFrame:
    """One-hot encode call_classification, then log-transform + standardize
    duration_sec (long right tail from a handful of very long calls).
    call_classification is pinned to CALL_CLASSIFICATIONS (a fixed
    Categorical) rather than left to whatever values this batch happens to
    contain, so every run produces the same call_class_* columns — see the
    comment on CALL_CLASSIFICATIONS for why that matters."""
    df["call_classification"] = pd.Categorical(df["call_classification"], categories=CALL_CLASSIFICATIONS)
    df = pd.get_dummies(df, columns=["call_classification"], prefix="call_class")

    log_duration = np.log1p(df["duration_sec"].fillna(0))
    std = log_duration.std()
    df["duration_sec_scaled"] = (log_duration - log_duration.mean()) / std if std else 0.0
    return df


def run() -> int:
    """Returns the number of records appended to cdr_preprocessed.csv."""
    df, files = load_incoming()
    print(f"loaded {len(df)} records from {len(files)} file(s)")
    if df.empty:
        print("nothing new in cdr_incoming/ — skipping.")
        return 0

    df = clean(df)
    df = flag_outliers(df)
    df = drop_redundant_columns(df)
    df = encode_and_scale(df)
    # Charge isn't predictive for usage-pattern analysis (nearly all
    # internal calls bill at 0) and was only kept around for the
    # redundancy check above. Call records are NOT deduplicated: the same
    # two extensions can legitimately call each other multiple times a
    # day, so identical rows are real, distinct events.
    df = df.drop(columns=["charge"], errors="ignore")

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PROCESSED_DIR / "cdr_preprocessed.csv"
    # Read + concat + rewrite rather than a blind CSV append: pandas'
    # mode="a" never checks that this batch's columns match the existing
    # file's, so any drift (a value/column this batch has that no earlier
    # batch did, or vice versa) silently corrupts the file — exactly what
    # broke testing this against a mixed CUCM+Avaya batch. concat() aligns
    # columns properly (filling gaps with NaN/False) regardless of which
    # values each side happened to contain. The file is small enough
    # (tens of thousands of rows) that a full rewrite each run is cheap.
    if out_path.exists():
        existing = pd.read_csv(out_path)
        df = pd.concat([existing, df], ignore_index=True)
        for col in df.columns:
            if col.startswith("call_class_") or col == "is_outlier":
                df[col] = df[col].astype("boolean").fillna(False).astype(bool)
    df.to_csv(out_path, index=False)

    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    for path in files:
        path.rename(ARCHIVE_DIR / path.name)

    print(f"wrote {len(df)} record(s) -> {out_path}")
    return len(df)


def main() -> None:
    written = run()
    print(f"Preprocessing: {written} record(s) appended to cdr_preprocessed.csv.")


if __name__ == "__main__":
    main()
