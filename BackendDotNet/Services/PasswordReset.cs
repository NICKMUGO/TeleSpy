// Shared by AuthController.ForgotPassword and EmployeesController.Create —
// mirrors Backend/api/auth.py's issue_password_reset(), which
// Backend/api/employees.py imports directly (`from api.auth import
// issue_password_reset`). Promoted to a service here rather than one
// controller calling into another, which .NET has no equivalent of anyway.
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Services;

public interface IPasswordResetService
{
    /// <summary>newAccount words the email as a welcome ("set your
    /// password") rather than a reset someone asked for — same link.</summary>
    Task<string> IssuePasswordResetAsync(User user, bool newAccount = false);
}

public class PasswordResetService(TeleSpyDbContext db, IMailService mail) : IPasswordResetService
{
    public async Task<string> IssuePasswordResetAsync(User user, bool newAccount = false)
    {
        var token = Security.GenerateResetToken();
        var expiresMinutes = Config.PasswordResetTokenExpiresMinutes;
        var existing = db.PasswordResetTokens.Where(t => t.UserId == user.UserId);
        db.PasswordResetTokens.RemoveRange(existing);
        db.PasswordResetTokens.Add(new PasswordResetToken
        {
            UserId = user.UserId,
            TokenHash = Security.HashToken(token),
            ExpiresAt = Clock.UtcNow().AddMinutes(expiresMinutes),
        });
        await db.SaveChangesAsync();

        var frontendOrigin = Config.FrontendOrigins.Count > 0 ? Config.FrontendOrigins[0] : "";
        var resetLink = $"{frontendOrigin}/reset-password?token={token}";
        var expiry = $"This link expires in {expiresMinutes} minutes and can only be used once.";
        if (newAccount)
        {
            mail.SendMailSafe(user.Email, "Set your TeleSpy password",
                $"A TeleSpy account has been created for you. Set your password here:\n\n{resetLink}\n\n" +
                $"{expiry} If it has expired, use \"Forgot password?\" on the sign-in page to get a new one.");
        }
        else
        {
            mail.SendMailSafe(user.Email, "Reset your TeleSpy password",
                $"We received a request to reset your TeleSpy password.\n\n{resetLink}\n\n{expiry}");
        }
        return token;
    }
}
