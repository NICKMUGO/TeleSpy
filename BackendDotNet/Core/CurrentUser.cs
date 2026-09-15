// Mirrors Backend/core/decorators.py + the request-scoped `g.current_user`
// it populates. Flask's `g` (a per-request global) becomes a scoped DI
// service here — CurrentUserAccessor is registered Scoped, so one instance
// lives per request, set once by CurrentUserMiddleware and read by
// controllers/services exactly like `current_user()` was.
namespace TeleSpy.Core;

public record CurrentUserInfo(string? Id, string? Role, string? RoleId, string? DepartmentId,
    string? Jti = null, DateTime? ExpiresAtUtc = null)
{
    public static readonly CurrentUserInfo Empty = new(null, null, null, null);
}

public interface ICurrentUserAccessor
{
    CurrentUserInfo Current { get; set; }
}

public class CurrentUserAccessor : ICurrentUserAccessor
{
    public CurrentUserInfo Current { get; set; } = CurrentUserInfo.Empty;
}
