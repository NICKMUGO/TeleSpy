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
        "/auth/login",
        "/auth/verify-otp",
        "/auth/resend-otp",
        "/auth/refresh",
        "/auth/forgot-password",
        "/auth/reset-password",
        "/auth/reset-password/info",
        "/auth/legal-notice",
        "/health",
        // A customer rating a resolved ticket from the stars in its email:
        // the link's token is the only credential (Api/FeedbackController).
        "/feedback",
        "/feedback/r",
        // The ML job's automatic CDR ingest: checks its own shared key
        // (Api/CdrController.IngestAutomatic).
        TeleSpy.Api.CdrController.AutomaticIngestPath,
    ];

    /// <summary>HttpContext.Items key holding the signed-in user's id, for
    /// code that runs outside a normal request scope (Api/TicketsHub).</summary>
    public const string UserIdItem = "telespy.user_id";

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
        string token;
        if (!string.IsNullOrEmpty(header) && header.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            token = header["Bearer ".Length..];
        }
        // Live chat (SignalR): a browser can't set headers on a WebSocket,
        // so the client sends the same access token as ?access_token=.
        // Accepted for the hub only, nowhere else.
        else if (context.Request.Path.StartsWithSegments(TeleSpy.Api.TicketsHub.Path) &&
                 context.Request.Query["access_token"].ToString() is { Length: > 0 } queryToken)
        {
            token = queryToken;
        }
        else
        {
            await WriteError(context, "unauthenticated", "Authentication required.");
            return;
        }

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

        var userId = principal.FindFirstValue(JwtRegisteredClaimNames.Sub);
        var sessionId = principal.FindFirstValue("sid");
        // Single-active-session enforcement: a later login anywhere else
        // overwrites this user's one active session id (see
        // Services/Cache.cs), so a token minted for an earlier session stops
        // validating here — one bad password attempt or a signed-out device
        // does not, since neither of those touches the active session id.
        var activeSession = userId is not null ? await cache.GetActiveSessionAsync(userId) : null;
        if (sessionId != activeSession?.Sid)
        {
            await WriteError(context, "session_superseded",
                "You've been signed out because this account was signed in from another location.");
            return;
        }

        var expClaim = principal.FindFirstValue(JwtRegisteredClaimNames.Exp);
        var expiresAtUtc = expClaim is not null
            ? DateTimeOffset.FromUnixTimeSeconds(long.Parse(expClaim)).UtcDateTime
            : (DateTime?)null;

        currentUserAccessor.Current = new CurrentUserInfo(
            Id: userId,
            Role: principal.FindFirstValue("role"),
            RoleId: principal.FindFirstValue("role_id"),
            DepartmentId: principal.FindFirstValue("department_id"),
            Jti: jti,
            ExpiresAtUtc: expiresAtUtc,
            SessionId: sessionId);
        context.Items[UserIdItem] = userId;

        await next(context);
    }

    private static async Task WriteError(HttpContext context, string error, string message)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        context.Response.ContentType = "application/json";
        // error_type/status too, not just the legacy error/message pair —
        // ApiErrorBody (Frontend/src/lib/api/types.ts) reads error_type and
        // status to decide whether to attempt a token refresh; without them
        // every 401 from this middleware silently fails to trigger that.
        await context.Response.WriteAsJsonAsync(new { error, error_type = error, message, status = 401 });
    }
}
