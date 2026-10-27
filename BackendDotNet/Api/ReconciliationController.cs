// Bill reconciliation (Admin only): for each month the application has
// costs for, the bill it rebuilds from its own records — every employee's
// call costs after the contract discount, plus the line's fixed monthly
// charge with tax — set beside the telco's actual invoice total, which an
// Admin types in. The gap between the two is the measure of how well the
// rates and discounts in /call-rates/local match the real contract.
using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

[ApiController]
public class ReconciliationController(TeleSpyDbContext db, IAuditService audit) : ControllerBase
{
    private IActionResult Error(string errorType, string message, int status, string? field = null, string? hint = null)
    {
        return StatusCode(status, new
        {
            error_type = errorType,
            message,
            field,
            hint,
            status,
            path = Request.Path.Value,
            method = Request.Method,
            timestamp = DateTime.UtcNow.ToString("o"),
        });
    }

    private static bool IsMonth(string value) =>
        DateTime.TryParseExact(value, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    /// <summary>GET /reconciliation — one row per month that has call costs
    /// or an entered invoice, newest first.</summary>
    [HttpGet("/reconciliation")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Get()
    {
        var settings = await db.BillingSettings.FindAsync(BillingConstants.BillingSettingsId);
        if (settings is null)
        {
            return Error("billing_settings_not_found", "Call rate settings have not been initialised.", 404,
                hint: "Restart the API so CallRateBootstrap can seed the defaults.");
        }

        var costs = (await db.UsageSummaries
                .GroupBy(s => s.Month)
                .Select(g => new { Month = g.Key, Calls = g.Sum(s => s.TotalCost), List = g.Sum(s => s.ListCost), Employees = g.Count() })
                .ToListAsync())
            .ToDictionary(c => c.Month);
        // Calls on lines nobody held are on the telco's bill too, so they're
        // part of the rebuilt total — and shown on their own, since nobody
        // was billed for them.
        var unassigned = (await db.UnassignedLineUsages
                .GroupBy(u => u.Month)
                .Select(g => new { Month = g.Key, Calls = g.Sum(u => u.TotalCost), List = g.Sum(u => u.ListCost) })
                .ToListAsync())
            .ToDictionary(u => u.Month);
        var invoices = (await db.MonthlyInvoices.ToListAsync()).ToDictionary(i => i.Month);

        // The days the call data spans, so a month it only partly covers is
        // reported as partial — its rebuilt bill can't match a full invoice.
        DateTime? dataFrom = null, dataTo = null;
        if (await db.UsageEvents.AnyAsync())
        {
            dataFrom = await db.UsageEvents.MinAsync(e => e.OccuredAt);
            dataTo = await db.UsageEvents.MaxAsync(e => e.OccuredAt);
        }

        var fixedWithTax = settings.FixedMonthlyChargeWithTaxKes();
        var rows = costs.Keys.Union(unassigned.Keys).Union(invoices.Keys).Where(IsMonth).OrderByDescending(m => m, StringComparer.Ordinal).Select(month =>
        {
            var first = DateTime.ParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture);
            var daysInMonth = DateTime.DaysInMonth(first.Year, first.Month);
            var daysCovered = 0;
            if (costs.ContainsKey(month) || unassigned.ContainsKey(month))
            {
                daysCovered = daysInMonth;
                if (dataFrom is not null && dataTo is not null)
                {
                    var start = dataFrom.Value.Year == first.Year && dataFrom.Value.Month == first.Month ? dataFrom.Value.Day : 1;
                    var end = dataTo.Value.Year == first.Year && dataTo.Value.Month == first.Month ? dataTo.Value.Day : daysInMonth;
                    daysCovered = Math.Max(0, end - start + 1);
                }
            }

            var cost = costs.GetValueOrDefault(month);
            var pool = unassigned.GetValueOrDefault(month);
            var unassignedCost = Math.Round(pool?.Calls ?? 0, 2);
            var callsCost = Math.Round((cost?.Calls ?? 0) + unassignedCost, 2);
            var listCost = Math.Round((cost?.List ?? 0) + (pool?.List ?? 0), 2);
            // No call costs for the month (an invoice entered ahead of the
            // billing run) -> nothing to rebuild a bill from yet.
            double? rebuilt = cost is null && pool is null ? null : Math.Round(callsCost + fixedWithTax, 2);
            var invoice = invoices.GetValueOrDefault(month);
            double? difference = invoice is null || rebuilt is null ? null : Math.Round(rebuilt.Value - invoice.InvoiceTotalKes, 2);
            return new
            {
                month,
                days_covered = daysCovered,
                days_in_month = daysInMonth,
                employees = cost?.Employees ?? 0,
                calls_list_cost_kes = listCost,
                discount_kes = Math.Round(listCost - callsCost, 2),
                calls_cost_kes = callsCost,
                unassigned_lines_cost_kes = unassignedCost,
                fixed_charge_kes = fixedWithTax,
                rebuilt_total_kes = rebuilt,
                invoice_total_kes = invoice?.InvoiceTotalKes,
                note = invoice?.Note,
                difference_kes = difference,
                difference_pct = difference is null || invoice!.InvoiceTotalKes == 0
                    ? (double?)null
                    : Math.Round(100.0 * difference.Value / invoice.InvoiceTotalKes, 2),
            };
        }).ToList();

        return Ok(new
        {
            data = new
            {
                months = rows,
                fixed_monthly_charge_kes = settings.FixedMonthlyChargeKes,
                fixed_monthly_charge_with_tax_kes = fixedWithTax,
                excise_rate_pct = settings.ExciseRatePct,
                vat_rate_pct = settings.VatRatePct,
            },
        });
    }

    /// <summary>PUT /reconciliation/{month} — record (or, with a null
    /// invoice_total_kes, clear) the telco's invoice total for the calls
    /// made in that month.</summary>
    [HttpPut("/reconciliation/{month}")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Put(string month)
    {
        if (!IsMonth(month))
        {
            return Error("validation_error", "month must be in YYYY-MM form.", 422, "month", "e.g. 2026-07 for July 2026.");
        }
        var data = await RequestBody.ReadJsonSilentAsync<Dictionary<string, JsonElement>>(Request);
        if (!data.TryGetValue("invoice_total_kes", out var totalEl))
        {
            return Error("validation_error", "invoice_total_kes is required.", 422, "invoice_total_kes",
                "Pass the invoice's total amount due in KES, or null to clear it.");
        }

        var invoice = await db.MonthlyInvoices.FindAsync(month);
        if (totalEl.ValueKind == JsonValueKind.Null)
        {
            if (invoice is not null) db.MonthlyInvoices.Remove(invoice);
            await db.SaveChangesAsync();
            await audit.RecordAuditAsync("monthly_invoice_cleared", "monthly_invoice", month);
            return Ok(new { data = (object?)null, message = "Invoice total cleared." });
        }
        if (totalEl.ValueKind != JsonValueKind.Number || totalEl.GetDouble() <= 0)
        {
            return Error("validation_error", "invoice_total_kes must be a positive number.", 422, "invoice_total_kes",
                "Pass the invoice's total amount due in KES, or null to clear it.");
        }

        if (invoice is null)
        {
            invoice = new MonthlyInvoice { Month = month };
            db.MonthlyInvoices.Add(invoice);
        }
        invoice.InvoiceTotalKes = Math.Round(totalEl.GetDouble(), 2);
        if (data.TryGetValue("note", out var noteEl))
        {
            invoice.Note = noteEl.ValueKind == JsonValueKind.String && noteEl.GetString()?.Trim() is { Length: > 0 } note ? note : null;
        }
        invoice.UpdatedAt = Clock.UtcNow();
        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("monthly_invoice_recorded", "monthly_invoice", month,
            meta: new Dictionary<string, object?> { ["invoice_total_kes"] = invoice.InvoiceTotalKes, ["note"] = invoice.Note });
        return Ok(new
        {
            data = new { month, invoice_total_kes = invoice.InvoiceTotalKes, note = invoice.Note },
            message = "Invoice total recorded.",
        });
    }
}
