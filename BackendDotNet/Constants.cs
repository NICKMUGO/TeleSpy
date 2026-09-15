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
