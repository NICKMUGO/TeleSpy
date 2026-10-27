// Emails for events that mean a line is no longer tracked against a
// person: someone being removed (they left the company), and calls made
// on a line nobody holds. Each goes to the HR manager — the Manager of the
// Human Resources department — and every Admin, so no single person can
// make a line quietly drop out of the books.
using Microsoft.EntityFrameworkCore;
using TeleSpy.Models;

namespace TeleSpy.Services;

/// <summary>One employee over their monthly limit, for the HR report.</summary>
public record OverLimitLine(string FullName, string? StaffNumber, string? Department, double Spent, double Limit, bool Removed)
{
    public double Over => Math.Round(Spent - Limit, 2);
}

/// <summary>Calls on one pool line in a CDR batch.</summary>
public record UnassignedLineCalls(string Extension, int Calls, double Minutes, DateTime FirstCallAt, DateTime LastCallAt);

public interface INotificationService
{
    Task NotifyEmployeeRemovedAsync(Employee removed, string reason, string? releasedExtension,
        Employee? replacement, User actor);

    Task NotifyUnassignedLineCallsAsync(IReadOnlyList<UnassignedLineCalls> lines, string? sourceFile);

    /// <summary>Emails the HR manager the month's over-limit staff. Returns
    /// who it went to (empty when there's no HR manager to send to).</summary>
    Task<IReadOnlyList<string>> SendOverLimitReportToHrAsync(string month, IReadOnlyList<OverLimitLine> lines, User actor);
}

public class NotificationService(TeleSpyDbContext db, IMailService mail) : INotificationService
{
    private const string HrCostCentreCode = "HR";
    private const string HrDepartmentName = "Human Resources";

    public async Task NotifyEmployeeRemovedAsync(Employee removed, string reason, string? releasedExtension,
        Employee? replacement, User actor)
    {
        var recipients = await HrManagersAndAdminsAsync();
        // Their own department's manager should know too.
        if (removed.DepartmentId is not null)
        {
            recipients.UnionWith(await ActiveUsers()
                .Where(u => u.Role!.RoleName == TeleSpy.Role.Manager && u.Employee!.DepartmentId == removed.DepartmentId)
                .Select(u => u.Email)
                .ToListAsync());
        }
        recipients.Remove(removed.User?.Email ?? "");

        var actorName = actor.Employee?.FullName ?? actor.Email;
        var line = releasedExtension is null
            ? "They held no line."
            : replacement is null
                ? $"Extension {releasedExtension} has gone back to the pool. Any calls on it are reported to HR and the Admins until it's given to someone."
                : $"Extension {releasedExtension} has been given to {replacement.FullName}.";
        var body =
            $"{removed.FullName} ({removed.StaffNumber ?? "no staff number"}) was removed from TeleSpy " +
            $"by {actorName} on {removed.RemovedAt:yyyy-MM-dd HH:mm} UTC.\n\n" +
            $"Reason: {EmployeeRemoval.Describe(reason)}\n{line}\n\n" +
            "Their login is disabled. Their past calls, bills and invoices are kept.\n\n" +
            "If this removal wasn't expected, contact the Admin team right away.";
        foreach (var to in recipients)
        {
            mail.SendMailSafe(to, $"TeleSpy: {removed.FullName} was removed", body);
        }
    }

    public async Task NotifyUnassignedLineCallsAsync(IReadOnlyList<UnassignedLineCalls> lines, string? sourceFile)
    {
        if (lines.Count == 0) return;
        var recipients = await HrManagersAndAdminsAsync();
        var rows = string.Join("\n", lines.OrderBy(l => l.Extension, StringComparer.Ordinal).Select(l =>
            $"  • Extension {l.Extension}: {l.Calls} call(s), {l.Minutes:0.#} min, {l.FirstCallAt:yyyy-MM-dd} – {l.LastCallAt:yyyy-MM-dd}"));
        var body =
            $"The latest call records{(sourceFile is null ? "" : $" ({sourceFile})")} include calls on lines that " +
            $"nobody held at the time:\n\n{rows}\n\n" +
            "A line in the pool should be silent. Find out who is using it, then give it to them in TeleSpy " +
            "(SIM cards → Change holder). Its spend is listed under unassigned lines until then.";
        foreach (var to in recipients)
        {
            mail.SendMailSafe(to, "TeleSpy: calls on unassigned lines", body);
        }
    }

    public async Task<IReadOnlyList<string>> SendOverLimitReportToHrAsync(string month, IReadOnlyList<OverLimitLine> lines, User actor)
    {
        var recipients = await HrManagersAsync();
        if (recipients.Count == 0) return [];

        var monthName = DateTime.ParseExact(month, "yyyy-MM", System.Globalization.CultureInfo.InvariantCulture).ToString("MMMM yyyy");
        var rows = string.Join("\n", lines.OrderByDescending(l => l.Over).Select(l =>
            $"  • {l.FullName} ({l.StaffNumber ?? "no staff number"}, {l.Department ?? "no department"}){(l.Removed ? " — has since left" : "")}\n" +
            $"      spent KES {l.Spent:N2} against a KES {l.Limit:N2} limit — over by KES {l.Over:N2}"));
        var body = lines.Count == 0
            ? $"Nobody went over their monthly call limit in {monthName}."
            : $"{lines.Count} employee(s) went over their monthly call limit in {monthName}, " +
              $"KES {lines.Sum(l => l.Over):N2} over in total:\n\n{rows}\n\n" +
              "Each of them is invoiced only for the amount over their limit.";
        body += $"\n\nSent from TeleSpy by {actor.Employee?.FullName ?? actor.Email}.";
        foreach (var to in recipients)
        {
            mail.SendMailSafe(to, $"TeleSpy: staff over their call limit in {monthName}", body);
        }
        return recipients.ToList();
    }

    private IQueryable<User> ActiveUsers() => db.Users
        .Where(u => u.IsActive && u.Employee != null && u.Employee.RemovedAt == null);

    private async Task<HashSet<string>> HrManagersAsync()
    {
        var emails = await ActiveUsers()
            .Where(u => u.Role!.RoleName == TeleSpy.Role.Manager && u.Employee!.Department != null &&
                        (u.Employee.Department.CostCentreCode == HrCostCentreCode ||
                         u.Employee.Department.Name == HrDepartmentName))
            .Select(u => u.Email)
            .ToListAsync();
        return new HashSet<string>(emails, StringComparer.OrdinalIgnoreCase);
    }

    private async Task<HashSet<string>> HrManagersAndAdminsAsync()
    {
        var emails = await ActiveUsers()
            .Where(u => u.Role!.RoleName == TeleSpy.Role.Admin ||
                        (u.Role!.RoleName == TeleSpy.Role.Manager && u.Employee!.Department != null &&
                         (u.Employee.Department.CostCentreCode == HrCostCentreCode ||
                          u.Employee.Department.Name == HrDepartmentName)))
            .Select(u => u.Email)
            .ToListAsync();
        return new HashSet<string>(emails, StringComparer.OrdinalIgnoreCase);
    }
}
