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
public class InvoicesController(TeleSpyDbContext db, IMailService mail, IAuditService audit) : ControllerBase
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

                You can see every month's costs in the TeleSpy app under Spend ledger.
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
}
