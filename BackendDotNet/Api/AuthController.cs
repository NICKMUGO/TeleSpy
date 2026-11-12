// Authentication + account lifecycle: two-step (password + email OTP) login,
// token refresh, logout, and the password reset / change / bank-enforcement
// flow. There is no self-registration: an account only ever comes from an
// Admin creating the employee (POST /employees), who then sets their own
// password through the reset link that sends. Every action builds its own
// descriptive error body inline (error_type/message/field/hint/status/path/
// method/timestamp) instead of going through a shared response helper.
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

public class LoginRequest
{
    public string? Email { get; set; }
    public string? Password { get; set; }
}

public class MfaTokenRequest
{
    public string? MfaToken { get; set; }
}

public class VerifyOtpRequest : MfaTokenRequest
{
    public string? Otp { get; set; }
    // Set after the person has already been told (via the 409 below) that
    // this account is signed in elsewhere and chosen "sign in here anyway."
    public bool? ForceNewSession { get; set; }
}

public class ForgotPasswordRequest
{
    public string? Email { get; set; }
}

public class ResetPasswordRequest
{
    public string? Token { get; set; }
    public string? NewPassword { get; set; }
    /// <summary>Required the first time an account sets its password (see
    /// ResetPassword): the person accepts the Terms and the Data Protection
    /// notice.</summary>
    public bool? AcceptTerms { get; set; }
}

public class ChangePasswordRequest
{
    public string? CurrentPassword { get; set; }
    public string? NewPassword { get; set; }
}

[ApiController]
public class AuthController(
    TeleSpyDbContext db,
    IJwtService jwtService,
    ICacheService cache,
    IMailService mail,
    IViewerContext viewerContext,
    ICurrentUserAccessor currentUser,
    IPasswordResetService passwordReset,
    IStepUpService stepUp) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

    /// <summary>Emails the signed-in Admin a one-time code that, with their
    /// password, confirms a sensitive action — today, removing an employee
    /// (POST /employees/{id}/remove, or a handover that removes the
    /// holder). Admin only.</summary>
    [HttpPost("/auth/step-up")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> StepUp()
    {
        var actor = await viewerContext.LoadedUserAsync();
        var expiresMinutes = await stepUp.IssueCodeAsync(actor!, "remove an employee from TeleSpy");
        return Ok(new
        {
            data = new { expires_minutes = expiresMinutes },
            message = $"A confirmation code was sent to {actor!.Email}.",
        });
    }

    [HttpGet("/auth/legal-notice")]
    public IActionResult LegalNotice() => Ok(new
    {
        data = new
        {
            terms_and_conditions = Legal.TermsAndConditionsText,
            dpa_notice = Legal.DpaNoticeText(),
            dpa_policy_version = Config.DpaKePolicyVersion,
        },
    });

    [HttpPost("/auth/login")]
    public async Task<IActionResult> Login()
    {
        var data = await RequestBody.ReadJsonSilentAsync<LoginRequest>(Request);
        var email = (data.Email ?? "").Trim().ToLowerInvariant();
        var password = data.Password ?? "";

        var user = await db.Users.Include(u => u.Role).FirstOrDefaultAsync(u => u.Email == email);

        if (user is null)
        {
            return StatusCode(401, new
            {
                error_type = "invalid_credentials",
                message = "Invalid email or password.",
                field = "password",
                hint = "Check the email and password and try again.",
                status = 401,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (!user.IsActive)
        {
            return StatusCode(403, new
            {
                error_type = "account_deactivated",
                message = "This account has been deactivated.",
                hint = "Contact your administrator to reactivate this account.",
                status = 403,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (user.LockedUntil is not null && user.LockedUntil > Clock.UtcNow())
        {
            return StatusCode(423, new
            {
                error_type = "account_locked",
                message = "Account temporarily locked due to repeated failed sign-ins. Try again later.",
                hint = $"The account unlocks automatically at {user.LockedUntil.Value:o}.",
                status = 423,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        if (!user.CheckPassword(password))
        {
            user.FailedLoginAttempts += 1;
            if (user.FailedLoginAttempts >= Constants.MaxFailedLoginAttempts)
            {
                user.LockedUntil = Clock.UtcNow().AddMinutes(Constants.AccountLockoutMinutes);
                user.FailedLoginAttempts = 0;
            }
            await db.SaveChangesAsync();
            return StatusCode(401, new
            {
                error_type = "invalid_credentials",
                message = "Invalid email or password.",
                field = "password",
                hint = "Check the email and password and try again.",
                status = 401,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        user.FailedLoginAttempts = 0;
        user.LockedUntil = null;
        await db.SaveChangesAsync();

        var otp = Security.GenerateOtp();
        var expiresMinutes = Config.MfaOtpExpiresMinutes;
        await cache.SetOtpAsync(user.UserId, Security.HashToken(otp), expiresMinutes * 60);
        mail.SendMailSafe(user.Email, "Your TeleSpy verification code",
            $"Your TeleSpy sign-in code is: {otp}\n\nIt expires in {expiresMinutes} minutes.");

        var mfaToken = jwtService.CreateAccessToken(user.UserId, purpose: "mfa",
            expiresIn: TimeSpan.FromMinutes(Config.JwtMfaTokenExpiresMinutes));

        return Ok(new
        {
            data = new { mfa_token = mfaToken.Value, expires_in_minutes = expiresMinutes },
            message = "Verification code sent to your email.",
        });
    }

    private async Task<User> UserFromMfaTokenAsync(string mfaToken)
    {
        System.Security.Claims.ClaimsPrincipal decoded;
        try
        {
            decoded = jwtService.DecodeAnyToken(mfaToken);
        }
        catch (Exception)
        {
            throw new ValidationFailed("MFA session expired or invalid. Please sign in again.");
        }
        if (decoded.FindFirstValue("purpose") != "mfa")
        {
            throw new ValidationFailed("Invalid MFA session.");
        }
        var userId = decoded.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub);
        var user = userId is not null ? await db.Users.FindAsync(userId) : null;
        if (user is null)
        {
            throw new ValidationFailed("Invalid MFA session.");
        }
        return user;
    }

    [HttpPost("/auth/resend-otp")]
    public async Task<IActionResult> ResendOtp()
    {
        var data = await RequestBody.ReadJsonSilentAsync<MfaTokenRequest>(Request);
        User user;
        try
        {
            user = await UserFromMfaTokenAsync(data.MfaToken ?? "");
        }
        catch (ValidationFailed exc)
        {
            return StatusCode(401, new
            {
                error_type = "invalid_mfa_token",
                message = exc.Message,
                field = "mfa_token",
                hint = "Sign in again to obtain a fresh MFA session token.",
                status = 401,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var otp = Security.GenerateOtp();
        var expiresMinutes = Config.MfaOtpExpiresMinutes;
        await cache.SetOtpAsync(user.UserId, Security.HashToken(otp), expiresMinutes * 60);
        mail.SendMailSafe(user.Email, "Your TeleSpy verification code",
            $"Your TeleSpy sign-in code is: {otp}\n\nIt expires in {expiresMinutes} minutes.");

        return Ok(new { data = new { expires_in_minutes = expiresMinutes }, message = "A new verification code has been sent." });
    }

    [HttpPost("/auth/verify-otp")]
    public async Task<IActionResult> VerifyOtp()
    {
        var data = await RequestBody.ReadJsonSilentAsync<VerifyOtpRequest>(Request);
        User user;
        try
        {
            user = await UserFromMfaTokenAsync(data.MfaToken ?? "");
        }
        catch (ValidationFailed exc)
        {
            return StatusCode(401, new
            {
                error_type = "invalid_mfa_token",
                message = exc.Message,
                field = "mfa_token",
                hint = "Sign in again to obtain a fresh MFA session token.",
                status = 401,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var otp = data.Otp ?? "";
        var storedHash = await cache.GetOtpHashAsync(user.UserId);
        if (string.IsNullOrEmpty(storedHash) || Security.HashToken(otp) != storedHash)
        {
            return StatusCode(401, new
            {
                error_type = "invalid_otp",
                message = "Incorrect or expired code.",
                field = "otp",
                hint = "Request a new code with /auth/resend-otp and enter it before it expires.",
                status = 401,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        // One active session per account (see Services/Cache.cs). Unlike the
        // earlier version of this feature, a colliding second login doesn't
        // silently kick the first one out any more — it's told about the
        // existing session and has to explicitly choose to end it, the way
        // WhatsApp Web asks before linking a new device over an old one.
        var existingSession = await cache.GetActiveSessionAsync(user.UserId);
        if (existingSession is not null && data.ForceNewSession != true)
        {
            return StatusCode(409, new
            {
                error_type = "active_session_exists",
                message = existingSession.Device is not null
                    ? $"This account is already signed in on {existingSession.Device}."
                    : "This account is already signed in elsewhere.",
                hint = "Sign in here anyway and end that session, or cancel and continue on the other device instead.",
                status = 409,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        await cache.ConsumeOtpAsync(user.UserId);

        await db.Entry(user).Reference(u => u.Role).LoadAsync();
        await db.Entry(user).Reference(u => u.Employee).LoadAsync();
        var role = user.Role?.RoleName;
        var departmentId = viewerContext.ViewerDepartmentId(user);

        // Minting a fresh session id here and overwriting the user's stored
        // one is what signs out whatever device/tab was previously signed
        // in — this is the only place that happens, since it's the only
        // place a *new* login actually completes (Refresh() just extends an
        // existing session, it doesn't start one).
        var sessionId = Guid.NewGuid().ToString("N");
        var device = DescribeDevice(Request.Headers.UserAgent.ToString());
        await cache.SetActiveSessionAsync(user.UserId, sessionId, device, (long)Config.JwtRefreshTokenExpires.TotalSeconds);

        var access = jwtService.CreateAccessToken(user.UserId, role, user.RoleId, departmentId, sessionId: sessionId);
        var refresh = jwtService.CreateRefreshToken(user.UserId, role, user.RoleId, departmentId, sessionId);

        return Ok(new
        {
            data = new
            {
                access_token = access.Value,
                refresh_token = refresh.Value,
                user = user.ToDict(),
                must_change_password = user.MustChangePassword,
            },
            message = "Signed in.",
        });
    }

    [HttpPost("/auth/refresh")]
    public async Task<IActionResult> Refresh()
    {
        // Public path (skipped by CurrentUserMiddleware) — this action does
        // its own token check, requiring a refresh-type token specifically,
        // mirroring Flask's @jwt_required(refresh=True). A failure here
        // returns the same {error, message} shape as the global JWT
        // callbacks (Backend/core/extensions.py), since in Flask this 401
        // would come from flask-jwt-extended's own decorator, not from code
        // written in api/auth.py.
        var header = Request.Headers.Authorization.ToString();
        if (string.IsNullOrEmpty(header) || !header.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            return StatusCode(401, new { error = "unauthenticated", message = "Authentication required." });
        }

        System.Security.Claims.ClaimsPrincipal principal;
        try
        {
            principal = jwtService.ValidateToken(header["Bearer ".Length..], expectedType: "refresh");
        }
        catch (SecurityTokenExpiredException)
        {
            return StatusCode(401, new { error = "token_expired", message = "Your session has expired. Please sign in again." });
        }
        catch (Exception)
        {
            return StatusCode(401, new { error = "invalid_token", message = "Invalid authentication token." });
        }

        var userId = principal.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)!;
        var role = principal.FindFirstValue("role");
        var roleId = principal.FindFirstValue("role_id");
        var departmentId = principal.FindFirstValue("department_id");
        var sessionId = principal.FindFirstValue("sid");

        // This refresh token belonged to a session that's since been
        // superseded by a login elsewhere — refuse to extend it. Same
        // check CurrentUserMiddleware does for access tokens; needed here
        // too since /auth/refresh is a public path that skips that
        // middleware and does its own token handling.
        var activeSession = await cache.GetActiveSessionAsync(userId);
        if (sessionId != activeSession?.Sid)
        {
            return StatusCode(401, new
            {
                error = "session_superseded",
                error_type = "session_superseded",
                message = "You've been signed out because this account was signed in from another location.",
                status = 401,
            });
        }

        // A sign-in renews while it's in use: each refresh pushes the end out
        // to JwtRefreshTokenExpires (30 days) from now, but never past
        // SessionMaxLifetime (90 days) after the person actually signed in.
        var now = DateTime.UtcNow;
        var hardEnd = DateTime.SpecifyKind(activeSession!.SignedInAtUtc, DateTimeKind.Utc) + Config.SessionMaxLifetime;
        if (now >= hardEnd)
        {
            await cache.ClearActiveSessionAsync(userId);
            return StatusCode(401, new { error = "token_expired", message = "Your session has expired. Please sign in again." });
        }
        var lifetime = hardEnd - now < Config.JwtRefreshTokenExpires ? hardEnd - now : Config.JwtRefreshTokenExpires;
        await cache.ExtendActiveSessionAsync(userId, lifetime);

        var access = jwtService.CreateAccessToken(userId, role, roleId, departmentId, sessionId: sessionId);
        var refresh = jwtService.CreateRefreshToken(userId, role, roleId, departmentId, sessionId, lifetime);

        return Ok(new { data = new { access_token = access.Value, refresh_token = refresh.Value } });
    }

    [HttpPost("/auth/forgot-password")]
    public async Task<IActionResult> ForgotPassword()
    {
        var data = await RequestBody.ReadJsonSilentAsync<ForgotPasswordRequest>(Request);
        var email = (data.Email ?? "").Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (user is not null)
        {
            await passwordReset.IssuePasswordResetAsync(user);
        }
        // Always the same response, whether or not the account exists, so
        // this can't be used to enumerate registered emails.
        return Ok(new { message = "If an account exists for that email, a password reset link has been sent." });
    }

    /// <summary>Password Bank: reject a password matching the current one or
    /// any of the last PasswordHistoryLimit.</summary>
    private async Task RotatePasswordAsync(User user, string newPassword)
    {
        // The current password is normally the newest history row, but check
        // it directly too, so an account whose history is missing (e.g. a
        // password set outside the app) can't "change" to the same one.
        if (user.CheckPassword(newPassword))
        {
            throw new ValidationFailed($"You can't reuse any of your last {Constants.PasswordHistoryLimit} passwords.");
        }
        var history = await db.PasswordHistories.Where(h => h.UserId == user.UserId)
            .OrderByDescending(h => h.CreatedAt).Take(Constants.PasswordHistoryLimit).ToListAsync();
        foreach (var record in history)
        {
            if (BCrypt.Net.BCrypt.Verify(newPassword, record.PasswordHashValue))
            {
                throw new ValidationFailed($"You can't reuse any of your last {Constants.PasswordHistoryLimit} passwords.");
            }
        }

        user.SetPassword(newPassword);
        user.MustChangePassword = false;
        db.PasswordHistories.Add(new PasswordHistory { UserId = user.UserId, PasswordHashValue = user.PasswordHash, CreatedAt = Clock.UtcNow() });
        await db.SaveChangesAsync();

        // Keep only what the reuse check reads: the last PasswordHistoryLimit
        // hashes. Older ones serve no purpose and are just more to crack if
        // the database ever leaked.
        await db.PasswordHistories.Where(h => h.UserId == user.UserId)
            .OrderByDescending(h => h.CreatedAt).Skip(Constants.PasswordHistoryLimit)
            .ExecuteDeleteAsync();
    }

    [HttpPost("/auth/reset-password")]
    public async Task<IActionResult> ResetPassword()
    {
        var data = await RequestBody.ReadJsonSilentAsync<ResetPasswordRequest>(Request);
        var token = data.Token ?? "";

        string newPassword;
        try
        {
            newPassword = Validators.RequireStrongPassword(data.NewPassword);
        }
        catch (ValidationFailed exc)
        {
            return StatusCode(422, new
            {
                error_type = "validation_error",
                message = exc.Message,
                field = "new_password",
                hint = "Use at least 8 characters with an uppercase letter, a lowercase letter, a digit, and a symbol.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var tokenHash = Security.HashToken(token);
        var record = await db.PasswordResetTokens.FirstOrDefaultAsync(t => t.TokenHash == tokenHash && !t.Consumed);

        if (record is null || record.ExpiresAt < Clock.UtcNow())
        {
            return StatusCode(400, new
            {
                error_type = "invalid_reset_token",
                message = "This reset link is invalid or has expired.",
                field = "token",
                hint = "Request a new password reset link via /auth/forgot-password.",
                status = 400,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var user = await db.Users.FindAsync(record.UserId);
        if (user is null)
        {
            return StatusCode(400, new
            {
                error_type = "invalid_reset_token",
                message = "This reset link is invalid or has expired.",
                field = "token",
                hint = "Request a new password reset link via /auth/forgot-password.",
                status = 400,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        // The Terms are accepted once, when someone first sets up their
        // account (the link from "account created" or an Admin changing an
        // unset-up account's email) — never on a later password reset.
        var firstSetup = user.MustChangePassword;
        if (firstSetup && data.AcceptTerms != true)
        {
            return StatusCode(422, new
            {
                error_type = "terms_required",
                message = "Accept the Terms and Conditions and the Data Protection notice to set up your account.",
                field = "accept_terms",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        try
        {
            await RotatePasswordAsync(user, newPassword);
        }
        catch (ValidationFailed exc)
        {
            return StatusCode(422, new
            {
                error_type = "password_reused",
                message = exc.Message,
                field = "new_password",
                hint = "Choose a password you haven't used recently.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        record.Consumed = true;
        if (firstSetup)
        {
            db.Consents.Add(new Consent
            {
                UserId = user.UserId,
                AcceptedTerms = true,
                AcceptedDpaNotice = true,
                DpaPolicyVersion = Config.DpaKePolicyVersion,
            });
        }
        await db.SaveChangesAsync();
        await db.Entry(user).Reference(u => u.Role).LoadAsync();
        return Ok(new { message = "Password reset. You can now sign in with your new password." });
    }

    /// <summary>What the set-password page needs to know about its link:
    /// whether it's an account's first setup (so it shows the Terms to
    /// accept). Public; the token in the body is the only credential, and
    /// it says nothing else about the account.</summary>
    [HttpPost("/auth/reset-password/info")]
    public async Task<IActionResult> ResetPasswordInfo()
    {
        var data = await RequestBody.ReadJsonSilentAsync<ResetPasswordRequest>(Request);
        var tokenHash = Security.HashToken(data.Token ?? "");
        var record = await db.PasswordResetTokens.FirstOrDefaultAsync(t => t.TokenHash == tokenHash && !t.Consumed);
        var user = record is null || record.ExpiresAt < Clock.UtcNow() ? null : await db.Users.FindAsync(record.UserId);
        if (user is null)
        {
            return StatusCode(400, new
            {
                error_type = "invalid_reset_token",
                message = "This reset link is invalid or has expired.",
                field = "token",
                status = 400,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        return Ok(new { data = new { first_setup = user.MustChangePassword } });
    }

    [HttpPost("/auth/change-password")]
    public async Task<IActionResult> ChangePassword()
    {
        var user = await viewerContext.LoadedUserAsync();
        var data = await RequestBody.ReadJsonSilentAsync<ChangePasswordRequest>(Request);
        if (user is null || !user.CheckPassword(data.CurrentPassword ?? ""))
        {
            return StatusCode(401, new
            {
                error_type = "invalid_credentials",
                message = "Current password is incorrect.",
                field = "current_password",
                hint = "Enter your current password correctly before choosing a new one.",
                status = 401,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        try
        {
            var newPassword = Validators.RequireStrongPassword(data.NewPassword);
            await RotatePasswordAsync(user, newPassword);
        }
        catch (ValidationFailed exc)
        {
            var isReused = exc.Message.Contains("reuse", StringComparison.Ordinal);
            return StatusCode(422, new
            {
                error_type = isReused ? "password_reused" : "validation_error",
                message = exc.Message,
                field = "new_password",
                hint = isReused
                    ? "Choose a password you haven't used recently."
                    : "Use at least 8 characters with an uppercase letter, a lowercase letter, a digit, and a symbol.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        return Ok(new { message = "Password changed." });
    }

    [HttpPost("/auth/logout")]
    public async Task<IActionResult> Logout()
    {
        var cu = currentUser.Current;
        var ttlSeconds = Math.Max(1, (long)((cu.ExpiresAtUtc ?? Clock.UtcNow()) - DateTime.UtcNow).TotalSeconds);
        if (cu.Jti is not null)
        {
            await cache.RevokeTokenAsync(cu.Jti, ttlSeconds);
        }
        if (cu.Id is not null)
        {
            await cache.ClearActiveSessionAsync(cu.Id);
        }
        return Ok(new { message = "Signed out." });
    }

    /// <summary>Cheap browser/OS label for the "signed in on X" message in
    /// VerifyOtp's 409 — not a full User-Agent parser (no dependency added
    /// for it), just enough for a person to recognise their other device
    /// ("Chrome on Windows" vs "Safari on iPhone"). Falls back to null
    /// (generic "elsewhere" wording) for anything it doesn't recognise.</summary>
    private static string? DescribeDevice(string? userAgent)
    {
        if (string.IsNullOrWhiteSpace(userAgent)) return null;

        string? os = userAgent switch
        {
            _ when userAgent.Contains("iPhone") => "iPhone",
            _ when userAgent.Contains("iPad") => "iPad",
            _ when userAgent.Contains("Android") => "Android",
            _ when userAgent.Contains("Windows") => "Windows",
            _ when userAgent.Contains("Macintosh") || userAgent.Contains("Mac OS X") => "Mac",
            _ when userAgent.Contains("Linux") => "Linux",
            _ => null,
        };
        string? browser = userAgent switch
        {
            _ when userAgent.Contains("Edg/") => "Edge",
            _ when userAgent.Contains("OPR/") || userAgent.Contains("Opera") => "Opera",
            _ when userAgent.Contains("Chrome/") => "Chrome",
            _ when userAgent.Contains("CriOS/") => "Chrome",
            _ when userAgent.Contains("Firefox/") => "Firefox",
            _ when userAgent.Contains("Safari/") => "Safari",
            _ => null,
        };

        if (browser is not null && os is not null) return $"{browser} on {os}";
        return browser ?? os;
    }
}
