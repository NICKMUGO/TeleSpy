// Mirrors Backend/core/decorators.py's load_current_user, registered as
// app.before_request in Backend/app.py — authenticates the JWT for every
// request except the public auth endpoints, and populates the per-request
// current-user info. Error bodies here intentionally keep the OLD
// {"error", "message"} shape: these mirror Backend/core/extensions.py's JWT
// loader callbacks, which live outside api/ in Flask too and were not part
// of the "make api/ errors descriptive" refactor.
using System.IdentityModel.Tokens.Jwt;
using Microsoft.IdentityModel.Tokens;
using TeleSpy.Services;

namespace TeleSpy.Core;

public class CurrentUserMiddleware(RequestDelegate next)
{
    // Path prefixes that never require a signed-in user. Everything else
    // goes through the JWT check below.
    public static readonly string[] PublicPaths =
    [
        "/auth/register",
        "/auth/login",
        "/auth/verify-otp",
        "/auth/resend-otp",
        "/auth/refresh",
        "/auth/forgot-password",
        "/auth/reset-password",
        "/auth/legal-notice",
        "/health",
    ];

    public async Task InvokeAsync(HttpContext context, ICurrentUserAccessor currentUserAccessor,
        IJwtService jwtService, ICacheService cache)
    {
        if (context.Request.Method == "OPTIONS" ||
            PublicPaths.Contains(context.Request.Path.Value, StringComparer.Ordinal))
        {
            await next(context);
            return;
        }

        var header = context.Request.Headers.Authorization.ToString();
        if (string.IsNullOrEmpty(header) || !header.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            await WriteError(context, "unauthenticated", "Authentication required.");
            return;
        }

        var token = header["Bearer ".Length..];
        System.Security.Claims.ClaimsPrincipal principal;
        try
        {
            principal = jwtService.ValidateToken(token, expectedType: "access");
        }
        catch (SecurityTokenExpiredException)
        {
            await WriteError(context, "token_expired", "Your session has expired. Please sign in again.");
            return;
        }
        catch (Exception)
        {
            await WriteError(context, "invalid_token", "Invalid authentication token.");
            return;
        }

        var jti = principal.FindFirstValue(JwtRegisteredClaimNames.Jti);
        if (jti is not null && await cache.IsTokenRevokedAsync(jti))
        {
            await WriteError(context, "token_revoked", "This session has been signed out.");
            return;
        }

        var expClaim = principal.FindFirstValue(JwtRegisteredClaimNames.Exp);
        var expiresAtUtc = expClaim is not null
            ? DateTimeOffset.FromUnixTimeSeconds(long.Parse(expClaim)).UtcDateTime
            : (DateTime?)null;

        currentUserAccessor.Current = new CurrentUserInfo(
            Id: principal.FindFirstValue(JwtRegisteredClaimNames.Sub),
            Role: principal.FindFirstValue("role"),
            RoleId: principal.FindFirstValue("role_id"),
            DepartmentId: principal.FindFirstValue("department_id"),
            Jti: jti,
            ExpiresAtUtc: expiresAtUtc);

        await next(context);
    }

    private static async Task WriteError(HttpContext context, string error, string message)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsJsonAsync(new { error, message });
    }
}
