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
    Task<string> IssuePasswordResetAsync(User user);
}

public class PasswordResetService(TeleSpyDbContext db, IMailService mail) : IPasswordResetService
{
    public async Task<string> IssuePasswordResetAsync(User user)
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
        mail.SendMailSafe(user.Email, "Reset your TeleSpy password",
            $"We received a request to reset your TeleSpy password.\n\n{resetLink}\n\n" +
            $"This link expires in {expiresMinutes} minutes and can only be used once.");
        return token;
    }
}
