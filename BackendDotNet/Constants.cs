// Central, code-owned policy constants — mirrors Backend/constants.py
// field-for-field, value-for-value. Nothing here is seed data; it's
// application configuration (roles, cost ceilings, anomaly-detection
// carve-outs, call classification). Call rates live in
// ML/training/billing.py now, not here — see that module's docstring.
namespace TeleSpy;

public static class Role
{
    public const string Admin = "Admin";
    public const string Manager = "Manager";
    public const string Employee = "Employee";
}

public static class Constants
{
    // roles.role_id — a small, fixed reference set, so (unlike the UUIDs used
    // for every other table's PK) role_id is a stable, human-readable slug.
    public static readonly IReadOnlyDictionary<string, string> RoleSlugs = new Dictionary<string, string>
    {
        [Role.Admin] = "admin",
        [Role.Manager] = "manager",
        [Role.Employee] = "employee",
    };

    public static readonly IReadOnlyDictionary<string, string> SlugToRoleName =
        RoleSlugs.ToDictionary(kv => kv.Value, kv => kv.Key);

    public static readonly IReadOnlyList<string> AllRoles = RoleSlugs.Keys.ToList();

    // Roles allowed to self-register through POST /auth/register. Every other
    // role is provisioned by an admin via POST /users so privilege can't be
    // self-granted at signup.
    public static readonly IReadOnlyList<string> SelfRegisterableRoles = new[] { Role.Employee };

    // Default monthly telecom cost ceiling per role, in KES — written into
    // roles.call_limit_kshs by EnsureDefaultRoles() at startup. From then on
    // the database row is the source of truth (editable via PUT /roles/<id>),
    // these constants are only the bootstrap default. Admin has no personal
    // ceiling (null).
    public static readonly IReadOnlyDictionary<string, double?> DefaultCallLimitKes = new Dictionary<string, double?>
    {
        [Role.Admin] = null,
        [Role.Manager] = 2000,
        [Role.Employee] = 1000,
    };

    // Password Bank: a new password may not match the current password or any
    // of this many previous ones.
    public const int PasswordHistoryLimit = 3;

    // Account lockout after repeated failed logins.
    public const int MaxFailedLoginAttempts = 5;
    public const int AccountLockoutMinutes = 15;

    // --- Call classification -----------------------------------------------
    // "9" is the trunk-access digit for *any* outside-line call, local or
    // international — a near-universal PBX convention (still the default in
    // Cisco CUCM route plans, e.g. "9.@"/"9.0011!") — so ClassifyNumber()
    // always strips it first, then classifies what's left:
    //   - "9" + local Kenyan number (0 + 9 digits)       -> External (local)
    //   - "9" + IDD marker (+/00/000) + 254 + number     -> External (local,
    //     dialled in full international form)
    //   - "9" + IDD marker (+/00/000) + other cc+number  -> International

    // Kenyan number in plain local form: leading "0" + 9 digits, e.g.
    // 0712345678 — what a +254... number collapses to once normalised, and
    // what's left after stripping "9" from a local external call, e.g.
    // "90712345678".
    public const string KenyanLocalNumberRegex = @"^0\d{9}$";

    // International call: "+" (or "00" / "000"), then the country code, then
    // the subscriber number (local leading "0" dropped), 6-15 digits after
    // the prefix. Kenya (+254) deliberately excluded — that's a Kenyan call
    // written internationally, normalised + billed as a Kenyan external call.
    // Matched against the number *after* the leading "9" has been stripped.
    public const string InternationalNumberRegex = @"^(?:\+|00|000)(?!254)\d{6,15}$";

    // Recognises a Kenyan number dialled in international form
    // (+254..., 00254..., 000254...), after the leading "9" has been
    // stripped. Captured group 1 is the national part, re-prefixed with "0"
    // to get the local form.
    public const string KenyanInternationalPrefixRegex = @"^(?:\+|00|000)254(\d+)$";

    // Internal call: a bare 3-digit extension, e.g. 206, 389, 400. Never
    // charged.
    public const string InternalExtensionRegex = @"^\d{3}$";

    // Extensions permanently excluded from anomaly detection even though
    // their calls are still logged normally.
    public static readonly IReadOnlySet<string> AnomalyExcludedExtensions = new HashSet<string> { "256", "400" };

    public const string CallClassInternal = "Internal";
    public const string CallClassExternal = "External";
    public const string CallClassInternational = "International";
    public const string CallClassUnknown = "Unknown";
}


public static class BillingConstants
{
    // Bootstrap defaults for the Admin-editable call-rate tables — see
    // Core/Startup.cs's CallRateBootstrap and Models/Entities.cs's
    // BillingSettings/InternationalCallRate docs. From then on the database
    // rows are the source of truth (editable via PATCH /call-rates/local and
    // PATCH /call-rates/international/<country_code>); these constants are
    // only the bootstrap default, mirroring how Constants.DefaultCallLimitKes
    // seeds roles.call_limit_kshs.
    public const string BillingSettingsId = "default";

    // Safaricom's published local (on-net + off-net) tariff.
    public const double DefaultPeakRateKes = 4.87;
    public const double DefaultOffPeakRateKes = 2.50;
    public const int DefaultPeakStartHour = 8;   // 08:00, inclusive
    public const int DefaultPeakEndHour = 22;    // 22:00, exclusive
    public const double DefaultInternationalRateKes = 40.0; // fallback for an unpriced country code

    // Per-country KES/minute, sourced from
    // ML/training/International_Calling_Rates.pdf (Safaricom international
    // rates). (CountryCode, CountryName-or-null, RateKesPerMinute). Only
    // inserted for country codes that don't already have a row — an
    // Admin's edit is never overwritten by this bootstrap running again.
    public static readonly (string CountryCode, string? CountryName, double RateKesPerMinute)[] InternationalCallRateSeed =
    [
        ("1", "USA/Canada", 5.0),
        ("7", "Russia/Kazakhstan", 40.0),
        ("20", "Egypt", 30.0),
        ("27", "South Africa", 35.0),
        ("30", "Greece", 40.0),
        ("31", "Netherlands", 40.0),
        ("32", "Belgium", 60.0),
        ("33", "France", 40.0),
        ("34", "Spain", 60.0),
        ("36", "Hungary", 40.0),
        ("39", "Italy", 140.0),
        ("40", "Romania", 40.0),
        ("41", "Switzerland", 70.0),
        ("43", "Austria", 40.0),
        ("44", "United Kingdom", 45.0),
        ("45", "Denmark", 75.0),
        ("46", "Sweden", 55.0),
        ("47", "Norway/Svalbard", 40.0),
        ("48", "Poland", 40.0),
        ("49", "Germany", 45.0),
        ("51", "Peru", 40.0),
        ("52", "Mexico", 40.0),
        ("54", "Argentina", 40.0),
        ("55", "Brazil", 40.0),
        ("56", "Chile", 40.0),
        ("57", "Colombia", 40.0),
        ("58", "Venezuela", 40.0),
        ("60", "Malaysia", 40.0),
        ("61", "Australia", 40.0),
        ("62", "Indonesia", 40.0),
        ("63", "Philippines", 40.0),
        ("64", "New Zealand", 40.0),
        ("65", "Singapore", 40.0),
        ("66", "Thailand", 40.0),
        ("81", "Japan", 40.0),
        ("82", "South Korea", 40.0),
        ("84", "Vietnam", 40.0),
        ("86", "China", 10.0),
        ("90", "Turkey", 45.0),
        ("91", "India", 10.0),
        ("92", "Pakistan", 40.0),
        ("93", "Afghanistan", 40.0),
        ("94", "Sri Lanka", 40.0),
        ("95", "Myanmar", 40.0),
        ("98", "Iran", 45.0),
        ("211", "South Sudan", 15.0),
        ("212", "Morocco/Western Sahara", 130.0),
        ("213", "Algeria", 150.0),
        ("216", "Tunisia", 170.0),
        ("218", "Libya", 110.0),
        ("220", "Gambia", 90.0),
        ("221", "Senegal", 80.0),
        ("222", "Mauritania", 150.0),
        ("223", "Mali", 50.0),
        ("224", "Guinea", 120.0),
        ("225", "Cote d'Ivoire", 80.0),
        ("226", "Burkina Faso", 80.0),
        ("227", "Niger", 50.0),
        ("228", "Togo", 65.0),
        ("229", "Benin", 65.0),
        ("230", "Mauritius", 30.0),
        ("231", "Liberia", 90.0),
        ("232", "Sierra Leone", 100.0),
        ("233", "Ghana", 50.0),
        ("234", "Nigeria", 30.0),
        ("235", "Chad", 40.0),
        ("236", "Central African Republic", 130.0),
        ("237", "Cameroon", 70.0),
        ("238", "Cape Verde", 60.0),
        ("239", "Sao Tome and Principe", 100.0),
        ("240", "Equatorial Guinea", 90.0),
        ("241", "Gabon", 80.0),
        ("242", "Congo (Brazzaville)", 125.0),
        ("243", "DR Congo (Kinshasa)", 90.0),
        ("244", "Angola", 35.0),
        ("245", "Guinea-Bissau", 120.0),
        ("246", "Diego Garcia (BIOT)", 200.0),
        ("247", "Ascension Island", 200.0),
        ("248", "Seychelles", 135.0),
        ("249", "Sudan", 30.0),
        ("250", "Rwanda", 15.0),
        ("251", "Ethiopia", 50.0),
        ("252", "Somalia", 75.0),
        ("253", "Djibouti", 65.0),
        ("255", "Tanzania", 15.0),
        ("256", "Uganda", 15.0),
        ("257", "Burundi", 110.0),
        ("258", "Mozambique", 70.0),
        ("260", "Zambia", 90.0),
        ("261", "Madagascar", 130.0),
        ("262", "Reunion/Mayotte", 30.0),
        ("263", "Zimbabwe", 105.0),
        ("264", "Namibia", 30.0),
        ("265", "Malawi", 95.0),
        ("266", "Lesotho", 100.0),
        ("267", "Botswana", 50.0),
        ("268", "Eswatini", 45.0),
        ("269", "Comoros", 120.0),
        ("290", "Saint Helena / Tristan da Cunha", 690.0),
        ("291", "Eritrea", 45.0),
        ("297", "Aruba", 45.0),
        ("298", "Faroe Islands", 40.0),
        ("299", "Greenland", 125.0),
        ("350", "Gibraltar", 40.0),
        ("351", "Portugal", 40.0),
        ("352", "Luxembourg", 40.0),
        ("353", "Ireland", 170.0),
        ("354", "Iceland", 40.0),
        ("355", "Albania", 80.0),
        ("356", "Malta", 90.0),
        ("358", "Finland/Aland Islands", 75.0),
        ("359", "Bulgaria", 70.0),
        ("370", "Lithuania", 85.0),
        ("371", "Latvia", 70.0),
        ("372", "Estonia", 75.0),
        ("373", "Moldova", 70.0),
        ("374", "Armenia", 40.0),
        ("375", "Belarus", 80.0),
        ("376", "Andorra", 40.0),
        ("377", "Monaco", 90.0),
        ("378", "San Marino", 40.0),
        ("380", "Ukraine", 75.0),
        ("381", "Serbia", 90.0),
        ("382", "Montenegro", 80.0),
        ("386", "Slovenia", 70.0),
        ("387", "Bosnia and Herzegovina", 85.0),
        ("389", "North Macedonia", 95.0),
        ("420", "Czechia", 40.0),
        ("421", "Slovakia", 40.0),
        ("423", "Liechtenstein", 40.0),
        ("500", "Falkland Islands", 300.0),
        ("501", "Belize", 45.0),
        ("502", "Guatemala", 40.0),
        ("503", "El Salvador", 40.0),
        ("504", "Honduras", 40.0),
        ("505", "Nicaragua", 50.0),
        ("507", "Panama", 40.0),
        ("508", "Saint Pierre and Miquelon", 50.0),
        ("509", "Haiti", 40.0),
        ("590", "Guadeloupe/St Barthelemy/St Martin", 40.0),
        ("591", "Bolivia", 45.0),
        ("592", "Guyana", 40.0),
        ("593", "Ecuador", 45.0),
        ("594", "French Guiana", 40.0),
        ("595", "Paraguay", 40.0),
        ("596", "Martinique", 40.0),
        ("597", "Suriname", 65.0),
        ("598", "Uruguay", 40.0),
        ("599", "Curacao/Caribbean Netherlands", 40.0),
        ("670", "Timor-Leste", 40.0),
        ("672", "Norfolk Island / Australian Antarctic", 40.0),
        ("673", "Brunei", 40.0),
        ("674", "Nauru", 200.0),
        ("675", "Papua New Guinea", 250.0),
        ("676", "Tonga", 205.0),
        ("677", "Solomon Islands", 200.0),
        ("678", "Vanuatu", 130.0),
        ("679", "Fiji", 60.0),
        ("680", "Palau", 200.0),
        ("681", "Wallis and Futuna", 40.0),
        ("682", "Cook Islands", 220.0),
        ("683", "Niue", 70.0),
        ("685", "Samoa", 130.0),
        ("686", "Kiribati", 370.0),
        ("687", "New Caledonia", 80.0),
        ("688", "Tuvalu", 40.0),
        ("689", "French Polynesia", 80.0),
        ("690", "Tokelau", 350.0),
        ("691", "Micronesia", 105.0),
        ("692", "Marshall Islands", 50.0),
        ("850", "North Korea", 145.0),
        ("852", "Hong Kong", 40.0),
        ("853", "Macau", 40.0),
        ("855", "Cambodia", 40.0),
        ("856", "Laos", 40.0),
        ("870", "Inmarsat", 1120.0),
        ("871", "Inmarsat (Atlantic-East)", 1120.0),
        ("872", "Inmarsat (Pacific)", 1120.0),
        ("873", "Inmarsat (Indian)", 1120.0),
        ("874", "Inmarsat (Atlantic-West)", 1120.0),
        ("880", "Bangladesh", 40.0),
        ("881", "Global Mobile Satellite System", 1120.0),
        ("882", "International Networks", 1120.0),
        ("886", "Taiwan", 40.0),
        ("960", "Maldives", 170.0),
        ("961", "Lebanon", 40.0),
        ("962", "Jordan", 40.0),
        ("963", "Syria", 40.0),
        ("964", "Iraq", 40.0),
        ("965", "Kuwait", 40.0),
        ("966", "Saudi Arabia", 40.0),
        ("967", "Yemen", 40.0),
        ("968", "Oman", 40.0),
        ("970", "Palestine", 40.0),
        ("971", "United Arab Emirates", 35.0),
        ("972", "Israel", 40.0),
        ("973", "Bahrain", 40.0),
        ("974", "Qatar", 40.0),
        ("975", "Bhutan", 40.0),
        ("976", "Mongolia", 40.0),
        ("977", "Nepal", 40.0),
        ("992", "Tajikistan", 40.0),
        ("993", "Turkmenistan", 40.0),
        ("994", "Azerbaijan", 75.0),
        ("995", "Georgia", 60.0),
        ("996", "Kyrgyzstan", 40.0),
        ("998", "Uzbekistan", 40.0),
        ("1242", "Bahamas", 55.0),
        ("1246", "Barbados", 40.0),
        ("1264", "Anguilla", 60.0),
        ("1268", "Antigua and Barbuda", 40.0),
        ("1284", "British Virgin Islands", 40.0),
        ("1340", "US Virgin Islands", 40.0),
        ("1345", "Cayman Islands", 40.0),
        ("1441", "Bermuda", 40.0),
        ("1473", "Grenada", 40.0),
        ("1649", "Turks and Caicos Islands", 40.0),
        ("1658", "Jamaica (overlay)", 55.0),
        ("1664", "Montserrat", 40.0),
        ("1670", "Northern Mariana Islands", 40.0),
        ("1671", "Guam", 40.0),
        ("1684", "American Samoa", 40.0),
        ("1758", "Saint Lucia", 40.0),
        ("1767", "Dominica", 55.0),
        ("1784", "Saint Vincent and the Grenadines", 40.0),
        ("1787", "Puerto Rico", 40.0),
        ("1808", null, 40.0),
        ("1809", "Dominican Republic", 40.0),
        ("1829", "Dominican Republic (overlay)", 40.0),
        ("1849", "Dominican Republic (overlay)", 40.0),
        ("1868", "Trinidad and Tobago", 40.0),
        ("1869", "Saint Kitts and Nevis", 40.0),
        ("1876", "Jamaica", 55.0),
        ("1907", "Alaska (USA)", 40.0),
        ("1939", "Puerto Rico (overlay)", 40.0),
        ("34928", null, 40.0),
    ];
}
