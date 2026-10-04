using System.Security.Claims;

namespace TeleSpy.Core;

public static class ClaimsExtensions
{
    public static string? FindFirstValue(this ClaimsPrincipal principal, string claimType) =>
        principal.FindFirst(claimType)?.Value;
}
