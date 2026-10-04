#!/usr/bin/env python3
"""Call-cost computation (billing) — standalone batch job.

The single source of truth for call rates (local/internal/external/
international) and for turning a raw CDR dataset row into a KES cost
figure. Recomputes usage_summaries.total_cost (+ extension_code) directly
from the CDR dataset CSV — not from the live usage_events table — for
every employee whose extension_code appears as a call's origin anywhere
in that dataset ("calculate based on origin").

This supersedes Backend/services/billing.py and
BackendDotNet/Services/Billing.cs, which have been removed: CdrIngest /
CdrController no longer price calls or touch usage_summaries at ingest
time (usage_events.computed_cost is left at 0) — this script is now the
only place a KES figure gets attached to usage, and usage_summaries only
reflects reality as of this script's last run, not live as calls come in.

Classification mirrors Backend/services/call_classification.py exactly
(same regexes): International call > External (Kenyan) call > Internal
(bare 3-digit extension) > Unknown. Only External/International calls are
chargeable; Internal and Unknown are always 0, even though this dataset
carries no telco-provided `charge` column and no per-SIM plan rate to
apply — cost here is purely classification + duration * rate, where the
rate itself comes from the database (`billing_settings` for local
peak/off-peak, `international_call_rates` per country code — see the
"Call rating" section below), not a hardcoded constant, so an Admin's
PATCH /call-rates/local or /call-rates/international/<country_code> edit
takes effect the next time this script runs.

Run standalone:
    python billing.py
"""
# re: used throughout for the phone-number classification regexes.
import re

# pandas: used to load/transform the CDR dataset as a DataFrame.
import pandas as pd

# Backend: connection wrapper type; new_id/now_str: shared id/timestamp
# helpers; open_backend_connections: yields the live BackendDotNet
# connection; REPO_ROOT: absolute path of the repository root.
from common import Backend, new_id, now_str, open_backend_connections, REPO_ROOT

# Full path to the parsed CDR CSV this whole module reads from.
CDR_DATASET_PATH = REPO_ROOT / "ML" / "data" / "processed" / "cdr_preprocessed.csv"

# --- Call classification -------------------------------------------------
# The real dial plan behind this data (confirmed against the actual
# dataset, and standard for Cisco CUCM-style PBXes — "9" as the trunk
# access code for *any* outside-line call, local or international, is a
# near-universal convention going back to analog PBXes and still the
# default pattern in CUCM route plans like "9.@"/"9.0011!"):
#
#   - Bare 3-digit code (206, 389, 400, ...)        -> Internal, never billed
#   - "9" + local Kenyan number (0 + 9 digits)       -> External (local)
#   - "9" + IDD marker (+/00/000) + 254 + number     -> External (local,
#     dialled in full international form — Kenya's own country code)
#   - "9" + IDD marker (+/00/000) + other cc+number  -> International
#   - "9" + a country code directly, no IDD marker   -> International (seen
#     in ~4% of this dataset's real values, e.g. "912249561257" = 9 + "1"
#     NANP + subscriber number — some dial peers log the post-translation
#     digits without the IDD marker at all)
#
# A trailing "#" (seen on ~15% of dest/orig values in this dataset) is a
# dial-termination digit, not part of the number: CUCM route patterns using
# the "!" variable-length wildcard normally wait out an inter-digit timeout
# before routing, and "#" is the standard way a caller signals "done
# dialling" immediately instead — a well-documented CUCM behavior, stripped
# here before classification.
# Regex: a leading "0" followed by exactly 9 more digits (10 digits total)
# — plain Kenyan local number format.
KENYAN_LOCAL_NUMBER_REGEX = r"^0\d{9}$"
# Regex: exactly 3 digits, nothing else — a bare PBX extension.
INTERNAL_EXTENSION_REGEX = r"^\d{3}$"

# The four possible classification outcomes, as plain strings.
CALL_CLASS_INTERNAL = "Internal"
CALL_CLASS_EXTERNAL = "External"
CALL_CLASS_INTERNATIONAL = "International"
CALL_CLASS_UNKNOWN = "Unknown"

# Pre-compiled regex objects (compiling once at import time is cheaper than
# re-compiling on every call to classify_number()).
_KENYAN_LOCAL_RE = re.compile(KENYAN_LOCAL_NUMBER_REGEX)
_INTERNAL_RE = re.compile(INTERNAL_EXTENSION_REGEX)
_IDD_MARKERS = ("000", "00", "+")  # longest first, so "000" isn't left as a stray "0" after "00" matches


def _strip_dial_terminator(number: str) -> str:
    # If the number ends in "#", drop that last character; otherwise
    # return it unchanged.
    return number[:-1] if number.endswith("#") else number


def _strip_idd_marker(digits: str) -> str:
    """Remove a leading IDD marker (+/00/000) if present; otherwise return
    digits unchanged (the "no marker, direct country code" case)."""
    # Check each marker, longest first; if `digits` starts with it, return
    # everything after that marker.
    for marker in _IDD_MARKERS:
        if digits.startswith(marker):
            return digits[len(marker):]
    # None of the markers matched — return the input unchanged.
    return digits


# Recognised E.164 country/territory (dial) codes — the same list seeded
# into international_call_rates (see international_call_rates.json next to
# this file), kept here as a plain static set too since classify_number()/
# classify_call() must stay pure, backend-independent functions (called
# per CDR row, with no DB access) — only used to decide whether a number
# past the IDD marker is a real destination (-> International) or not
# (-> Unknown). Actual per-country pricing comes from the DB table (see
# _lookup_international_rate below), not from this set.
RECOGNIZED_COUNTRY_CODES = frozenset({
    "1", "7", "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44",
    "45", "46", "47", "48", "49", "51", "52", "54", "55", "56", "57", "58", "60", "61", "62",
    "63", "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98",
    "211", "212", "213", "216", "218", "220", "221", "222", "223", "224", "225", "226", "227",
    "228", "229", "230", "231", "232", "233", "234", "235", "236", "237", "238", "239", "240",
    "241", "242", "243", "244", "245", "246", "247", "248", "249", "250", "251", "252", "253",
    "255", "256", "257", "258", "260", "261", "262", "263", "264", "265", "266", "267", "268",
    "269", "290", "291", "297", "298", "299", "350", "351", "352", "353", "354", "355", "356",
    "358", "359", "370", "371", "372", "373", "374", "375", "376", "377", "378", "380", "381",
    "382", "386", "387", "389", "420", "421", "423", "500", "501", "502", "503", "504", "505",
    "507", "508", "509", "590", "591", "592", "593", "594", "595", "596", "597", "598", "599",
    "670", "672", "673", "674", "675", "676", "677", "678", "679", "680", "681", "682", "683",
    "685", "686", "687", "688", "689", "690", "691", "692", "850", "852", "853", "855", "856",
    "870", "871", "872", "873", "874", "880", "881", "882", "886", "960", "961", "962", "963",
    "964", "965", "966", "967", "968", "970", "971", "972", "973", "974", "975", "976", "977",
    "992", "993", "994", "995", "996", "998", "1242", "1246", "1264", "1268", "1284", "1340",
    "1345", "1441", "1473", "1649", "1658", "1664", "1670", "1671", "1684", "1758", "1767",
    "1784", "1787", "1808", "1809", "1829", "1849", "1868", "1869", "1876", "1907", "1939",
    "34928",
})
# Longest recognised country code is 5 digits (e.g. "34928") — caps how far
# the prefix-matching loop below needs to search.
RECOGNIZED_COUNTRY_CODE_MAX_LEN = 5


def _is_recognized_country_code(digits: str) -> bool:
    # Try progressively shorter prefixes of `digits` (5 chars, then 4, ...
    # down to 1), so the longest matching country code wins.
    for length in range(min(RECOGNIZED_COUNTRY_CODE_MAX_LEN, len(digits)), 0, -1):
        # digits[:length] is that prefix; check it against the known set.
        if digits[:length] in RECOGNIZED_COUNTRY_CODES:
            return True
    # No prefix length matched a known country code.
    return False


def classify_number(number) -> str:
    # Empty/None input, or pandas' float NaN (how a missing CSV cell shows
    # up), can't be classified.
    if not number or (isinstance(number, float) and pd.isna(number)):
        return CALL_CLASS_UNKNOWN
    # Coerce to string, strip whitespace/spaces, then drop a trailing "#".
    number = _strip_dial_terminator(str(number).strip().replace(" ", ""))
    # Nothing left after cleaning -> unclassifiable.
    if not number:
        return CALL_CLASS_UNKNOWN

    # Exactly 3 digits -> a bare PBX extension, dialled internally.
    if _INTERNAL_RE.match(number):
        return CALL_CLASS_INTERNAL

    # Anything else must start with the "9" trunk-access digit and have at
    # least one digit after it, or it can't be classified further.
    if not number.startswith("9") or len(number) < 2:
        return CALL_CLASS_UNKNOWN
    rest = number[1:]  # drop the trunk-access digit

    # After the "9", a plain 10-digit Kenyan local number -> External.
    if _KENYAN_LOCAL_RE.match(rest):
        return CALL_CLASS_EXTERNAL

    # Otherwise, strip off an IDD marker (+/00/000) if present, leaving
    # just the (supposed) country code + subscriber number.
    digits = _strip_idd_marker(rest)
    if digits.startswith("254"):
        # Kenya's own country code, dialled in full international form —
        # normalise to local form and bill as a local Kenyan call.
        # Rebuild it as a local "0..." number by dropping "254" and
        # prefixing "0" instead.
        local_form = "0" + digits[3:]
        # Only treat it as External if that reconstruction is actually a
        # valid 10-digit local number; otherwise it's malformed -> Unknown.
        return CALL_CLASS_EXTERNAL if _KENYAN_LOCAL_RE.match(local_form) else CALL_CLASS_UNKNOWN
    # Not Kenya's code — International if the remaining digits start with
    # a recognised country code, Unknown otherwise.
    return CALL_CLASS_INTERNATIONAL if _is_recognized_country_code(digits) else CALL_CLASS_UNKNOWN


def classify_call(orig, dest) -> str:
    """Identical rule to Backend's classify_call(): `orig` is always the
    internal PBX extension that placed the call — a call is only ever this
    company's business if one of its own 3-digit extensions dialled out. If
    `orig` isn't a bare 3-digit extension, this record isn't a call our own
    staff placed (an inbound call, a malformed CDR row, or someone else's
    traffic on the same trunk) — it's Unknown, full stop, without even
    looking at `dest` (never mistakenly billed as External/International
    just because the destination leg happens to look like an outside
    number). Once `orig` is confirmed to be one of ours, the call takes on
    whatever `dest` classifies as (Internal, External, International, or
    Unknown)."""
    # orig must itself classify as Internal (a bare 3-digit extension) or
    # the whole call is Unknown regardless of dest.
    if classify_number(orig) != CALL_CLASS_INTERNAL:
        return CALL_CLASS_UNKNOWN
    # orig checks out — the call's classification is whatever dest
    # classifies as.
    return classify_number(dest)


# --- Call rating -----------------------------------------------------------
# Rates used to live as hardcoded constants right here (moved from
# Backend/constants.py + services/billing.py and BackendDotNet/Constants.cs
# + Services/Billing.cs). They now live in the database instead — the
# `billing_settings` (local/Kenyan peak/off-peak, Safaricom's published
# tariff) and `international_call_rates` (per-country-code KES/minute,
# sourced from ML/training/International_Calling_Rates.pdf) tables,
# editable by an Admin via PATCH /call-rates/local and
# PATCH /call-rates/international/<country_code>. This module reads them
# fresh from the `backend` it's given (see
# _load_billing_settings/_load_international_rates below) rather than
# importing a Python module, since it runs against BackendDotNet's
# database (Postgres, or SQLite for local dev) via the same raw-SQL
# Backend abstraction common.py uses everywhere else.
#
# The constants below are the bootstrap-time defaults only (mirrors
# BackendDotNet's CallRateBootstrap) — used here purely as a last-resort
# fallback if the backend's tables are somehow still empty (e.g. queried
# before its own bootstrap has ever run).
# The only two classes that are ever charged — Internal and Unknown always
# cost 0.
CHARGEABLE_CALL_CLASSES = frozenset({CALL_CLASS_EXTERNAL, CALL_CLASS_INTERNATIONAL})

# Safaricom's published local (on-net + off-net) tariff: KSh 4.87/minute
# 08:00-22:00, KSh 2.50/minute 22:00-08:00.
DEFAULT_PEAK_RATE_KES_PER_MINUTE = 4.87
DEFAULT_OFF_PEAK_RATE_KES_PER_MINUTE = 2.50
DEFAULT_PEAK_START_HOUR = 8
DEFAULT_PEAK_END_HOUR = 22
# Fallback for an International destination whose country code isn't (yet)
# in international_call_rates — e.g. an admin hasn't priced it yet.
DEFAULT_INTERNATIONAL_RATE_KES_PER_MINUTE = 40.0


def _load_billing_settings(backend) -> dict:
    # Fetch the single billing_settings row (id = "default") from the DB.
    row = backend.execute(
        "SELECT peak_rate_kes, off_peak_rate_kes, peak_start_hour, peak_end_hour, "
        "default_international_rate_kes FROM billing_settings WHERE id = ?",
        ("default",),
    ).fetchone()
    # No row yet (bootstrap hasn't run) -> fall back to the hardcoded
    # Safaricom defaults above.
    if row is None:
        print(f"[{backend.name}] Billing: no billing_settings row found — using built-in Safaricom defaults.")
        return {
            "peak_rate_kes": DEFAULT_PEAK_RATE_KES_PER_MINUTE,
            "off_peak_rate_kes": DEFAULT_OFF_PEAK_RATE_KES_PER_MINUTE,
            "peak_start_hour": DEFAULT_PEAK_START_HOUR,
            "peak_end_hour": DEFAULT_PEAK_END_HOUR,
            "default_international_rate_kes": DEFAULT_INTERNATIONAL_RATE_KES_PER_MINUTE,
        }
    # Unpack the row's five columns into named variables.
    peak_rate, off_peak_rate, peak_start_hour, peak_end_hour, default_intl_rate = row
    # Return them as a plain dict, coerced to the right Python types (the
    # DB driver may hand back Decimal/str depending on backend).
    return {
        "peak_rate_kes": float(peak_rate),
        "off_peak_rate_kes": float(off_peak_rate),
        "peak_start_hour": int(peak_start_hour),
        "peak_end_hour": int(peak_end_hour),
        "default_international_rate_kes": float(default_intl_rate),
    }


def _load_international_rates(backend) -> dict[str, float]:
    # Fetch every (country_code, rate) row from international_call_rates.
    rows = backend.execute("SELECT country_code, rate_kes_per_minute FROM international_call_rates").fetchall()
    # Turn the list of (code, rate) tuples into a {code: rate} dict for
    # O(1) lookups later.
    return {code: float(rate) for code, rate in rows}


def _is_peak_hour(orig_time, peak_start_hour: int, peak_end_hour: int) -> bool:
    """orig_time is an "HH:MM:SS" string (the CDR dataset's own column) — a
    missing/unparseable time defaults to peak, the pricier (safer to bill,
    not to under-bill) assumption."""
    # Missing/NaN time -> assume peak (safer to over- than under-bill).
    if not orig_time or (isinstance(orig_time, float) and pd.isna(orig_time)):
        return True
    try:
        # Split "HH:MM:SS" on ":" and take the first part as the hour.
        hour = int(str(orig_time).split(":")[0])
    except (ValueError, IndexError):
        # Couldn't parse an hour out of it -> assume peak too.
        return True
    # Peak if the hour falls within [peak_start_hour, peak_end_hour).
    return peak_start_hour <= hour < peak_end_hour

def _international_destination_digits(destination) -> str | None:
    """Same trunk-digit/dial-terminator/IDD-marker stripping
    classify_number() applies, so a number classify_number() called
    International always resolves to a lookupable digit string here too
    (rather than silently falling back to the default rate because this
    rate-lookup never learned to strip the leading "9")."""
    # No destination to work with.
    if not destination or (isinstance(destination, float) and pd.isna(destination)):
        return None
    # Clean whitespace and drop a trailing "#", same as classify_number().
    digits = _strip_dial_terminator(str(destination).strip().replace(" ", ""))
    # Drop the "9" trunk-access digit if present.
    if digits.startswith("9"):
        digits = digits[1:]
    # Strip any remaining IDD marker (+/00/000), leaving just the country
    # code + subscriber number.
    return _strip_idd_marker(digits)


def _lookup_international_rate(destination, intl_rates: dict[str, float], default_rate: float) -> float:
    """Longest-prefix match of the dialled country code against
    international_call_rates (admin-editable — see PATCH
    /call-rates/international/<country_code>); falls back to
    billing_settings.default_international_rate_kes for any code not yet
    priced."""
    # Normalise the destination down to bare digits.
    digits = _international_destination_digits(destination)
    # No usable digits, or no rates loaded at all -> use the default rate.
    if not digits or not intl_rates:
        return default_rate
    # Longest country code currently priced in the DB.
    max_len = max(len(code) for code in intl_rates)
    # Try progressively shorter prefixes of `digits`, longest first, so the
    # most specific matching country code wins.
    for length in range(min(max_len, len(digits)), 0, -1):
        rate = intl_rates.get(digits[:length])
        if rate is not None:
            return rate
    # No prefix matched a priced country code -> default rate.
    return default_rate


def _rate_per_minute(call_classification: str, destination, orig_time, billing_settings: dict, intl_rates: dict[str, float]) -> float:
    """International: per-country rate from international_call_rates
    (fallback to the configured default). External (local Kenyan,
    on-net and off-net alike): Safaricom's peak/off-peak tariff from
    billing_settings, by the call's own time of day. No SIM-plan override
    here — see module docstring."""
    # International calls: look up the per-country rate.
    if call_classification == CALL_CLASS_INTERNATIONAL:
        return _lookup_international_rate(destination, intl_rates, billing_settings["default_international_rate_kes"])
    # Otherwise (External/local): pick peak or off-peak rate based on the
    # call's time of day.
    is_peak = _is_peak_hour(orig_time, billing_settings["peak_start_hour"], billing_settings["peak_end_hour"])
    return billing_settings["peak_rate_kes"] if is_peak else billing_settings["off_peak_rate_kes"]


def compute_call_cost(call_classification: str, duration_minutes: float, destination, orig_time,
                       billing_settings: dict, intl_rates: dict[str, float]) -> float:
    """Cost for one raw CDR row, in KES (rounded to 2dp)."""
    # Internal/Unknown calls are never charged.
    if call_classification not in CHARGEABLE_CALL_CLASSES:
        return 0.0
    # Look up the applicable per-minute rate for this call.
    rate = _rate_per_minute(call_classification, destination, orig_time, billing_settings, intl_rates)
    # Cost = duration in minutes * rate, rounded to 2 decimal places (KES
    # cents).
    return round(float(duration_minutes) * rate, 2)


# --- Dataset -> usage_summaries -------------------------------------------

def _filter_for_classification(df: pd.DataFrame) -> pd.DataFrame:
    """Two rows never reach classify_call(), dropped in-memory here (the
    CDR dataset CSV on disk — the parsed extract — is never rewritten, so
    this is reproducible on every run rather than a one-off cleanup):

    - Zero-duration: the call never connected, so there's nothing to
      classify — not "Unknown", just out of scope.
    - Unparseable destination: `orig` IS one of our own 3-digit PBX
      extensions (so this would otherwise be billed to it), but `dest`
      matches no recognised number pattern at all — a malformed CDR row,
      not a real destination classify_call() could ever resolve.

    Logged separately plus their overlap, since a disconnected call with a
    garbled dest field trips both rules at once."""
    # Boolean Series, True where the call's duration is exactly 0 seconds.
    zero_duration = df["duration_sec"].astype(float) == 0
    # Boolean Series, True where `orig` is a bare 3-digit PBX extension
    # (NaN treated as empty string first, since NaN.str.match would error).
    orig_is_extension = df["orig"].fillna("").str.match(INTERNAL_EXTENSION_REGEX)
    # True where orig is one of ours AND dest doesn't parse into any known
    # class — apply classify_number() to every value in the `dest` column.
    unparseable_dest = orig_is_extension & (df["dest"].map(classify_number) == CALL_CLASS_UNKNOWN)
    # Rows that trip both rules at once (for reporting only).
    overlap = zero_duration & unparseable_dest
    # Union of both rules — every row that gets dropped, counted once each.
    drop = zero_duration | unparseable_dest

    # Log the dataset size and each rule's impact before returning the
    # filtered frame.
    print(f"[CDR pipeline] {len(df)} parsed record(s) loaded from {CDR_DATASET_PATH.name}")
    print(f"[CDR pipeline] dropped {zero_duration.sum()} zero-duration row(s) (call never connected)")
    print(f"[CDR pipeline] dropped {unparseable_dest.sum()} row(s) with an unparseable destination "
          f"(PBX-extension origin, unrecognisable dest)")
    print(f"[CDR pipeline] {overlap.sum()} row(s) matched both rules (counted once in the drop total)")
    print(f"[CDR pipeline] {drop.sum()} row(s) dropped in total, {len(df) - drop.sum()} row(s) reach classification")

    # Keep only the rows NOT flagged for dropping (~drop negates the
    # boolean mask); .copy() avoids a "SettingWithCopyWarning" on later
    # column assignments in _load_dataset().
    return df.loc[~drop].copy()


def _load_dataset(billing_settings: dict, intl_rates: dict[str, float]) -> pd.DataFrame:
    # Read the CSV into a DataFrame; force these four columns to stay
    # strings (not auto-inferred as numbers) since leading zeros / exact
    # digit sequences matter for classification.
    df = pd.read_csv(CDR_DATASET_PATH, dtype={"orig": str, "dest": str, "date": str, "orig_time": str})
    # Drop zero-duration / unparseable-destination rows before anything
    # else touches them.
    df = _filter_for_classification(df)
    # New column: duration converted from seconds to minutes (rates are
    # per-minute).
    df["duration_minutes"] = df["duration_sec"].astype(float) / 60.0
    # New column: classify every remaining row's (orig, dest) pair.
    df["call_classification"] = [
        classify_call(orig, dest) for orig, dest in zip(df["orig"], df["dest"])
    ]
    # New column: compute the KES cost of every row from its
    # classification, duration, destination, and time of day.
    df["computed_cost"] = [
        compute_call_cost(cls, dur, dest, orig_time, billing_settings, intl_rates)
        for cls, dur, dest, orig_time in zip(
            df["call_classification"], df["duration_minutes"], df["dest"], df["orig_time"],
        )
    ]
    # New column: "YYYY-MM" extracted from the first 7 characters of the
    # "YYYY-MM-DD" date string — used to group costs by month below.
    df["month"] = df["date"].str.slice(0, 7)
    return df


def run(backend: Backend) -> int:
    """Full recompute (not incremental) of every employee-month total that
    the dataset has origin traffic for: sums computed_cost per (orig
    extension, month), then upserts into usage_summaries for whichever
    employee currently owns that extension_code. Employees whose
    extension_code never appears as an origin in the dataset are left
    untouched. Returns the number of usage_summaries rows written/updated.

    Only rows whose `orig` is a bare 3-digit PBX extension are ever billed
    to an employee — the organization only bears the cost of calls its own
    staff dialled out. A small number of chargeable rows in the raw
    dataset carry a non-extension value in `orig` instead (e.g. the dialled
    "9..." digits appear to have landed in `orig` rather than `dest` for
    some records) — those are real telco spend, but with no employee to
    attribute it to, so they're excluded here rather than guessed at."""
    # Load the current DB-backed rates for this backend.
    billing_settings = _load_billing_settings(backend)
    intl_rates = _load_international_rates(backend)
    # Build the full classified/costed dataset.
    dataset = _load_dataset(billing_settings, intl_rates)
    # Subset: only rows that actually cost something (External/International).
    chargeable = dataset[dataset["computed_cost"] > 0]
    # Boolean mask: chargeable rows whose `orig` is NOT a valid 3-digit
    # extension (so there's no employee to bill them to).
    not_pbx_origin = ~chargeable["orig"].str.match(INTERNAL_EXTENSION_REGEX)
    # If any such rows exist, log their count and total value so this
    # "real spend, nobody billed" gap is visible rather than silent.
    if not_pbx_origin.any():
        unattributable = round(chargeable.loc[not_pbx_origin, "computed_cost"].sum(), 2)
        print(f"[{backend.name}] Billing: {not_pbx_origin.sum()} chargeable row(s) "
              f"({unattributable} KES) have no 3-digit PBX origin — excluded, not billed to anyone.")

    # Sum computed_cost, grouped by (originating extension, month) — one
    # total per employee per month.
    by_origin = dataset.groupby(["orig", "month"])["computed_cost"].sum()

    # Fetch every employee that currently has an extension_code assigned.
    employees = backend.execute(
        "SELECT employee_id, extension_code FROM employees WHERE extension_code IS NOT NULL"
    ).fetchall()
    # Build an extension_code -> employee_id lookup dict.
    employee_by_extension = {extension_code: employee_id for employee_id, extension_code in employees}

    written = 0
    # Iterate every (extension, month) group and its summed cost.
    for (extension_code, month), total_cost in by_origin.items():
        if not _INTERNAL_RE.match(extension_code):
            continue  # not a 3-digit PBX extension — never billed to an employee
        # Look up which employee (if any) currently owns this extension.
        employee_id = employee_by_extension.get(extension_code)
        if employee_id is None:
            continue
        # Round the summed cost to 2 decimal places.
        total_cost = round(float(total_cost), 2)
        # Check whether a usage_summaries row already exists for this
        # employee+month.
        existing = backend.execute(
            "SELECT summary_id FROM usage_summaries WHERE employee_id = ? AND month = ?",
            (employee_id, month),
        ).fetchone()
        if existing:
            # Update the existing row's total_cost/extension_code/updated_at.
            backend.execute(
                "UPDATE usage_summaries SET total_cost = ?, extension_code = ?, updated_at = ? WHERE summary_id = ?",
                (total_cost, extension_code, now_str(), existing[0]),
            )
        else:
            # No row yet — insert a brand new one with a fresh UUID.
            backend.execute(
                """INSERT INTO usage_summaries (summary_id, employee_id, month, total_cost, extension_code, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (new_id(), employee_id, month, total_cost, extension_code, now_str()),
            )
        written += 1
    # Persist all the inserts/updates made in this loop.
    backend.commit()
    return written


def main() -> None:
    # Run the billing recompute against every currently-reachable backend
    # (today, just BackendDotNet), printing a one-line summary each.
    for backend in open_backend_connections():
        written = run(backend)
        print(f"[{backend.name}] Billing: {written} usage_summary row(s) written from the CDR dataset.")


# Only run main() when this file is executed directly (`python billing.py`),
# not when it's imported as a module (e.g. by run_ml.ipynb).
if __name__ == "__main__":
    main()
