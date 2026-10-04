// Mirrors the token shape Backend/api/auth.py builds via flask-jwt-extended
// (create_access_token/create_refresh_token/decode_token): HS256, a `sub`
// claim carrying the user id, a `jti` for the Redis revocation blocklist
// (see Services/Cache.cs), a `type` claim distinguishing access/refresh
// tokens (flask-jwt-extended tracks this internally; we make it an explicit
// claim), and optional role/role_id/department_id/purpose claims exactly
// like auth.py's `additional_claims`.
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace TeleSpy.Core;

public record IssuedToken(string Value, string Jti, DateTime ExpiresAtUtc);

public interface IJwtService
{
    IssuedToken CreateAccessToken(string userId, string? role = null, string? roleId = null,
        string? departmentId = null, string? purpose = null, TimeSpan? expiresIn = null, string? sessionId = null);

    IssuedToken CreateRefreshToken(string userId, string? role, string? roleId, string? departmentId, string? sessionId);

    /// <summary>Validates signature + expiry + `type` claim. Throws
    /// SecurityTokenExpiredException / SecurityTokenException on failure —
    /// mirrors flask-jwt-extended's verify_jwt_in_request().</summary>
    ClaimsPrincipal ValidateToken(string token, string expectedType);

    /// <summary>Decodes any well-formed, correctly-signed token regardless of
    /// type/expiry claim — mirrors flask-jwt-extended's decode_token(), used
    /// only for the short-lived MFA token in the public verify/resend-otp
    /// endpoints. Still rejects an expired or badly-signed token.</summary>
    ClaimsPrincipal DecodeAnyToken(string token);
}

public class JwtService : IJwtService
{
    private const string TypeAccess = "access";
    private const string TypeRefresh = "refresh";

    private static SymmetricSecurityKey SigningKey() =>
        new(Encoding.UTF8.GetBytes(Config.JwtSecretKey));

    private static IssuedToken Create(string userId, string type, TimeSpan expiresIn,
        string? role, string? roleId, string? departmentId, string? purpose, string? sessionId)
    {
        var jti = Guid.NewGuid().ToString("N");
        var now = DateTime.UtcNow;
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId),
            new(JwtRegisteredClaimNames.Jti, jti),
            new("type", type),
        };
        if (role is not null) claims.Add(new Claim("role", role));
        if (roleId is not null) claims.Add(new Claim("role_id", roleId));
        if (departmentId is not null) claims.Add(new Claim("department_id", departmentId));
        if (purpose is not null) claims.Add(new Claim("purpose", purpose));
        // Single-active-session enforcement (see Services/Cache.cs's
        // SetActiveSessionAsync): a fresh login overwrites the user's one
        // Redis-held session id, so every token minted for a previous
        // session — this claim is how CurrentUserMiddleware/Refresh() spot
        // one — stops validating, without needing to enumerate or revoke
        // each token individually.
        if (sessionId is not null) claims.Add(new Claim("sid", sessionId));

        var expires = now.Add(expiresIn);
        var token = new JwtSecurityToken(
            claims: claims,
            notBefore: now,
            expires: expires,
            signingCredentials: new SigningCredentials(SigningKey(), SecurityAlgorithms.HmacSha256));

        return new IssuedToken(new JwtSecurityTokenHandler().WriteToken(token), jti, expires);
    }

    public IssuedToken CreateAccessToken(string userId, string? role = null, string? roleId = null,
        string? departmentId = null, string? purpose = null, TimeSpan? expiresIn = null, string? sessionId = null) =>
        Create(userId, TypeAccess, expiresIn ?? Config.JwtAccessTokenExpires, role, roleId, departmentId, purpose, sessionId);

    public IssuedToken CreateRefreshToken(string userId, string? role, string? roleId, string? departmentId, string? sessionId) =>
        Create(userId, TypeRefresh, Config.JwtRefreshTokenExpires, role, roleId, departmentId, purpose: null, sessionId);

    private static TokenValidationParameters BaseValidationParameters() => new()
    {
        ValidateIssuer = false,
        ValidateAudience = false,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = SigningKey(),
        ClockSkew = TimeSpan.FromSeconds(30),
    };

    // JwtSecurityTokenHandler remaps short claim names ("sub", "role", ...)
    // to long legacy XML-schema claim URIs on validation by default
    // (DefaultInboundClaimTypeMap) — MapInboundClaims = false keeps every
    // claim's Type exactly as issued, which is what every FindFirstValue(...)
    // lookup in this codebase (Sub, "role", "role_id", "purpose", Jti, ...)
    // assumes.
    private static JwtSecurityTokenHandler Handler() => new() { MapInboundClaims = false };

    public ClaimsPrincipal ValidateToken(string token, string expectedType)
    {
        var principal = Handler().ValidateToken(token, BaseValidationParameters(), out _);
        var type = principal.FindFirstValue("type");
        if (type != expectedType)
        {
            throw new SecurityTokenException($"Expected a {expectedType} token.");
        }
        return principal;
    }

    public ClaimsPrincipal DecodeAnyToken(string token) =>
        Handler().ValidateToken(token, BaseValidationParameters(), out _);
}
