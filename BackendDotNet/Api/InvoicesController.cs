// Monthly invoice email delivery — admin-triggered (see the frontend
// Invoices page's "Email invoices" action) rather than an unattended cron
// job: /cdr/ingest hit the same "cron can't complete an MFA-gated login"
// wall earlier, so this follows the same resolution (a real person, already
// signed in, clicks a button) rather than adding a service-account auth
// path.
//
// An invoice goes only to an employee whose call costs for the month went
// over their role's limit, and it is for the amount over — the same people
// and figures as GET /budgets/over-limit. Everyone's month-by-month costs
// stay visible in the app (GET /me/usage, GET /analytics/usage-summary)
// whether or not they were invoiced.
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

[ApiController]
public class InvoicesController(
    TeleSpyDbContext db,
    IMailService mail,
    IAuditService audit,
    IViewerContext viewerContext,
    INotificationService notifications) : ControllerBase
{
    public class SendMonthlyRequest
    {
        public string? Month { get; set; }
    }

    [HttpPost("/invoices/send-monthly")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> SendMonthly()
    {
        // The month asked for, or — with none given — the most recent month
        // billing.py has actually written (not the calendar's current
        // month, which may have no usage_summaries yet).
        var request = await RequestBody.ReadJsonSilentAsync<SendMonthlyRequest>(Request);
        var month = string.IsNullOrWhiteSpace(request.Month)
            ? await db.UsageSummaries.OrderByDescending(s => s.Month).Select(s => s.Month).FirstOrDefaultAsync()
            : request.Month.Trim();
        if (month is null)
        {
            return Ok(new { data = new { month = (string?)null, sent = 0, over_limit = 0 }, message = "No usage_summaries yet — run the ML billing job first." });
        }

        var summaries = await db.UsageSummaries
            .Where(s => s.Month == month)
            .Include(s => s.Employee!).ThenInclude(e => e.User!).ThenInclude(u => u.Role)
            .ToListAsync();

        int sent = 0, overLimit = 0;
        foreach (var summary in summaries)
        {
            var limit = summary.Employee?.User?.Role?.CallLimitKshs;
            if (!summary.CheckThresholdBreach(limit)) continue;
            overLimit++;
            var email = summary.Employee!.User!.Email;
            if (string.IsNullOrEmpty(email)) continue;

            var overBy = Math.Round(summary.TotalCost - limit!.Value, 2);
            var body = $"""
                Hello {summary.Employee.FullName},

                Your call costs for {summary.Month} went over your monthly limit.

                  Extension:       {summary.ExtensionCode ?? "-"}
                  Call costs:      KES {summary.TotalCost:N2}
                  Monthly limit:   KES {limit.Value:N2}
                  Amount over:     KES {overBy:N2}

                This invoice is for the amount over the limit: KES {overBy:N2}.

                You can see your monthly costs and limit on your TeleSpy dashboard.
                """;
            mail.SendMailSafe(email, $"TeleSpy invoice for {summary.Month}: KES {overBy:N2} over your limit", body);
            sent++;
        }

        await audit.RecordAuditAsync("invoices_sent", "usage_summary", actorId: null, actorRole: "admin",
            meta: new Dictionary<string, object?> { ["month"] = month, ["sent"] = sent, ["over_limit"] = overLimit });

        return Ok(new
        {
            data = new { month, sent, over_limit = overLimit },
            message = overLimit == 0
                ? $"Nobody went over their limit in {month}, so no invoices were sent."
                : $"Sent {sent} invoice(s) for {month} to the employees over their limit.",
        });
    }

    /// <summary>Emails the HR manager (the Manager of the Human Resources
    /// department) the list of employees over their monthly limit in
    /// `month` — the latest billed month when omitted — with what each
    /// spent, their limit and the amount over. Admin only.</summary>
    [HttpPost("/invoices/report-to-hr")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> ReportToHr()
    {
        var actor = await viewerContext.LoadedUserAsync();
        var request = await RequestBody.ReadJsonSilentAsync<SendMonthlyRequest>(Request);
        var month = string.IsNullOrWhiteSpace(request.Month)
            ? await db.UsageSummaries.OrderByDescending(s => s.Month).Select(s => s.Month).FirstOrDefaultAsync()
            : request.Month.Trim();
        if (month is null || month.Length != 7)
        {
            return StatusCode(422, new
            {
                error_type = "month_required",
                message = "There's no billed month to report on yet.",
                field = "month",
                hint = "Run the ML billing job first, or pass month as YYYY-MM.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = DateTime.UtcNow.ToString("o"),
            });
        }

        var summaries = await db.UsageSummaries
            .Where(s => s.Month == month)
            .Include(s => s.Employee!).ThenInclude(e => e.User!).ThenInclude(u => u.Role)
            .Include(s => s.Employee!).ThenInclude(e => e.Department)
            .ToListAsync();
        var lines = summaries
            .Where(s => s.CheckThresholdBreach(s.Employee?.User?.Role?.CallLimitKshs))
            .Select(s => new OverLimitLine(s.Employee!.FullName, s.Employee.StaffNumber, s.Employee.Department?.Name,
                s.TotalCost, s.Employee.User!.Role!.CallLimitKshs!.Value, s.Employee.RemovedAt is not null))
            .ToList();

        var recipients = await notifications.SendOverLimitReportToHrAsync(month, lines, actor!);
        if (recipients.Count == 0)
        {
            return StatusCode(409, new
            {
                error_type = "no_hr_manager",
                message = "There's no HR manager to email.",
                field = (string?)null,
                hint = "Give someone in the Human Resources department the Manager role, with an active login.",
                status = 409,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = DateTime.UtcNow.ToString("o"),
            });
        }

        await audit.RecordAuditAsync("over_limit_reported_to_hr", "usage_summary",
            actorId: actor!.UserId, actorRole: actor.Role?.RoleName,
            meta: new Dictionary<string, object?> { ["month"] = month, ["over_limit"] = lines.Count, ["recipients"] = recipients.Count });
        return Ok(new
        {
            data = new { month, over_limit = lines.Count, recipients = recipients.Count },
            message = $"Emailed the HR manager the {lines.Count} employee(s) over their limit in {month}.",
        });
    }
}
