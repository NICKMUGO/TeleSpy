// Call classification + the anomaly-detection carve-out rule — mirrors
// Backend/services/call_classification.py exactly (same outcomes, same
// regexes from Constants.cs).
//
// "9" is the trunk-access digit for *any* outside-line call, local or
// international — a near-universal PBX convention (still the default in
// Cisco CUCM route plans, e.g. "9.@"/"9.0011!") — so ClassifyNumber() always
// strips it first, then classifies what's left. A trailing "#" (a CUCM
// dial-termination digit) is stripped before that.
using System.Text.RegularExpressions;
using TeleSpy;

namespace TeleSpy.Services;

public static partial class CallClassification
{
    [GeneratedRegex(Constants.KenyanLocalNumberRegex)]
    private static partial Regex KenyanLocalRegex();

    [GeneratedRegex(Constants.InternationalNumberRegex)]
    private static partial Regex InternationalRegex();

    [GeneratedRegex(Constants.KenyanInternationalPrefixRegex)]
    private static partial Regex KenyanInternationalPrefixRegex();

    [GeneratedRegex(Constants.InternalExtensionRegex)]
    private static partial Regex InternalRegex();

    /// <summary>Trim whitespace and strip a trailing CUCM dial-termination
    /// "#". Any other value is returned as-is.</summary>
    public static string NormalizeNumber(string? number)
    {
        if (string.IsNullOrEmpty(number)) return "";
        number = number.Trim().Replace(" ", "");
        return number.EndsWith('#') ? number[..^1] : number;
    }

    public static string ClassifyNumber(string? number)
    {
        var normalized = NormalizeNumber(number);
        if (string.IsNullOrEmpty(normalized)) return Constants.CallClassUnknown;
        if (InternalRegex().IsMatch(normalized)) return Constants.CallClassInternal;
        if (!normalized.StartsWith('9') || normalized.Length < 2) return Constants.CallClassUnknown;
        var rest = normalized[1..]; // drop the trunk-access digit
        if (KenyanLocalRegex().IsMatch(rest)) return Constants.CallClassExternal;
        // Kenya's own country code, dialled in full international form
        // (with or without +/00/000) — bill as a local Kenyan call, not
        // International, if it makes a real 10-digit local number; a
        // garbled one is Unknown. Same rule as ML/training/billing.py.
        if (KenyanInternationalPrefixRegex().Match(rest) is { Success: true } kenyan)
        {
            return KenyanLocalRegex().IsMatch("0" + kenyan.Groups[1].Value)
                ? Constants.CallClassExternal
                : Constants.CallClassUnknown;
        }
        if (InternationalRegex().IsMatch(rest)) return Constants.CallClassInternational;
        return Constants.CallClassUnknown;
    }

    /// <summary>Classify a call from its two legs. <paramref name="orig"/> is
    /// always the internal PBX extension that placed the call — a call is
    /// only ever this company's business if one of its own 3-digit
    /// extensions dialled out. If <paramref name="orig"/> isn't a bare
    /// 3-digit extension, this record isn't a call our own staff placed (an
    /// inbound call, a malformed CDR row, or someone else's traffic on the
    /// same trunk) — it's Unknown, full stop, without even looking at
    /// <paramref name="dest"/> (never mistakenly billed as
    /// External/International just because the destination leg happens to
    /// look like an outside number). Once <paramref name="orig"/> is
    /// confirmed to be one of ours, the call takes on whatever
    /// <paramref name="dest"/> classifies as (Internal, External,
    /// International, or Unknown).</summary>
    public static string ClassifyCall(string? orig, string? dest)
    {
        if (ClassifyNumber(orig) != Constants.CallClassInternal) return Constants.CallClassUnknown;
        return ClassifyNumber(dest);
    }

    /// <summary>Internal calls to/from a carved-out extension (256, 400)
    /// never feed the anomaly detector, however unusual their pattern
    /// looks.</summary>
    public static bool IsExcludedFromAnomalyDetection(string? orig, string? dest, string callClassification) =>
        callClassification == Constants.CallClassInternal &&
        (Constants.AnomalyExcludedExtensions.Contains(orig ?? "") || Constants.AnomalyExcludedExtensions.Contains(dest ?? ""));
}
