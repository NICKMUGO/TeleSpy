// The monthly report (GET /reports/monthly?month=YYYY-MM): everything the
// printable management report shows for one month, summarised — the bill
// rebuilt the way the telco's invoice reads, spend per department, the
// month-on-month trend, the call mix, budgets and limits, anomalies and
// lines. Summary figures only: no employee is named anywhere in it.
//
// An Admin gets the whole company. A Manager gets the same report narrowed
// to their own department, without the company-level bill lines (the fixed
// line charge, its taxes and the invoice comparison).
//
// KES figures come from usage_summaries, which ML/training/billing.py
// fills in per employee per month; nothing is priced here. Individual
// calls carry no cost, so the call mix is reported in calls and minutes.
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

[ApiController]
public partial class ReportsController(TeleSpyDbContext db, IViewerContext viewerContext) : ControllerBase
{
    private const int TrendMonths = 6;
    private const int TopDestinations = 8;

    [GeneratedRegex(@"^(?:\+|000|00)")]
    private static partial Regex IddMarkerRegex();

    private static bool IsMonth(string value) =>
        DateTime.TryParseExact(value, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    private static double Round2(double value) => Math.Round(value, 2);

    /// <summary>A destination as dialled ("90722…", "9000254722…#") down to
    /// its digits: no trunk-access 9, no dial terminator, no IDD marker —
    /// the same stripping billing.py does before it looks up a rate.</summary>
    private static string DestinationDigits(string destination)
    {
        var digits = CallClassification.NormalizeNumber(destination);
        if (digits.StartsWith('9')) digits = digits[1..];
        return IddMarkerRegex().Replace(digits, "");
    }

    private static List<(int Low, int High)> ParsePrefixRanges(string text) =>
        text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(part => part.Split('-', StringSplitOptions.TrimEntries))
            .Where(bounds => bounds.All(b => int.TryParse(b, out _)))
            .Select(bounds => (int.Parse(bounds[0]), int.Parse(bounds[^1])))
            .ToList();

    private static bool IsOnNet(string destination, List<(int Low, int High)> onNetRanges)
    {
        var digits = DestinationDigits(destination);
        if (digits.StartsWith("254", StringComparison.Ordinal)) digits = digits[3..];
        else if (digits.StartsWith('0')) digits = digits[1..];
        if (digits.Length < 3 || !int.TryParse(digits[..3], out var prefix)) return false;
        return onNetRanges.Any(range => range.Low <= prefix && prefix <= range.High);
    }

    [HttpGet("/reports/monthly")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> Monthly()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var isAdmin = viewer!.Role!.RoleName == TeleSpy.Role.Admin;
        var scopeDeptId = isAdmin ? null : viewerContext.ViewerDepartmentId(viewer);

        var departments = await db.Departments.OrderBy(d => d.Name).ToListAsync();
        if (!isAdmin) departments = departments.Where(d => d.DepartmentId == scopeDeptId).ToList();

        // Every employee-month in scope: the source of every KES figure.
        var summaries = await db.UsageSummaries
            .Where(s => isAdmin || s.Employee!.DepartmentId == scopeDeptId)
            .Select(s => new
            {
                s.Month, s.TotalCost, s.ListCost, s.Employee!.DepartmentId,
                Limit = s.Employee.User != null && s.Employee.User.Role != null ? s.Employee.User.Role.CallLimitKshs : null,
            })
            .ToListAsync();
        var months = summaries.Select(s => s.Month).Where(IsMonth).Distinct()
            .OrderByDescending(m => m, StringComparer.Ordinal).ToList();

        var month = Request.Query["month"].ToString();
        if (string.IsNullOrEmpty(month)) month = months.FirstOrDefault() ?? "";
        if (!IsMonth(month))
        {
            return StatusCode(months.Count == 0 ? 404 : 422, new
            {
                error_type = months.Count == 0 ? "no_report_data" : "validation_error",
                message = months.Count == 0 ? "There are no monthly costs to report on yet." : "month must be in YYYY-MM form.",
                field = "month",
                hint = months.Count == 0 ? "Run ML/training/billing.py to produce the monthly costs." : "e.g. 2026-07.",
                status = months.Count == 0 ? 404 : 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = DateTime.UtcNow.ToString("o"),
            });
        }

        var monthStart = DateTime.ParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture);
        var monthEnd = monthStart.AddMonths(1);
        var settings = await db.BillingSettings.FindAsync(BillingConstants.BillingSettingsId) ?? new BillingSettings();

        // The days the call data spans, so a month it only partly covers
        // is reported as partial (as on the reconciliation screen).
        DateTime? dataFrom = null, dataTo = null;
        if (await db.UsageEvents.AnyAsync())
        {
            dataFrom = await db.UsageEvents.MinAsync(e => e.OccuredAt);
            dataTo = await db.UsageEvents.MaxAsync(e => e.OccuredAt);
        }
        (int Covered, int InMonth) Coverage(string m)
        {
            var first = DateTime.ParseExact(m, "yyyy-MM", CultureInfo.InvariantCulture);
            var inMonth = DateTime.DaysInMonth(first.Year, first.Month);
            if (dataFrom is null || dataTo is null) return (inMonth, inMonth);
            var start = dataFrom.Value.Year == first.Year && dataFrom.Value.Month == first.Month ? dataFrom.Value.Day : 1;
            var end = dataTo.Value.Year == first.Year && dataTo.Value.Month == first.Month ? dataTo.Value.Day : inMonth;
            return (Math.Max(0, end - start + 1), inMonth);
        }

        var thisMonth = summaries.Where(s => s.Month == month).ToList();
        var previousMonth = monthStart.AddMonths(-1).ToString("yyyy-MM");
        var listCost = Round2(thisMonth.Sum(s => s.ListCost));
        var callsCost = Round2(thisMonth.Sum(s => s.TotalCost));
        var previousCost = summaries.Any(s => s.Month == previousMonth)
            ? Round2(summaries.Where(s => s.Month == previousMonth).Sum(s => s.TotalCost))
            : (double?)null;

        // --- The bill, laid out as the telco's invoice reads ----------------
        var bill = new Dictionary<string, object?>
        {
            ["calls_list_cost_kes"] = listCost,
            ["discount_kes"] = Round2(listCost - callsCost),
            ["discount_pct"] = listCost > 0 ? Math.Round(100.0 * (listCost - callsCost) / listCost, 1) : 0,
            ["calls_cost_kes"] = callsCost,
            ["previous_calls_cost_kes"] = previousCost,
        };
        if (isAdmin)
        {
            var fixedBeforeTax = settings.FixedMonthlyChargeKes;
            var excise = Round2(fixedBeforeTax * settings.ExciseRatePct / 100.0);
            var fixedWithTax = settings.FixedMonthlyChargeWithTaxKes();
            var total = Round2(callsCost + fixedWithTax);
            var invoice = await db.MonthlyInvoices.FirstOrDefaultAsync(i => i.Month == month);
            bill["fixed_charge_kes"] = Round2(fixedBeforeTax);
            bill["excise_rate_pct"] = settings.ExciseRatePct;
            bill["excise_kes"] = excise;
            bill["vat_rate_pct"] = settings.VatRatePct;
            bill["vat_kes"] = Round2(fixedWithTax - fixedBeforeTax - excise);
            bill["fixed_charge_with_tax_kes"] = fixedWithTax;
            bill["total_kes"] = total;
            bill["invoice_total_kes"] = invoice?.InvoiceTotalKes;
            bill["invoice_note"] = invoice?.Note;
            bill["difference_kes"] = invoice is null ? null : Round2(total - invoice.InvoiceTotalKes);
            bill["difference_pct"] = invoice is null || invoice.InvoiceTotalKes == 0
                ? null
                : Math.Round(100.0 * (total - invoice.InvoiceTotalKes) / invoice.InvoiceTotalKes, 2);
        }

        // --- Spend per department -------------------------------------------
        var departmentRows = departments.Select(d =>
        {
            var rows = thisMonth.Where(s => s.DepartmentId == d.DepartmentId).ToList();
            var cost = Round2(rows.Sum(s => s.TotalCost));
            var before = summaries.Where(s => s.Month == previousMonth && s.DepartmentId == d.DepartmentId).ToList();
            return new
            {
                id = d.DepartmentId,
                name = d.Name,
                cost_centre_code = d.CostCentreCode,
                staff = rows.Count,
                list_cost_kes = Round2(rows.Sum(s => s.ListCost)),
                cost_kes = cost,
                share_pct = callsCost > 0 ? Math.Round(100.0 * cost / callsCost, 1) : 0,
                previous_cost_kes = before.Count > 0 ? Round2(before.Sum(s => s.TotalCost)) : (double?)null,
                budget_ceiling_kes = d.BudgetCeiling,
                budget_used_pct = d.BudgetCeiling is > 0 ? Math.Round(100.0 * cost / d.BudgetCeiling.Value, 1) : (double?)null,
            };
        }).OrderByDescending(d => d.cost_kes).ToList();
        var unassignedCost = Round2(thisMonth.Where(s => s.DepartmentId == null).Sum(s => s.TotalCost));

        // --- Trend: the months up to and including this one -----------------
        var trend = months.Where(m => string.CompareOrdinal(m, month) <= 0).Take(TrendMonths).Reverse().Select(m =>
        {
            var rows = summaries.Where(s => s.Month == m).ToList();
            var (covered, inMonth) = Coverage(m);
            return new
            {
                month = m,
                list_cost_kes = Round2(rows.Sum(s => s.ListCost)),
                cost_kes = Round2(rows.Sum(s => s.TotalCost)),
                days_covered = covered,
                days_in_month = inMonth,
            };
        }).ToList();

        // --- Call mix, in calls and minutes ---------------------------------
        var events = db.UsageEvents.Where(e => e.OccuredAt >= monthStart && e.OccuredAt < monthEnd);
        if (!isAdmin)
        {
            var allocationIds = db.SimAllocations.Where(a => a.Employee!.DepartmentId == scopeDeptId).Select(a => a.AllocationId);
            events = events.Where(e => e.AllocationId != null && allocationIds.Contains(e.AllocationId));
        }
        var calls = await events
            .Select(e => new { e.CallClassification, e.Destination, e.DurationMinutes, e.OccuredAt })
            .ToListAsync();

        var callTypes = new[] { Constants.CallClassInternal, Constants.CallClassExternal, Constants.CallClassInternational }
            .Select(type =>
            {
                var rows = calls.Where(c => c.CallClassification == type).ToList();
                return new { type, calls = rows.Count, minutes = Round2(rows.Sum(c => c.DurationMinutes)) };
            }).ToList();

        // Local calls by network and time band — the four lines the
        // contract discount is set on. A call counts as peak by the hour it
        // started in.
        var onNetRanges = ParsePrefixRanges(settings.OnNetPrefixes);
        var local = calls.Where(c => c.CallClassification == Constants.CallClassExternal)
            .Select(c => new
            {
                OnNet = IsOnNet(c.Destination, onNetRanges),
                Peak = settings.PeakStartHour <= c.OccuredAt.Hour && c.OccuredAt.Hour < settings.PeakEndHour,
                c.DurationMinutes,
            }).ToList();
        var localMix = new[] { (OnNet: true, Peak: true), (OnNet: true, Peak: false), (OnNet: false, Peak: true), (OnNet: false, Peak: false) }
            .Select(band =>
            {
                var rows = local.Where(c => c.OnNet == band.OnNet && c.Peak == band.Peak).ToList();
                return new
                {
                    network = band.OnNet ? "on_net" : "off_net",
                    band = band.Peak ? "peak" : "off_peak",
                    calls = rows.Count,
                    minutes = Round2(rows.Sum(c => c.DurationMinutes)),
                    discount_pct = (band.OnNet, band.Peak) switch
                    {
                        (true, true) => settings.DiscountOnNetPeakPct,
                        (true, false) => settings.DiscountOnNetOffPeakPct,
                        (false, true) => settings.DiscountOffNetPeakPct,
                        _ => settings.DiscountOffNetOffPeakPct,
                    },
                };
            }).ToList();

        // International calls by country: the longest country code the
        // dialled number starts with.
        var countries = (await db.InternationalCallRates.ToListAsync())
            .OrderByDescending(r => r.CountryCode.Length).ToList();
        var destinations = calls.Where(c => c.CallClassification == Constants.CallClassInternational)
            .Select(c =>
            {
                var digits = DestinationDigits(c.Destination);
                var country = countries.FirstOrDefault(r => digits.StartsWith(r.CountryCode, StringComparison.Ordinal));
                return new { Code = country?.CountryCode, Name = country?.CountryName, Rate = country?.RateKesPerMinute, c.DurationMinutes };
            })
            .GroupBy(c => c.Code)
            .Select(g => new
            {
                country_code = g.Key,
                country_name = g.First().Name ?? (g.Key is null ? "Other destinations" : $"+{g.Key}"),
                rate_kes_per_minute = g.First().Rate ?? settings.DefaultInternationalRateKes,
                calls = g.Count(),
                minutes = Round2(g.Sum(c => c.DurationMinutes)),
            })
            .OrderByDescending(d => d.minutes).Take(TopDestinations).ToList();

        // --- Personal limits: how many went over, never who -----------------
        var over = thisMonth.Where(s => s.Limit is not null && s.TotalCost > s.Limit).ToList();

        // --- Anomalies flagged on this month's calls ------------------------
        var flags = db.AnomalyFlags.Where(f => f.Event!.OccuredAt >= monthStart && f.Event.OccuredAt < monthEnd);
        if (!isAdmin)
        {
            var allocationIds = db.SimAllocations.Where(a => a.Employee!.DepartmentId == scopeDeptId).Select(a => a.AllocationId);
            flags = flags.Where(f => f.Event!.AllocationId != null && allocationIds.Contains(f.Event.AllocationId));
        }
        var flagged = await flags.CountAsync();
        var resolved = await flags.CountAsync(f => f.ResolvedAt != null);

        // --- Lines: the inventory as it stands today ------------------------
        var now = Clock.UtcNow();
        var held = db.SimAllocations.Where(a => a.StartAt <= now && (a.EndAt == null || a.EndAt > now));
        int simsTotal, simsActive;
        if (isAdmin)
        {
            simsTotal = await db.SimCards.CountAsync();
            simsActive = await db.SimCards.CountAsync(s => s.LifecycleState == "active");
        }
        else
        {
            // A Manager's lines are the ones their department holds.
            held = held.Where(a => a.Employee!.DepartmentId == scopeDeptId);
            simsTotal = simsActive = await held.Select(a => a.SimId).Distinct().CountAsync();
        }
        var simsAllocated = await held.Select(a => a.SimId).Distinct().CountAsync();

        var (daysCovered, daysInMonth) = Coverage(month);
        return Ok(new
        {
            data = new
            {
                month,
                months,
                scope = new
                {
                    type = isAdmin ? "company" : "department",
                    department_name = isAdmin ? null : departments.FirstOrDefault()?.Name,
                },
                home_network_name = settings.HomeNetworkName,
                days_covered = daysCovered,
                days_in_month = daysInMonth,
                staff_with_spend = thisMonth.Count,
                bill,
                departments = departmentRows,
                unassigned_cost_kes = unassignedCost,
                trend,
                call_types = callTypes,
                local_mix = localMix,
                international_destinations = destinations,
                limits = new
                {
                    over_limit_count = over.Count,
                    over_limit_total_kes = Round2(over.Sum(s => s.TotalCost - s.Limit!.Value)),
                },
                anomalies = new { flagged, resolved, open = flagged - resolved },
                lines = new
                {
                    total = simsTotal,
                    active = simsActive,
                    allocated = simsAllocated,
                    unallocated = Math.Max(0, simsActive - simsAllocated),
                    cost_per_allocated_line_kes = simsAllocated > 0 ? Round2(callsCost / simsAllocated) : (double?)null,
                },
                generated_at = DateTime.UtcNow.ToString("o"),
            },
        });
    }
}
