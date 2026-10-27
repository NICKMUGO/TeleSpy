// One shared clock for the app layer — mirrors Backend/core/time.py.
namespace TeleSpy.Core;

public static class Clock
{
    // Naive UTC, deliberately — see the long comment on Python's
    // models.models._utcnow() for why (SQLite drops tzinfo on write, so
    // mixing naive/aware values blows up every expiry comparison). EF Core
    // maps DateTime (Kind unspecified) the same way; we always store and
    // compare UTC wall-clock values, never DateTimeOffset/local time.
    public static DateTime UtcNow() => DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Unspecified);
}

/// <summary>JSON form of the app's own timestamps (created/updated/audit…):
/// they're stored as naive UTC (see Clock), so they're sent marked as UTC —
/// "…Z" — and the browser converts them to Nairobi time. Without the marker
/// it reads them as local and shows them 3 hours early. Not for CDR call
/// times, which are already Nairobi local.</summary>
public static class UtcTime
{
    public static string Iso(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc).ToString("o");
    public static string? Iso(DateTime? value) => value is null ? null : Iso(value.Value);
}
