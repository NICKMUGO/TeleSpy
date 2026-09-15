"""Call classification + the anomaly-detection carve-out rule.

"9" is the trunk-access digit for *any* outside-line call, local or
international — a near-universal PBX convention (still the default in
Cisco CUCM route plans, e.g. "9.@"/"9.0011!") — so classify_number() always
strips it first, then classifies what's left. Four outcomes:

- External call (Kenyan): "9" + a 10-digit local number (0 + 9 digits), e.g.
  90712345678. A Kenyan number dialled in international form after the "9"
  (+254.., 00254..) is normalised to local form and lands here too.
- International call: "9" + "+"/"00"/"000" + country code (not 254) +
  subscriber number. Chargeable, like an external call.
- Internal call: a bare 3-digit extension, e.g. 206, 389, 400 (no "9"
  prefix — never leaves the PBX). Never charged.
- Extensions 256 and 400 are always logged normally but are permanently
  excluded from anomaly detection (see ANOMALY_EXCLUDED_EXTENSIONS).

A trailing "#" (a CUCM dial-termination digit — how a caller signals "done
dialling" immediately instead of waiting out the inter-digit timeout on a
variable-length route pattern) is stripped before any of the above.
"""
import re

from constants import (
    ANOMALY_EXCLUDED_EXTENSIONS,
    CALL_CLASS_EXTERNAL,
    CALL_CLASS_INTERNAL,
    CALL_CLASS_INTERNATIONAL,
    CALL_CLASS_UNKNOWN,
    INTERNAL_EXTENSION_REGEX,
    INTERNATIONAL_NUMBER_REGEX,
    KENYAN_INTERNATIONAL_PREFIX_REGEX,
    KENYAN_LOCAL_NUMBER_REGEX,
)

_KENYAN_LOCAL_RE = re.compile(KENYAN_LOCAL_NUMBER_REGEX)
_INTERNATIONAL_RE = re.compile(INTERNATIONAL_NUMBER_REGEX)
_KENYAN_INTL_PREFIX_RE = re.compile(KENYAN_INTERNATIONAL_PREFIX_REGEX)
_INTERNAL_RE = re.compile(INTERNAL_EXTENSION_REGEX)


def normalize_number(number: str) -> str:
    """Trim whitespace and strip a trailing CUCM dial-termination "#". Any
    other value is returned as-is."""
    if not number:
        return ""
    number = number.strip().replace(" ", "")
    if number.endswith("#"):
        number = number[:-1]
    return number


def classify_number(number: str) -> str:
    number = normalize_number(number)
    if not number:
        return CALL_CLASS_UNKNOWN
    if _INTERNAL_RE.match(number):
        return CALL_CLASS_INTERNAL
    if not number.startswith("9") or len(number) < 2:
        return CALL_CLASS_UNKNOWN
    rest = number[1:]  # drop the trunk-access digit
    if _KENYAN_LOCAL_RE.match(rest):
        return CALL_CLASS_EXTERNAL
    if _KENYAN_INTL_PREFIX_RE.match(rest):
        # Kenya's own country code, dialled in full international form —
        # bill as a local Kenyan call, not International.
        return CALL_CLASS_EXTERNAL
    if _INTERNATIONAL_RE.match(rest):
        return CALL_CLASS_INTERNATIONAL
    return CALL_CLASS_UNKNOWN


def classify_call(orig: str, dest: str) -> str:
    """Classify a call from its two legs. International wins over External
    wins over Internal: if either leg is an international number the whole
    call is International; else if either leg dials out through the 9-prefix
    (or is a normalised Kenyan number) it's External; else Internal only
    when both legs are 3-digit extensions."""
    orig_class = classify_number(orig)
    dest_class = classify_number(dest)
    if CALL_CLASS_INTERNATIONAL in (orig_class, dest_class):
        return CALL_CLASS_INTERNATIONAL
    if CALL_CLASS_EXTERNAL in (orig_class, dest_class):
        return CALL_CLASS_EXTERNAL
    if orig_class == CALL_CLASS_INTERNAL and dest_class == CALL_CLASS_INTERNAL:
        return CALL_CLASS_INTERNAL
    return CALL_CLASS_UNKNOWN


def is_excluded_from_anomaly_detection(orig: str, dest: str, call_classification: str) -> bool:
    """Internal calls to/from a carved-out extension (256, 400) never feed
    the anomaly detector, however unusual their pattern looks."""
    if call_classification != CALL_CLASS_INTERNAL:
        return False
    return orig in ANOMALY_EXCLUDED_EXTENSIONS or dest in ANOMALY_EXCLUDED_EXTENSIONS
