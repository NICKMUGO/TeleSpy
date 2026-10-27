// Step-up confirmation for sensitive Admin actions — today, removing an
// employee, which stops their line being tracked against them. Being
// signed in isn't enough: the Admin re-enters their password and a fresh
// one-time code emailed to them (POST /auth/step-up). A wrong code burns
// it, so it can't be guessed at; a new one has to be requested.
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Services;

/// <summary>A step-up check that failed. Rendered as a 403 by
/// RuleViolationMiddleware, in the usual api/ error shape.</summary>
public class StepUpFailed(string errorType, string message, string field, string hint) : Exception(message)
{
    public string ErrorType { get; } = errorType;
    public string Field { get; } = field;
    public string Hint { get; } = hint;
}

public interface IStepUpService
{
    /// <summary>Emails the Admin a fresh code, replacing any earlier one.
    /// Returns how many minutes it's valid for.</summary>
    Task<int> IssueCodeAsync(User admin, string actionDescription);

    /// <summary>Throws StepUpFailed unless the password and code are both
    /// right. The code is spent either way.</summary>
    Task VerifyAsync(User admin, string? password, string? code);
}

public class StepUpService(ICacheService cache, IMailService mail) : IStepUpService
{
    public async Task<int> IssueCodeAsync(User admin, string actionDescription)
    {
        var code = Security.GenerateOtp();
        var expiresMinutes = Config.MfaOtpExpiresMinutes;
        await cache.SetStepUpCodeAsync(admin.UserId, Security.HashToken(code), expiresMinutes * 60);
        mail.SendMailSafe(admin.Email, "Confirm a sensitive TeleSpy action",
            $"Someone signed in as you asked to {actionDescription}.\n\n" +
            $"Your confirmation code is: {code}\n\nIt expires in {expiresMinutes} minutes. " +
            "If this wasn't you, don't share the code — change your password and tell your HR manager.");
        return expiresMinutes;
    }

    public async Task VerifyAsync(User admin, string? password, string? code)
    {
        if (string.IsNullOrEmpty(password) || !admin.CheckPassword(password))
        {
            throw new StepUpFailed("step_up_password_invalid", "That password is incorrect.", "password",
                "Enter the password you sign in with.");
        }
        var storedHash = await cache.GetStepUpCodeHashAsync(admin.UserId);
        await cache.ConsumeStepUpCodeAsync(admin.UserId);
        if (string.IsNullOrEmpty(storedHash) || string.IsNullOrEmpty(code) || Security.HashToken(code.Trim()) != storedHash)
        {
            throw new StepUpFailed("step_up_code_invalid", "That confirmation code is wrong or has expired.", "code",
                "Codes work once. Send yourself a new code and enter it before it expires.");
        }
    }
}
