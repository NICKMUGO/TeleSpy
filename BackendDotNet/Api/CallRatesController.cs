// Call rates (Admin only): the local (Kenyan) peak/off-peak tariff, the
// contract discount per call type, the line's fixed monthly charge and its
// taxes, and the per-country international rate table — both editable at runtime so a
// Safaricom pricing change doesn't require a code deploy. Mirrors
// Backend/api/call_rates.py 1:1. Actual billing still happens in
// ML/training/billing.py, which reads these same tables.
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

[ApiController]
public class CallRatesController(TeleSpyDbContext db) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

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
            timestamp = NowIso(),
        });
    }

    /// <summary>Absent -> Ok(null, null); present and valid -> Ok(value, null);
    /// present and invalid -> Ok(null, "the field name", for the caller to
    /// build a validation-error response from).</summary>
    private static (double? Value, string? InvalidField) ReadPositiveNumber(Dictionary<string, JsonElement> data, string field)
    {
        if (!data.TryGetValue(field, out var el)) return (null, null);
        if (el.ValueKind != JsonValueKind.Number || el.GetDouble() <= 0) return (null, field);
        return (el.GetDouble(), null);
    }

    /// <summary>Same contract as ReadPositiveNumber, for a percentage: any
    /// number from 0 to 100 inclusive.</summary>
    private static (double? Value, string? InvalidField) ReadPercentage(Dictionary<string, JsonElement> data, string field)
    {
        if (!data.TryGetValue(field, out var el)) return (null, null);
        if (el.ValueKind != JsonValueKind.Number || el.GetDouble() is < 0 or > 100) return (null, field);
        return (el.GetDouble(), null);
    }

    [HttpGet("/call-rates/local")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> GetLocal()
    {
        var settings = await db.BillingSettings.FindAsync(BillingConstants.BillingSettingsId);
        if (settings is null)
        {
            return Error("billing_settings_not_found", "Local call rate settings have not been initialised.", 404,
                hint: "Restart the API so CallRateBootstrap can seed the defaults.");
        }
        return Ok(new { data = settings.ToDict() });
    }

    [HttpPatch("/call-rates/local")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> PatchLocal()
    {
        var settings = await db.BillingSettings.FindAsync(BillingConstants.BillingSettingsId);
        if (settings is null)
        {
            return Error("billing_settings_not_found", "Local call rate settings have not been initialised.", 404,
                hint: "Restart the API so CallRateBootstrap can seed the defaults.");
        }
        var data = await RequestBody.ReadJsonSilentAsync<Dictionary<string, JsonElement>>(Request);

        var (peakRate, peakRateInvalid) = ReadPositiveNumber(data, "peak_rate_kes");
        var (offPeakRate, offPeakRateInvalid) = ReadPositiveNumber(data, "off_peak_rate_kes");
        var (defaultIntlRate, defaultIntlRateInvalid) = ReadPositiveNumber(data, "default_international_rate_kes");
        var invalidField = peakRateInvalid ?? offPeakRateInvalid ?? defaultIntlRateInvalid;
        if (invalidField is not null)
        {
            return Error("validation_error", $"{invalidField} must be a positive number.", 422, invalidField,
                "Pass a positive KES/minute figure.");
        }

        // Discounts and tax rates: percentages, 0-100.
        var percentages = new Dictionary<string, double?>();
        foreach (var field in new[]
                 {
                     "discount_on_net_peak_pct", "discount_on_net_off_peak_pct", "discount_off_net_peak_pct",
                     "discount_off_net_off_peak_pct", "discount_international_pct", "excise_rate_pct", "vat_rate_pct",
                 })
        {
            var (value, invalid) = ReadPercentage(data, field);
            if (invalid is not null)
            {
                return Error("validation_error", $"{invalid} must be a percentage between 0 and 100.", 422, invalid,
                    "Pass a number from 0 to 100, e.g. 54 for a 54% discount.");
            }
            percentages[field] = value;
        }
        // The fixed monthly charge may be 0 (no rental), but not negative.
        double? fixedMonthlyCharge = null;
        if (data.TryGetValue("fixed_monthly_charge_kes", out var fixedEl))
        {
            if (fixedEl.ValueKind != JsonValueKind.Number || fixedEl.GetDouble() < 0)
            {
                return Error("validation_error", "fixed_monthly_charge_kes must be zero or a positive number.", 422,
                    "fixed_monthly_charge_kes", "Pass the monthly rental before tax, in KES.");
            }
            fixedMonthlyCharge = fixedEl.GetDouble();
        }

        // The home network: a display name, and its number prefixes as a
        // comma-separated list of 3-digit prefixes or ranges of them.
        string? homeNetworkName = null;
        if (data.TryGetValue("home_network_name", out var networkEl))
        {
            homeNetworkName = networkEl.ValueKind == JsonValueKind.String ? networkEl.GetString()?.Trim() : null;
            if (string.IsNullOrEmpty(homeNetworkName) || homeNetworkName.Length > 60)
            {
                return Error("validation_error", "home_network_name must be 1 to 60 characters.", 422,
                    "home_network_name", "The telco the organisation's line is with, e.g. Safaricom.");
            }
        }
        string? onNetPrefixes = null;
        if (data.TryGetValue("on_net_prefixes", out var prefixesEl))
        {
            var raw = prefixesEl.ValueKind == JsonValueKind.String ? prefixesEl.GetString() ?? "" : "";
            var parts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var wellFormed = parts.Length > 0 && parts.All(part =>
            {
                var match = System.Text.RegularExpressions.Regex.Match(part, @"^(\d{3})(?:\s*-\s*(\d{3}))?$");
                return match.Success && (!match.Groups[2].Success ||
                    int.Parse(match.Groups[1].Value) <= int.Parse(match.Groups[2].Value));
            });
            onNetPrefixes = string.Join(", ", parts);
            if (!wellFormed || onNetPrefixes.Length > 500)
            {
                return Error("validation_error", "on_net_prefixes must be a comma-separated list of 3-digit prefixes or ranges.", 422,
                    "on_net_prefixes", "e.g. 700-729, 740-743, 748 — the first three digits of a number after its leading 0.");
            }
        }

        var peakStartHour = settings.PeakStartHour;
        var peakEndHour = settings.PeakEndHour;
        if (data.TryGetValue("peak_start_hour", out var startEl))
        {
            if (startEl.ValueKind != JsonValueKind.Number || startEl.GetInt32() is < 0 or > 24)
            {
                return Error("validation_error", "peak_start_hour must be an integer hour between 0 and 24.", 422,
                    "peak_start_hour", "Hours are 24-hour, e.g. 8 for 08:00.");
            }
            peakStartHour = startEl.GetInt32();
        }
        if (data.TryGetValue("peak_end_hour", out var endEl))
        {
            if (endEl.ValueKind != JsonValueKind.Number || endEl.GetInt32() is < 0 or > 24)
            {
                return Error("validation_error", "peak_end_hour must be an integer hour between 0 and 24.", 422,
                    "peak_end_hour", "Hours are 24-hour, e.g. 22 for 22:00.");
            }
            peakEndHour = endEl.GetInt32();
        }
        if (peakStartHour >= peakEndHour)
        {
            return Error("validation_error", "peak_start_hour must be before peak_end_hour.", 422, "peak_start_hour",
                "e.g. peak_start_hour=8, peak_end_hour=22 for Safaricom's 08:00-22:00 peak window.");
        }

        if (peakRate is not null) settings.PeakRateKes = peakRate.Value;
        if (offPeakRate is not null) settings.OffPeakRateKes = offPeakRate.Value;
        if (defaultIntlRate is not null) settings.DefaultInternationalRateKes = defaultIntlRate.Value;
        settings.DiscountOnNetPeakPct = percentages["discount_on_net_peak_pct"] ?? settings.DiscountOnNetPeakPct;
        settings.DiscountOnNetOffPeakPct = percentages["discount_on_net_off_peak_pct"] ?? settings.DiscountOnNetOffPeakPct;
        settings.DiscountOffNetPeakPct = percentages["discount_off_net_peak_pct"] ?? settings.DiscountOffNetPeakPct;
        settings.DiscountOffNetOffPeakPct = percentages["discount_off_net_off_peak_pct"] ?? settings.DiscountOffNetOffPeakPct;
        settings.DiscountInternationalPct = percentages["discount_international_pct"] ?? settings.DiscountInternationalPct;
        settings.ExciseRatePct = percentages["excise_rate_pct"] ?? settings.ExciseRatePct;
        settings.VatRatePct = percentages["vat_rate_pct"] ?? settings.VatRatePct;
        if (fixedMonthlyCharge is not null) settings.FixedMonthlyChargeKes = fixedMonthlyCharge.Value;
        if (homeNetworkName is not null) settings.HomeNetworkName = homeNetworkName;
        if (onNetPrefixes is not null) settings.OnNetPrefixes = onNetPrefixes;
        settings.PeakStartHour = peakStartHour;
        settings.PeakEndHour = peakEndHour;
        settings.UpdatedAt = Clock.UtcNow();

        await db.SaveChangesAsync();
        return Ok(new { data = settings.ToDict(), message = "Local call rate updated." });
    }

    [HttpGet("/call-rates/international")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> GetInternational()
    {
        var rates = await db.InternationalCallRates.OrderBy(r => r.CountryCode).ToListAsync();
        return Ok(new { data = rates.Select(r => r.ToDict()).ToList() });
    }

    [HttpPatch("/call-rates/international/{countryCode}")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> PatchInternational(string countryCode)
    {
        var rate = await db.InternationalCallRates.FirstOrDefaultAsync(r => r.CountryCode == countryCode);
        if (rate is null)
        {
            return Error("international_call_rate_not_found", "No international call rate exists for that country code.", 404,
                "country_code", "Check GET /call-rates/international for valid country codes.");
        }
        var data = await RequestBody.ReadJsonSilentAsync<Dictionary<string, JsonElement>>(Request);

        if (data.TryGetValue("rate_kes_per_minute", out var rateEl))
        {
            if (rateEl.ValueKind != JsonValueKind.Number || rateEl.GetDouble() <= 0)
            {
                return Error("validation_error", "rate_kes_per_minute must be a positive number.", 422,
                    "rate_kes_per_minute", "Pass a positive KES/minute figure.");
            }
            rate.RateKesPerMinute = rateEl.GetDouble();
        }
        if (data.TryGetValue("country_name", out var nameEl))
        {
            rate.CountryName = nameEl.ValueKind == JsonValueKind.String ? nameEl.GetString()?.Trim() is { Length: > 0 } s ? s : null : null;
        }
        rate.UpdatedAt = Clock.UtcNow();

        await db.SaveChangesAsync();
        return Ok(new { data = rate.ToDict(), message = "International call rate updated." });
    }
}
