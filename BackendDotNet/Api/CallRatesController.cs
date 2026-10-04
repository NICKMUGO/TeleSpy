// Call rates (Admin only): the local (Kenyan) peak/off-peak tariff and the
// per-country international rate table — both editable at runtime so a
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
public class CallRatesController(TeleSpyDbContext db, IAuditService audit) : ControllerBase
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
        settings.PeakStartHour = peakStartHour;
        settings.PeakEndHour = peakEndHour;
        settings.UpdatedAt = Clock.UtcNow();

        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("local_call_rate_updated", "billing_settings", settings.Id, meta: settings.ToDict());
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
        await audit.RecordAuditAsync("international_call_rate_updated", "international_call_rate", rate.Id, meta: rate.ToDict());
        return Ok(new { data = rate.ToDict(), message = "International call rate updated." });
    }
}
