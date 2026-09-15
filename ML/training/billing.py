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
apply — cost here is purely classification + duration * the flat/zone
rate table below.

Run standalone:
    python billing.py
"""
import re

import pandas as pd

from common import Backend, new_id, now_str, open_backend_connections, REPO_ROOT

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
KENYAN_LOCAL_NUMBER_REGEX = r"^0\d{9}$"
INTERNAL_EXTENSION_REGEX = r"^\d{3}$"

CALL_CLASS_INTERNAL = "Internal"
CALL_CLASS_EXTERNAL = "External"
CALL_CLASS_INTERNATIONAL = "International"
CALL_CLASS_UNKNOWN = "Unknown"

_KENYAN_LOCAL_RE = re.compile(KENYAN_LOCAL_NUMBER_REGEX)
_INTERNAL_RE = re.compile(INTERNAL_EXTENSION_REGEX)
_IDD_MARKERS = ("000", "00", "+")  # longest first, so "000" isn't left as a stray "0" after "00" matches


def _strip_dial_terminator(number: str) -> str:
    return number[:-1] if number.endswith("#") else number


def _strip_idd_marker(digits: str) -> str:
    """Remove a leading IDD marker (+/00/000) if present; otherwise return
    digits unchanged (the "no marker, direct country code" case)."""
    for marker in _IDD_MARKERS:
        if digits.startswith(marker):
            return digits[len(marker):]
    return digits


def _country_code_zone(digits: str) -> str | None:
    """Longest-prefix match against INTERNATIONAL_COUNTRY_CODE_ZONES (below).
    Forward reference: that dict is defined further down this module, but
    Python resolves globals at call time, not definition time, so this is
    fine — it's never invoked before the module finishes loading."""
    for length in range(INTERNATIONAL_COUNTRY_CODE_MAX_LEN, 0, -1):
        zone = INTERNATIONAL_COUNTRY_CODE_ZONES.get(digits[:length])
        if zone is not None:
            return zone
    return None


def classify_number(number) -> str:
    if not number or (isinstance(number, float) and pd.isna(number)):
        return CALL_CLASS_UNKNOWN
    number = _strip_dial_terminator(str(number).strip().replace(" ", ""))
    if not number:
        return CALL_CLASS_UNKNOWN

    if _INTERNAL_RE.match(number):
        return CALL_CLASS_INTERNAL

    if not number.startswith("9") or len(number) < 2:
        return CALL_CLASS_UNKNOWN
    rest = number[1:]  # drop the trunk-access digit

    if _KENYAN_LOCAL_RE.match(rest):
        return CALL_CLASS_EXTERNAL

    digits = _strip_idd_marker(rest)
    if digits.startswith("254"):
        # Kenya's own country code, dialled in full international form —
        # normalise to local form and bill as a local Kenyan call.
        local_form = "0" + digits[3:]
        return CALL_CLASS_EXTERNAL if _KENYAN_LOCAL_RE.match(local_form) else CALL_CLASS_UNKNOWN
    return CALL_CLASS_INTERNATIONAL if _country_code_zone(digits) is not None else CALL_CLASS_UNKNOWN


def classify_call(orig, dest) -> str:
    """International wins over External wins over Internal — identical
    precedence to Backend's classify_call()."""
    orig_class = classify_number(orig)
    dest_class = classify_number(dest)
    if CALL_CLASS_INTERNATIONAL in (orig_class, dest_class):
        return CALL_CLASS_INTERNATIONAL
    if CALL_CLASS_EXTERNAL in (orig_class, dest_class):
        return CALL_CLASS_EXTERNAL
    if orig_class == CALL_CLASS_INTERNAL and dest_class == CALL_CLASS_INTERNAL:
        return CALL_CLASS_INTERNAL
    return CALL_CLASS_UNKNOWN


# --- Call rating (moved here from Backend/constants.py + services/billing.py
# and BackendDotNet/Constants.cs + Services/Billing.cs — this is now the
# only place these rates live) --------------------------------------------
CHARGEABLE_CALL_CLASSES = frozenset({CALL_CLASS_EXTERNAL, CALL_CLASS_INTERNATIONAL})

# Internal calls always bill at 0. This is the flat fallback rate for
# chargeable (External/International) calls — no per-SIM plan override and
# no telco-provided `charge` column exist in this dataset, unlike the live
# CdrIngest path that used to blend in both.
EXTERNAL_CALL_RATE_KES_PER_MINUTE = 5.0

# --- International call rating ----------------------------------------
# Destinations are grouped into a handful of zones, mirroring how Kenyan
# carriers (e.g. Safaricom) band their international tariff rather than
# pricing every country individually. _international_zone() takes the
# country (dial) code and matches it longest-first against
# INTERNATIONAL_COUNTRY_CODE_ZONES; an unlisted code falls back to
# EXTERNAL_CALL_RATE_KES_PER_MINUTE. Kenya (254) is intentionally absent: a
# +254 call is normalised to a local Kenyan call upstream and never
# reaches this table.
INTL_ZONE_EAST_AFRICA = "east_africa"        # EAC / neighbouring states
INTL_ZONE_SPECIAL = "special"                # carrier "special rate" set
INTL_ZONE_AFRICA = "africa"                  # rest of the African continent
INTL_ZONE_REST_OF_WORLD = "rest_of_world"
INTL_ZONE_PREMIUM = "premium"                # high-tariff / small-island dests
INTL_ZONE_SATELLITE = "satellite"            # premium space / maritime ranges

INTERNATIONAL_ZONE_RATE_KES_PER_MINUTE = {
    INTL_ZONE_EAST_AFRICA: 20.0,
    INTL_ZONE_SPECIAL: 25.0,
    INTL_ZONE_REST_OF_WORLD: 40.0,
    INTL_ZONE_AFRICA: 45.0,
    INTL_ZONE_PREMIUM: 100.0,
    INTL_ZONE_SATELLITE: 300.0,
}

# Country (dial) code -> zone. Keys are the digits immediately after the
# international prefix, with no separator; billing matches the longest key
# that prefixes the dialled number (4 digits, then 3, then 2, then 1).
# Every assigned ITU-T E.164 country/territory code is listed, so an
# ordinary destination never silently falls back to the Kenyan external
# rate; only unassigned or newly-issued codes still do.
#
# The 4-digit keys are NANP members: "+1" on its own is the USA/Canada
# special rate, but the Caribbean and Pacific NANP territories are billed
# as their own (far more expensive) destinations, so they are listed
# explicitly and win on longest-match.
INTERNATIONAL_COUNTRY_CODE_ZONES = {
    # --- East Africa / EAC neighbours ----------------------------------
    "256": INTL_ZONE_EAST_AFRICA,   # Uganda
    "255": INTL_ZONE_EAST_AFRICA,   # Tanzania
    "250": INTL_ZONE_EAST_AFRICA,   # Rwanda
    "257": INTL_ZONE_EAST_AFRICA,   # Burundi
    "211": INTL_ZONE_EAST_AFRICA,   # South Sudan
    "251": INTL_ZONE_EAST_AFRICA,   # Ethiopia
    "252": INTL_ZONE_EAST_AFRICA,   # Somalia
    "253": INTL_ZONE_EAST_AFRICA,   # Djibouti
    "249": INTL_ZONE_EAST_AFRICA,   # Sudan

    # --- Carrier "special rate" destinations ---------------------------
    "1": INTL_ZONE_SPECIAL,         # USA / Canada (mainland NANP)
    "44": INTL_ZONE_SPECIAL,        # United Kingdom
    "91": INTL_ZONE_SPECIAL,        # India
    "86": INTL_ZONE_SPECIAL,        # China

    # --- Rest of Africa -------------------------------------------------
    "20": INTL_ZONE_AFRICA,         # Egypt
    "27": INTL_ZONE_AFRICA,         # South Africa
    "212": INTL_ZONE_AFRICA,        # Morocco / Western Sahara
    "213": INTL_ZONE_AFRICA,        # Algeria
    "216": INTL_ZONE_AFRICA,        # Tunisia
    "218": INTL_ZONE_AFRICA,        # Libya
    "220": INTL_ZONE_AFRICA,        # Gambia
    "221": INTL_ZONE_AFRICA,        # Senegal
    "222": INTL_ZONE_AFRICA,        # Mauritania
    "223": INTL_ZONE_AFRICA,        # Mali
    "224": INTL_ZONE_AFRICA,        # Guinea
    "225": INTL_ZONE_AFRICA,        # Cote d'Ivoire
    "226": INTL_ZONE_AFRICA,        # Burkina Faso
    "227": INTL_ZONE_AFRICA,        # Niger
    "228": INTL_ZONE_AFRICA,        # Togo
    "229": INTL_ZONE_AFRICA,        # Benin
    "230": INTL_ZONE_AFRICA,        # Mauritius
    "231": INTL_ZONE_AFRICA,        # Liberia
    "232": INTL_ZONE_AFRICA,        # Sierra Leone
    "233": INTL_ZONE_AFRICA,        # Ghana
    "234": INTL_ZONE_AFRICA,        # Nigeria
    "235": INTL_ZONE_AFRICA,        # Chad
    "236": INTL_ZONE_AFRICA,        # Central African Republic
    "237": INTL_ZONE_AFRICA,        # Cameroon
    "238": INTL_ZONE_AFRICA,        # Cape Verde
    "239": INTL_ZONE_AFRICA,        # Sao Tome and Principe
    "240": INTL_ZONE_AFRICA,        # Equatorial Guinea
    "241": INTL_ZONE_AFRICA,        # Gabon
    "242": INTL_ZONE_AFRICA,        # Congo (Brazzaville)
    "243": INTL_ZONE_AFRICA,        # DR Congo (Kinshasa)
    "244": INTL_ZONE_AFRICA,        # Angola
    "245": INTL_ZONE_AFRICA,        # Guinea-Bissau
    "248": INTL_ZONE_AFRICA,        # Seychelles
    "258": INTL_ZONE_AFRICA,        # Mozambique
    "260": INTL_ZONE_AFRICA,        # Zambia
    "261": INTL_ZONE_AFRICA,        # Madagascar
    "262": INTL_ZONE_AFRICA,        # Reunion / Mayotte
    "263": INTL_ZONE_AFRICA,        # Zimbabwe
    "264": INTL_ZONE_AFRICA,        # Namibia
    "265": INTL_ZONE_AFRICA,        # Malawi
    "266": INTL_ZONE_AFRICA,        # Lesotho
    "267": INTL_ZONE_AFRICA,        # Botswana
    "268": INTL_ZONE_AFRICA,        # Eswatini
    "269": INTL_ZONE_AFRICA,        # Comoros
    "291": INTL_ZONE_AFRICA,        # Eritrea
    # Remote African / Indian Ocean territories, billed premium
    "246": INTL_ZONE_PREMIUM,       # Diego Garcia (BIOT)
    "247": INTL_ZONE_PREMIUM,       # Ascension Island
    "290": INTL_ZONE_PREMIUM,       # Saint Helena / Tristan da Cunha

    # --- Europe ---------------------------------------------------------
    "30": INTL_ZONE_REST_OF_WORLD,  # Greece
    "31": INTL_ZONE_REST_OF_WORLD,  # Netherlands
    "32": INTL_ZONE_REST_OF_WORLD,  # Belgium
    "33": INTL_ZONE_REST_OF_WORLD,  # France
    "34": INTL_ZONE_REST_OF_WORLD,  # Spain
    "36": INTL_ZONE_REST_OF_WORLD,  # Hungary
    "39": INTL_ZONE_REST_OF_WORLD,  # Italy
    "40": INTL_ZONE_REST_OF_WORLD,  # Romania
    "41": INTL_ZONE_REST_OF_WORLD,  # Switzerland
    "43": INTL_ZONE_REST_OF_WORLD,  # Austria
    "45": INTL_ZONE_REST_OF_WORLD,  # Denmark
    "46": INTL_ZONE_REST_OF_WORLD,  # Sweden
    "47": INTL_ZONE_REST_OF_WORLD,  # Norway / Svalbard
    "48": INTL_ZONE_REST_OF_WORLD,  # Poland
    "49": INTL_ZONE_REST_OF_WORLD,  # Germany
    "350": INTL_ZONE_REST_OF_WORLD,  # Gibraltar
    "351": INTL_ZONE_REST_OF_WORLD,  # Portugal
    "352": INTL_ZONE_REST_OF_WORLD,  # Luxembourg
    "353": INTL_ZONE_REST_OF_WORLD,  # Ireland
    "354": INTL_ZONE_REST_OF_WORLD,  # Iceland
    "355": INTL_ZONE_REST_OF_WORLD,  # Albania
    "356": INTL_ZONE_REST_OF_WORLD,  # Malta
    "357": INTL_ZONE_REST_OF_WORLD,  # Cyprus
    "358": INTL_ZONE_REST_OF_WORLD,  # Finland / Aland Islands
    "359": INTL_ZONE_REST_OF_WORLD,  # Bulgaria
    "370": INTL_ZONE_REST_OF_WORLD,  # Lithuania
    "371": INTL_ZONE_REST_OF_WORLD,  # Latvia
    "372": INTL_ZONE_REST_OF_WORLD,  # Estonia
    "373": INTL_ZONE_REST_OF_WORLD,  # Moldova
    "374": INTL_ZONE_REST_OF_WORLD,  # Armenia
    "375": INTL_ZONE_REST_OF_WORLD,  # Belarus
    "376": INTL_ZONE_REST_OF_WORLD,  # Andorra
    "377": INTL_ZONE_REST_OF_WORLD,  # Monaco
    "378": INTL_ZONE_REST_OF_WORLD,  # San Marino
    "379": INTL_ZONE_REST_OF_WORLD,  # Vatican City
    "380": INTL_ZONE_REST_OF_WORLD,  # Ukraine
    "381": INTL_ZONE_REST_OF_WORLD,  # Serbia
    "382": INTL_ZONE_REST_OF_WORLD,  # Montenegro
    "383": INTL_ZONE_REST_OF_WORLD,  # Kosovo
    "385": INTL_ZONE_REST_OF_WORLD,  # Croatia
    "386": INTL_ZONE_REST_OF_WORLD,  # Slovenia
    "387": INTL_ZONE_REST_OF_WORLD,  # Bosnia and Herzegovina
    "389": INTL_ZONE_REST_OF_WORLD,  # North Macedonia
    "420": INTL_ZONE_REST_OF_WORLD,  # Czechia
    "421": INTL_ZONE_REST_OF_WORLD,  # Slovakia
    "423": INTL_ZONE_REST_OF_WORLD,  # Liechtenstein
    "298": INTL_ZONE_REST_OF_WORLD,  # Faroe Islands
    "299": INTL_ZONE_REST_OF_WORLD,  # Greenland
    "500": INTL_ZONE_PREMIUM,        # Falkland Islands
    "7": INTL_ZONE_REST_OF_WORLD,   # Russia / Kazakhstan
    "90": INTL_ZONE_REST_OF_WORLD,  # Turkey

    # --- Americas -------------------------------------------------------
    "51": INTL_ZONE_REST_OF_WORLD,  # Peru
    "52": INTL_ZONE_REST_OF_WORLD,  # Mexico
    "53": INTL_ZONE_PREMIUM,        # Cuba
    "54": INTL_ZONE_REST_OF_WORLD,  # Argentina
    "55": INTL_ZONE_REST_OF_WORLD,  # Brazil
    "56": INTL_ZONE_REST_OF_WORLD,  # Chile
    "57": INTL_ZONE_REST_OF_WORLD,  # Colombia
    "58": INTL_ZONE_REST_OF_WORLD,  # Venezuela
    "501": INTL_ZONE_REST_OF_WORLD,  # Belize
    "502": INTL_ZONE_REST_OF_WORLD,  # Guatemala
    "503": INTL_ZONE_REST_OF_WORLD,  # El Salvador
    "504": INTL_ZONE_REST_OF_WORLD,  # Honduras
    "505": INTL_ZONE_REST_OF_WORLD,  # Nicaragua
    "506": INTL_ZONE_REST_OF_WORLD,  # Costa Rica
    "507": INTL_ZONE_REST_OF_WORLD,  # Panama
    "508": INTL_ZONE_PREMIUM,        # Saint Pierre and Miquelon
    "509": INTL_ZONE_REST_OF_WORLD,  # Haiti
    "590": INTL_ZONE_PREMIUM,        # Guadeloupe / St Barthelemy / St Martin
    "591": INTL_ZONE_REST_OF_WORLD,  # Bolivia
    "592": INTL_ZONE_REST_OF_WORLD,  # Guyana
    "593": INTL_ZONE_REST_OF_WORLD,  # Ecuador
    "594": INTL_ZONE_PREMIUM,        # French Guiana
    "595": INTL_ZONE_REST_OF_WORLD,  # Paraguay
    "596": INTL_ZONE_PREMIUM,        # Martinique
    "597": INTL_ZONE_REST_OF_WORLD,  # Suriname
    "598": INTL_ZONE_REST_OF_WORLD,  # Uruguay
    "599": INTL_ZONE_PREMIUM,        # Curacao / Caribbean Netherlands
    "297": INTL_ZONE_PREMIUM,        # Aruba
    # NANP members outside the USA/Canada special rate
    "1242": INTL_ZONE_PREMIUM,      # Bahamas
    "1246": INTL_ZONE_PREMIUM,      # Barbados
    "1264": INTL_ZONE_PREMIUM,      # Anguilla
    "1268": INTL_ZONE_PREMIUM,      # Antigua and Barbuda
    "1284": INTL_ZONE_PREMIUM,      # British Virgin Islands
    "1340": INTL_ZONE_PREMIUM,      # US Virgin Islands
    "1345": INTL_ZONE_PREMIUM,      # Cayman Islands
    "1441": INTL_ZONE_PREMIUM,      # Bermuda
    "1473": INTL_ZONE_PREMIUM,      # Grenada
    "1649": INTL_ZONE_PREMIUM,      # Turks and Caicos Islands
    "1658": INTL_ZONE_PREMIUM,      # Jamaica (overlay)
    "1664": INTL_ZONE_PREMIUM,      # Montserrat
    "1670": INTL_ZONE_PREMIUM,      # Northern Mariana Islands
    "1671": INTL_ZONE_PREMIUM,      # Guam
    "1684": INTL_ZONE_PREMIUM,      # American Samoa
    "1721": INTL_ZONE_PREMIUM,      # Sint Maarten
    "1758": INTL_ZONE_PREMIUM,      # Saint Lucia
    "1767": INTL_ZONE_PREMIUM,      # Dominica
    "1784": INTL_ZONE_PREMIUM,      # Saint Vincent and the Grenadines
    "1809": INTL_ZONE_PREMIUM,      # Dominican Republic
    "1829": INTL_ZONE_PREMIUM,      # Dominican Republic (overlay)
    "1849": INTL_ZONE_PREMIUM,      # Dominican Republic (overlay)
    "1868": INTL_ZONE_PREMIUM,      # Trinidad and Tobago
    "1869": INTL_ZONE_PREMIUM,      # Saint Kitts and Nevis
    "1876": INTL_ZONE_PREMIUM,      # Jamaica
    "1787": INTL_ZONE_SPECIAL,      # Puerto Rico (billed as USA)
    "1939": INTL_ZONE_SPECIAL,      # Puerto Rico overlay (billed as USA)

    # --- Asia / Middle East ----------------------------------------------
    "60": INTL_ZONE_REST_OF_WORLD,  # Malaysia
    "62": INTL_ZONE_REST_OF_WORLD,  # Indonesia
    "63": INTL_ZONE_REST_OF_WORLD,  # Philippines
    "65": INTL_ZONE_REST_OF_WORLD,  # Singapore
    "66": INTL_ZONE_REST_OF_WORLD,  # Thailand
    "81": INTL_ZONE_REST_OF_WORLD,  # Japan
    "82": INTL_ZONE_REST_OF_WORLD,  # South Korea
    "84": INTL_ZONE_REST_OF_WORLD,  # Vietnam
    "92": INTL_ZONE_REST_OF_WORLD,  # Pakistan
    "93": INTL_ZONE_REST_OF_WORLD,  # Afghanistan
    "94": INTL_ZONE_REST_OF_WORLD,  # Sri Lanka
    "95": INTL_ZONE_REST_OF_WORLD,  # Myanmar
    "98": INTL_ZONE_REST_OF_WORLD,  # Iran
    "670": INTL_ZONE_REST_OF_WORLD,  # Timor-Leste
    "673": INTL_ZONE_REST_OF_WORLD,  # Brunei
    "850": INTL_ZONE_PREMIUM,        # North Korea
    "852": INTL_ZONE_REST_OF_WORLD,  # Hong Kong
    "853": INTL_ZONE_REST_OF_WORLD,  # Macau
    "855": INTL_ZONE_REST_OF_WORLD,  # Cambodia
    "856": INTL_ZONE_REST_OF_WORLD,  # Laos
    "880": INTL_ZONE_REST_OF_WORLD,  # Bangladesh
    "886": INTL_ZONE_REST_OF_WORLD,  # Taiwan
    "960": INTL_ZONE_REST_OF_WORLD,  # Maldives
    "961": INTL_ZONE_REST_OF_WORLD,  # Lebanon
    "962": INTL_ZONE_REST_OF_WORLD,  # Jordan
    "963": INTL_ZONE_REST_OF_WORLD,  # Syria
    "964": INTL_ZONE_REST_OF_WORLD,  # Iraq
    "965": INTL_ZONE_REST_OF_WORLD,  # Kuwait
    "966": INTL_ZONE_REST_OF_WORLD,  # Saudi Arabia
    "967": INTL_ZONE_REST_OF_WORLD,  # Yemen
    "968": INTL_ZONE_REST_OF_WORLD,  # Oman
    "970": INTL_ZONE_REST_OF_WORLD,  # Palestine
    "971": INTL_ZONE_REST_OF_WORLD,  # United Arab Emirates
    "972": INTL_ZONE_REST_OF_WORLD,  # Israel
    "973": INTL_ZONE_REST_OF_WORLD,  # Bahrain
    "974": INTL_ZONE_REST_OF_WORLD,  # Qatar
    "975": INTL_ZONE_REST_OF_WORLD,  # Bhutan
    "976": INTL_ZONE_REST_OF_WORLD,  # Mongolia
    "977": INTL_ZONE_REST_OF_WORLD,  # Nepal
    "992": INTL_ZONE_REST_OF_WORLD,  # Tajikistan
    "993": INTL_ZONE_REST_OF_WORLD,  # Turkmenistan
    "994": INTL_ZONE_REST_OF_WORLD,  # Azerbaijan
    "995": INTL_ZONE_REST_OF_WORLD,  # Georgia
    "996": INTL_ZONE_REST_OF_WORLD,  # Kyrgyzstan
    "998": INTL_ZONE_REST_OF_WORLD,  # Uzbekistan

    # --- Oceania ----------------------------------------------------------
    "61": INTL_ZONE_REST_OF_WORLD,  # Australia / Cocos / Christmas Island
    "64": INTL_ZONE_REST_OF_WORLD,  # New Zealand
    "675": INTL_ZONE_REST_OF_WORLD,  # Papua New Guinea
    "679": INTL_ZONE_REST_OF_WORLD,  # Fiji
    "672": INTL_ZONE_PREMIUM,        # Norfolk Island / Australian Antarctic
    "674": INTL_ZONE_PREMIUM,        # Nauru
    "676": INTL_ZONE_PREMIUM,        # Tonga
    "677": INTL_ZONE_PREMIUM,        # Solomon Islands
    "678": INTL_ZONE_PREMIUM,        # Vanuatu
    "680": INTL_ZONE_PREMIUM,        # Palau
    "681": INTL_ZONE_PREMIUM,        # Wallis and Futuna
    "682": INTL_ZONE_PREMIUM,        # Cook Islands
    "683": INTL_ZONE_PREMIUM,        # Niue
    "685": INTL_ZONE_PREMIUM,        # Samoa
    "686": INTL_ZONE_PREMIUM,        # Kiribati
    "687": INTL_ZONE_PREMIUM,        # New Caledonia
    "688": INTL_ZONE_PREMIUM,        # Tuvalu
    "689": INTL_ZONE_PREMIUM,        # French Polynesia
    "690": INTL_ZONE_PREMIUM,        # Tokelau
    "691": INTL_ZONE_PREMIUM,        # Micronesia
    "692": INTL_ZONE_PREMIUM,        # Marshall Islands

    # --- Premium satellite / non-geographic ranges -------------------------
    # International freephone ("800") and shared-cost ("808") are
    # deliberately absent: they are not chargeable destinations.
    "870": INTL_ZONE_SATELLITE,     # Inmarsat
    "875": INTL_ZONE_SATELLITE,     # Maritime mobile service
    "876": INTL_ZONE_SATELLITE,     # Maritime mobile service
    "877": INTL_ZONE_SATELLITE,     # Maritime mobile service
    "878": INTL_ZONE_SATELLITE,     # Universal Personal Telecommunications
    "879": INTL_ZONE_SATELLITE,     # Reserved national mobile/maritime
    "881": INTL_ZONE_SATELLITE,     # Global Mobile Satellite System
    "882": INTL_ZONE_SATELLITE,     # International Networks
    "883": INTL_ZONE_SATELLITE,     # International Networks
    "888": INTL_ZONE_SATELLITE,     # Telecoms for disaster relief
    "979": INTL_ZONE_SATELLITE,     # International premium rate service
}


# Longest country-code key (in digits) to try when prefix-matching above.
# 4 because of the NANP territory keys ("1876" Jamaica, "1242" Bahamas,
# ...), which must beat the bare "1" USA/Canada entry.
INTERNATIONAL_COUNTRY_CODE_MAX_LEN = 4

def _international_zone(destination) -> str | None:
    """The tariff zone for a dialled international destination — same
    trunk-digit/dial-terminator/IDD-marker stripping classify_number()
    applies, so a number classify_number() called International always
    resolves to a zone here too (rather than silently falling back to the
    flat external rate because this rate-lookup never learned to strip the
    leading "9")."""
    if not destination or (isinstance(destination, float) and pd.isna(destination)):
        return None
    digits = _strip_dial_terminator(str(destination).strip().replace(" ", ""))
    if digits.startswith("9"):
        digits = digits[1:]
    digits = _strip_idd_marker(digits)
    return _country_code_zone(digits)


def _rate_per_minute(call_classification: str, destination) -> float:
    """Flat rate for External; zone rate (falling back to the flat rate)
    for International. No SIM-plan override here — see module docstring."""
    if call_classification == CALL_CLASS_INTERNATIONAL:
        zone = _international_zone(destination)
        if zone is None:
            return EXTERNAL_CALL_RATE_KES_PER_MINUTE
        return INTERNATIONAL_ZONE_RATE_KES_PER_MINUTE[zone]
    return EXTERNAL_CALL_RATE_KES_PER_MINUTE


def compute_call_cost(call_classification: str, duration_minutes: float, destination) -> float:
    """Cost for one raw CDR row, in KES (rounded to 2dp)."""
    if call_classification not in CHARGEABLE_CALL_CLASSES:
        return 0.0
    rate = _rate_per_minute(call_classification, destination)
    return round(float(duration_minutes) * rate, 2)


# --- Dataset -> usage_summaries -------------------------------------------

def _load_dataset() -> pd.DataFrame:
    df = pd.read_csv(CDR_DATASET_PATH, dtype={"orig": str, "dest": str, "date": str})
    df["duration_minutes"] = df["duration_sec"].astype(float) / 60.0
    df["call_classification"] = [
        classify_call(orig, dest) for orig, dest in zip(df["orig"], df["dest"])
    ]
    df["computed_cost"] = [
        compute_call_cost(cls, dur, dest)
        for cls, dur, dest in zip(df["call_classification"], df["duration_minutes"], df["dest"])
    ]
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
    dataset = _load_dataset()
    chargeable = dataset[dataset["computed_cost"] > 0]
    not_pbx_origin = ~chargeable["orig"].str.match(INTERNAL_EXTENSION_REGEX)
    if not_pbx_origin.any():
        unattributable = round(chargeable.loc[not_pbx_origin, "computed_cost"].sum(), 2)
        print(f"[{backend.name}] Billing: {not_pbx_origin.sum()} chargeable row(s) "
              f"({unattributable} KES) have no 3-digit PBX origin — excluded, not billed to anyone.")

    by_origin = dataset.groupby(["orig", "month"])["computed_cost"].sum()

    employees = backend.execute(
        "SELECT employee_id, extension_code FROM employees WHERE extension_code IS NOT NULL"
    ).fetchall()
    employee_by_extension = {extension_code: employee_id for employee_id, extension_code in employees}

    written = 0
    for (extension_code, month), total_cost in by_origin.items():
        if not _INTERNAL_RE.match(extension_code):
            continue  # not a 3-digit PBX extension — never billed to an employee
        employee_id = employee_by_extension.get(extension_code)
        if employee_id is None:
            continue
        total_cost = round(float(total_cost), 2)
        existing = backend.execute(
            "SELECT summary_id FROM usage_summaries WHERE employee_id = ? AND month = ?",
            (employee_id, month),
        ).fetchone()
        if existing:
            backend.execute(
                "UPDATE usage_summaries SET total_cost = ?, extension_code = ?, updated_at = ? WHERE summary_id = ?",
                (total_cost, extension_code, now_str(), existing[0]),
            )
        else:
            backend.execute(
                """INSERT INTO usage_summaries (summary_id, employee_id, month, total_cost, extension_code, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (new_id(), employee_id, month, total_cost, extension_code, now_str()),
            )
        written += 1
    backend.commit()
    return written


def main() -> None:
    for backend in open_backend_connections():
        written = run(backend)
        print(f"[{backend.name}] Billing: {written} usage_summary row(s) written from the CDR dataset.")


if __name__ == "__main__":
    main()
