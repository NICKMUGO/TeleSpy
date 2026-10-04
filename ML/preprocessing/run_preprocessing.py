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
# Path: object-oriented filesystem path handling (join with "/", .exists(),
# .iterdir(), etc.) instead of raw string concatenation.
from pathlib import Path

# numpy: used below for np.log1p() when scaling call duration.
import numpy as np
# pandas: the DataFrame/Series machinery this whole script is built on.
import pandas as pd

# __file__ is this script's own path; .resolve() makes it absolute,
# .parent.parent walks up from ML/preprocessing/ to ML/, then down into
# ML/data — so this works no matter what directory the script is launched
# from.
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
# Where new, not-yet-processed CDR files land (dropped by the ML/ingestion/
# connectors, or manually).
INCOMING_DIR = DATA_DIR / "cdr_incoming"
# Where the cleaned, appended-to CSV that downstream ML/billing scripts
# read lives.
PROCESSED_DIR = DATA_DIR / "processed"
# Where source files get moved once they've been folded into the processed
# CSV, so they aren't re-read next run.
ARCHIVE_DIR = DATA_DIR / "archive"

# The PBX's local timezone. CUCM logs call times as UTC epoch seconds;
# they're converted to this zone so date/orig_time (and billing's
# peak/off-peak window) are in Kenyan wall-clock time.
LOCAL_TIMEZONE = "Africa/Nairobi"

# How many interquartile ranges beyond Q1/Q3 counts as a duration outlier —
# see flag_outliers() below.
OUTLIER_IQR_MULTIPLIER = 1.5
# Pearson correlation above this, between two numeric columns, means one of
# them is redundant — see drop_redundant_columns() below.
REDUNDANCY_CORR_THRESHOLD = 0.9

# Maps every raw header spelling we've seen across the different CDR
# exports (lowercased, since the lookup below always lowercases first) onto
# one canonical column name. E.g. a file with header "Orig." and another
# with "orig" both end up as the "orig" column, so every downstream
# function only ever has to know one set of names.
RAW_COLUMNS = {
    # "date" already matches the canonical name, so it maps to itself.
    "date": "date",
    # Two different spacing/punctuation variants seen for the same column.
    "orig. time": "orig_time",
    "orig time": "orig_time",
    # Same idea for the originating-number column.
    "orig.": "orig",
    "orig": "orig",
    # And the destination-number column.
    "dest.": "dest",
    "dest": "dest",
    # The telco's own call-classification label (Internal/External/...).
    "call classification": "call_classification",
    # Two spellings of the duration column.
    "duration (sec)": "duration_sec",
    "duration": "duration_sec",
    # Per-call cost, only present on billed (non-internal-cluster) exports.
    "charge": "charge",
}
# The canonical column names every parsed file must end up with — just the
# unique values of RAW_COLUMNS above (a set, so duplicates like "orig"
# appearing twice collapse to one entry).
REQUIRED_COLUMNS = set(RAW_COLUMNS.values())
# File extensions load_incoming() will attempt to parse; anything else in
# cdr_incoming/ (e.g. a stray .pdf) is silently ignored.
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
    # Build a lowercased-header -> original-header lookup so the membership
    # checks and lookups below work no matter how this file capitalized its
    # column names.
    cols = {c.strip().lower(): c for c in raw.columns}
    # Neither telltale CUCM column is present, so this isn't a CUCM export
    # at all — return the DataFrame unchanged and let normalize_columns()
    # handle it as a regular telco export instead.
    if "datetimeorigination" not in cols or "callingpartynumber" not in cols:
        return raw

    # Copy before mutating, so the caller's original DataFrame/column
    # references aren't affected by the assignments below.
    raw = raw.copy()
    # CUCM's dateTime* columns are Unix epoch timestamps (seconds since
    # 1970, UTC) stored as text; convert to numeric first (errors="coerce"
    # turns anything unparseable into NaN instead of raising).
    origination = pd.to_numeric(raw[cols["datetimeorigination"]], errors="coerce")
    # The call's timestamp is when it was answered (dateTimeConnect), not
    # when the handset went off-hook (dateTimeOrigination) — `duration` is
    # itself measured from connect to disconnect, so peak/off-peak rating
    # should key off the same moment. dateTimeConnect is 0 for a call that
    # never connected (duration 0, dropped by billing anyway); fall back to
    # origination there so the row still gets a real timestamp.
    if "datetimeconnect" in cols:
        connect = pd.to_numeric(raw[cols["datetimeconnect"]], errors="coerce")
        call_epoch = connect.where(connect > 0, origination)
    else:
        call_epoch = origination
    # Epoch seconds are UTC; convert to Nairobi local time (EAT, UTC+3) so
    # the date/time columns — and the peak/off-peak window billing applies
    # to them — reflect the wall-clock time the call was actually made.
    call_time = pd.to_datetime(call_epoch, unit="s", utc=True).dt.tz_convert(LOCAL_TIMEZONE)
    # Split the single datetime back into separate date/time string columns
    # to match the rest of the pipeline's schema (RAW_COLUMNS expects
    # "date" and "orig_time" as two columns, not one timestamp).
    raw["date"] = call_time.dt.strftime("%Y-%m-%d")
    raw["orig_time"] = call_time.dt.strftime("%H:%M:%S")
    # CUCM's "callingPartyNumber" is this schema's "orig" (who placed the
    # call).
    raw["orig"] = raw[cols["callingpartynumber"]]
    # Prefer finalCalledPartyNumber (where the call actually ended up, e.g.
    # after a forward) and fall back to originalCalledPartyNumber (who was
    # dialled) if the final-party column isn't present in this export.
    dest_col = cols.get("finalcalledpartynumber") or cols.get("originalcalledpartynumber")
    raw["dest"] = raw[dest_col]
    if "duration" in cols:
        # Rename by copying into the canonical column name, then drop the
        # original-cased column so it isn't left behind as a duplicate.
        raw["duration_sec"] = raw[cols["duration"]]
        raw = raw.drop(columns=[cols["duration"]])
    raw["charge"] = 0  # CUCM CDRs carry no billing charge; internal calls bill at 0
    raw["call_classification"] = "Internal"  # this export is an internal cluster's own CDRs
    return raw


def normalize_columns(raw: pd.DataFrame) -> pd.DataFrame:
    # If this is a CUCM export, synthesize the columns normalize_columns()
    # needs first; for every other export this is a no-op (see the early
    # return inside derive_cucm_fields()).
    raw = derive_cucm_fields(raw)
    # For every column currently on the DataFrame, strip whitespace and
    # lowercase it, then look that up in RAW_COLUMNS to get the canonical
    # name — falling back to the lowercased-stripped name itself if it
    # isn't a known alias (so an already-canonical column like "date"
    # passes through unchanged).
    raw = raw.rename(columns={c: RAW_COLUMNS.get(c.strip().lower(), c.strip().lower()) for c in raw.columns})
    # Set difference: any canonical column this file still doesn't have
    # after renaming.
    missing = REQUIRED_COLUMNS - set(raw.columns)
    if missing:
        # Sorted purely so the error message is deterministic/readable,
        # not dependent on set iteration order.
        raise ValueError(f"missing expected columns: {sorted(missing)}")
    # Subset (and implicitly reorder) to just the columns downstream code
    # relies on — drops anything extra the source file happened to have.
    return raw[list(REQUIRED_COLUMNS)]


def read_one(path: Path) -> pd.DataFrame:
    # Tab-separated for .tsv files, comma-separated for everything else
    # (.csv and .txt are both treated as CSV here).
    sep = "\t" if path.suffix.lower() == ".tsv" else ","
    # dtype=str forces every column to be read as text rather than letting
    # pandas guess types — critical for phone-number-like columns, where
    # auto-inferring a number would silently drop a leading "0" or turn a
    # long digit string into scientific notation.
    file_df = pd.read_csv(path, sep=sep, dtype=str)
    # Rename/derive columns to the canonical schema (see above).
    file_df = normalize_columns(file_df)
    # Record which physical file each row came from, for traceability.
    file_df["source_file"] = path.name
    return file_df


def load_incoming() -> tuple[pd.DataFrame, list[Path]]:
    """Loads every supported file currently in cdr_incoming/. A file that
    doesn't match the expected CDR schema is skipped with a warning rather
    than failing the whole run, since the folder accumulates files from
    multiple connectors (CUCM, Avaya, generic) of mixed provenance."""
    # List every regular file in the incoming directory whose extension is
    # one we know how to parse, sorted for deterministic processing order.
    files = sorted(p for p in INCOMING_DIR.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS)
    # Successfully parsed DataFrames, one per file.
    frames = []
    # The subset of `files` that actually parsed (used later to know which
    # ones to archive).
    loaded_files = []
    for path in files:
        try:
            # Parse + normalize this one file and remember it succeeded.
            frames.append(read_one(path))
            loaded_files.append(path)
        except (ValueError, pd.errors.ParserError) as exc:
            # A malformed or unrecognised-schema file — skip it rather than
            # aborting the whole batch, and say why.
            print(f"skipping {path.name}: {exc}")

    # Stack every successfully-parsed file's rows into one DataFrame; if
    # nothing parsed, fall back to an empty DataFrame with the right
    # columns so callers can still safely check .empty / access columns.
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=list(REQUIRED_COLUMNS) + ["source_file"])
    return df, loaded_files


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Drop the never-populated QoS column, coerce types, and drop
    physically invalid records (negative duration/charge, unparseable
    timestamp)."""
    # errors="ignore" means this doesn't raise if "qos" isn't present —
    # some source files never had it in the first place.
    df = df.drop(columns=["qos"], errors="ignore")
    # Concatenate the separate date + time text columns into one string,
    # then parse into a real pandas datetime; errors="coerce" turns any
    # row whose date/time text doesn't parse into NaT instead of raising.
    df["call_timestamp"] = pd.to_datetime(df["date"].astype(str) + " " + df["orig_time"].astype(str), errors="coerce")
    # Coerce these text columns to numeric; anything non-numeric becomes
    # NaN rather than raising.
    df["duration_sec"] = pd.to_numeric(df["duration_sec"], errors="coerce")
    df["charge"] = pd.to_numeric(df["charge"], errors="coerce")

    # Row count before filtering, purely to log how many got dropped below.
    before = len(df)
    # Drop rows whose timestamp never parsed (NaT) — these are physically
    # meaningless records.
    df = df.dropna(subset=["call_timestamp"])
    # Keep only rows with non-negative duration and charge; fillna(0) means
    # a *missing* duration/charge doesn't get dropped here (0 >= 0 is
    # true), only a genuinely negative one does.
    df = df[(df["duration_sec"].fillna(0) >= 0) & (df["charge"].fillna(0) >= 0)]
    print(f"dropped {before - len(df)} noisy record(s), {len(df)} remain")
    return df


def flag_outliers(df: pd.DataFrame) -> pd.DataFrame:
    """Flag statistical outliers in call duration via IQR fencing — not
    removed, since these are exactly what Isolation Forest anomaly
    detection needs to see downstream."""
    # Q1 (25th percentile) and Q3 (75th percentile) of call duration.
    q1, q3 = df["duration_sec"].quantile([0.25, 0.75])
    # Interquartile range: the spread of the middle 50% of the data.
    iqr = q3 - q1
    # Classic Tukey fence: anything more than OUTLIER_IQR_MULTIPLIER IQRs
    # below Q1 or above Q3 counts as an outlier.
    lower, upper = q1 - OUTLIER_IQR_MULTIPLIER * iqr, q3 + OUTLIER_IQR_MULTIPLIER * iqr
    # .between() is True for values inside [lower, upper]; the leading `~`
    # inverts it, so is_outlier is True for anything *outside* the fence.
    df["is_outlier"] = ~df["duration_sec"].between(lower, upper)
    print(f"{df['is_outlier'].sum()} of {len(df)} records flagged as duration outliers")
    return df


def drop_redundant_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Drop one column from any pair of numeric columns whose Pearson
    correlation exceeds REDUNDANCY_CORR_THRESHOLD."""
    # Only numeric columns can be correlated against each other.
    numeric = df.select_dtypes(include="number")
    # Full pairwise Pearson correlation matrix, absolute value (a strong
    # negative correlation is just as redundant as a strong positive one).
    corr = numeric.corr(method="pearson").abs()
    # Column names queued for removal.
    to_drop = set()
    # Iterate every unique pair of columns (col_b always comes after col_a
    # in the column list, so each pair is only considered once).
    for i, col_a in enumerate(corr.columns):
        for col_b in corr.columns[i + 1:]:
            # If either column in this pair is already marked for removal
            # (from an earlier, related pair), skip re-evaluating it.
            if col_a in to_drop or col_b in to_drop:
                continue
            if corr.loc[col_a, col_b] > REDUNDANCY_CORR_THRESHOLD:
                # Arbitrarily drop the second column of the pair, keeping
                # the first.
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
    # Force the column's possible categories to the fixed list, regardless
    # of which of those values are actually present in this particular
    # batch — this is what makes the one-hot columns below consistent
    # across runs.
    df["call_classification"] = pd.Categorical(df["call_classification"], categories=CALL_CLASSIFICATIONS)
    # One-hot encode: replaces the single call_classification column with
    # one boolean column per category (call_class_Internal,
    # call_class_External, etc.), each True/False for whether that row was
    # that classification.
    df = pd.get_dummies(df, columns=["call_classification"], prefix="call_class")

    # log1p(x) = log(1 + x) — avoids log(0) being undefined for zero-second
    # calls, and compresses duration's long right tail (a handful of very
    # long calls) toward a more bell-shaped distribution. fillna(0) treats
    # a still-missing duration as zero at this point.
    log_duration = np.log1p(df["duration_sec"].fillna(0))
    # Standard deviation of the log-transformed values, used for z-score
    # standardization next.
    std = log_duration.std()
    # Standard z-score: (x - mean) / std, giving zero mean and unit
    # variance — but only if std is non-zero (a batch where every call has
    # identical duration would otherwise divide by zero), in which case
    # every value is just set to 0.0.
    df["duration_sec_scaled"] = (log_duration - log_duration.mean()) / std if std else 0.0
    return df


def run() -> int:
    """Returns the number of records appended to cdr_preprocessed.csv."""
    # Read + normalize every file currently sitting in cdr_incoming/.
    df, files = load_incoming()
    print(f"loaded {len(df)} records from {len(files)} file(s)")
    if df.empty:
        # Nothing new landed since the last run — nothing to do.
        print("nothing new in cdr_incoming/ — skipping.")
        return 0

    # Run the cleaning pipeline stage by stage, each step returning a new
    # (or same, mutated) DataFrame for the next step to build on.
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

    # Make sure the output directory exists before writing to it.
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
        # Load whatever was already written by previous runs.
        existing = pd.read_csv(out_path)
        # Stack the old and new data; ignore_index=True renumbers the
        # combined row index from 0 rather than keeping two overlapping
        # index ranges.
        df = pd.concat([existing, df], ignore_index=True)
        for col in df.columns:
            if col.startswith("call_class_") or col == "is_outlier":
                # After concat, a boolean column that's missing from one
                # side becomes NaN for those rows, which silently upcasts
                # the whole column to dtype=object. Route through pandas'
                # nullable "boolean" dtype (which can represent NaN) first,
                # fill those gaps with False, then collapse back down to a
                # plain bool column.
                df[col] = df[col].astype("boolean").fillna(False).astype(bool)
    # Write the combined (or first-run) data back out, overwriting the
    # file; index=False so pandas doesn't add its own row-number column.
    df.to_csv(out_path, index=False)

    # Make sure the archive directory exists before moving files into it.
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    for path in files:
        # Move (not copy) each successfully-processed source file into the
        # archive, so cdr_incoming/ only ever contains genuinely new,
        # not-yet-processed files for the next run.
        path.rename(ARCHIVE_DIR / path.name)

    print(f"wrote {len(df)} record(s) -> {out_path}")
    return len(df)


def main() -> None:
    # Run the whole pipeline once and report how many records it wrote.
    written = run()
    print(f"Preprocessing: {written} record(s) appended to cdr_preprocessed.csv.")


if __name__ == "__main__":
    # Only run when executed directly (e.g. `python run_preprocessing.py`
    # or from cron), not when imported by something else.
    main()
