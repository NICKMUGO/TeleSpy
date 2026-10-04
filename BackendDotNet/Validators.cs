// Mirrors Backend/validators.py field-for-field.
using System.Text.RegularExpressions;

namespace TeleSpy;

public class ValidationFailed(string message) : Exception(message);

public static partial class Validators
{
    public const int PasswordMinLength = 8;

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailRegex();

    [GeneratedRegex(@"^\d{3}$")]
    private static partial Regex ExtensionRegex();

    [GeneratedRegex(@"[A-Z]")]
    private static partial Regex UpperRegex();

    [GeneratedRegex(@"[a-z]")]
    private static partial Regex LowerRegex();

    [GeneratedRegex(@"\d")]
    private static partial Regex DigitRegex();

    [GeneratedRegex(@"[^A-Za-z0-9]")]
    private static partial Regex SymbolRegex();

    public static string RequireValidEmail(string? email)
    {
        if (string.IsNullOrEmpty(email) || !EmailRegex().IsMatch(email))
        {
            throw new ValidationFailed("Enter a valid email address.");
        }
        return email.Trim().ToLowerInvariant();
    }

    public static string RequireStrongPassword(string? password)
    {
        if (string.IsNullOrEmpty(password) || password.Length < PasswordMinLength)
        {
            throw new ValidationFailed($"Password must be at least {PasswordMinLength} characters.");
        }
        if (!(UpperRegex().IsMatch(password) && LowerRegex().IsMatch(password) &&
              DigitRegex().IsMatch(password) && SymbolRegex().IsMatch(password)))
        {
            throw new ValidationFailed(
                "Password must include an uppercase letter, a lowercase letter, a digit, and a symbol.");
        }
        return password;
    }

    public static string RequireValidExtension(string extension)
    {
        if (!ExtensionRegex().IsMatch(extension))
        {
            throw new ValidationFailed("Extension must be exactly 3 digits.");
        }
        return extension;
    }
}
