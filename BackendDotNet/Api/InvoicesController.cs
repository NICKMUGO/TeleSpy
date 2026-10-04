// Monthly invoice email delivery — admin-triggered (see the frontend
// Invoices page's "Send this month's invoices" action) rather than an
// unattended cron job: /cdr/ingest hit the same "cron can't complete an
// MFA-gated login" wall earlier, so this follows the same resolution
// (a real person, already signed in, clicks a button) rather than adding
// a service-account auth path. Viewing an invoice doesn't need this
// endpoint at all — GET /me/usage's cost_summaries (self) and
// GET /analytics/usage-summary (admin/manager, any employee) already
// carry the same total_cost/month/extension_code data.
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

[ApiController]
public class InvoicesController(TeleSpyDbContext db, IMailService mail, IAuditService audit) : ControllerBase
{
    [HttpPost("/invoices/send-monthly")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> SendMonthly()
    {
        // "This month" here means the most recent month billing.py has
        // actually written — not the calendar's current month, which may
        // have no usage_summaries yet if billing hasn't run for it.
        var latestMonth = await db.UsageSummaries.OrderByDescending(s => s.Month).Select(s => s.Month).FirstOrDefaultAsync();
        if (latestMonth is null)
        {
            return Ok(new { data = new { month = (string?)null, sent = 0 }, message = "No usage_summaries yet — run the ML billing job first." });
        }

        var summaries = await db.UsageSummaries
            .Where(s => s.Month == latestMonth)
            .Include(s => s.Employee!).ThenInclude(e => e.User)
            .ToListAsync();

        var sent = 0;
        foreach (var summary in summaries)
        {
            var email = summary.Employee?.User?.Email;
            if (string.IsNullOrEmpty(email)) continue;

            var body = $"""
                Hello {summary.Employee!.FullName},

                Your TeleSpy telecom usage statement for {summary.Month}:

                  Extension: {summary.ExtensionCode ?? "-"}
                  Total cost: KES {summary.TotalCost:N2}

                View the full breakdown any time in the TeleSpy app under Invoices.

                This is an automated statement, not a payment request.
                """;
            mail.SendMailSafe(email, $"Your TeleSpy usage statement — {summary.Month}", body);
            sent++;
        }

        await audit.RecordAuditAsync("invoices_sent", "usage_summary", actorId: null, actorRole: "admin",
            meta: new Dictionary<string, object?> { ["month"] = latestMonth, ["sent"] = sent });

        return Ok(new { data = new { month = latestMonth, sent }, message = $"Sent {sent} invoice(s) for {latestMonth}." });
    }
}
