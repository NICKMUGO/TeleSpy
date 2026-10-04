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
