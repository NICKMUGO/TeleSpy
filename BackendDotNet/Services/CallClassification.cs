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
        // Kenya's own country code, dialled in full international form —
        // bill as a local Kenyan call, not International.
        if (KenyanInternationalPrefixRegex().IsMatch(rest)) return Constants.CallClassExternal;
        if (InternationalRegex().IsMatch(rest)) return Constants.CallClassInternational;
        return Constants.CallClassUnknown;
    }

    /// <summary>International wins over External wins over Internal: if
    /// either leg is an international number the whole call is
    /// International; else if either leg dials out through the 9-prefix (or
    /// is a normalised Kenyan number) it's External; else Internal only when
    /// both legs are 3-digit extensions.</summary>
    public static string ClassifyCall(string? orig, string? dest)
    {
        var origClass = ClassifyNumber(orig);
        var destClass = ClassifyNumber(dest);
        if (origClass == Constants.CallClassInternational || destClass == Constants.CallClassInternational) return Constants.CallClassInternational;
        if (origClass == Constants.CallClassExternal || destClass == Constants.CallClassExternal) return Constants.CallClassExternal;
        if (origClass == Constants.CallClassInternal && destClass == Constants.CallClassInternal) return Constants.CallClassInternal;
        return Constants.CallClassUnknown;
    }

    /// <summary>Internal calls to/from a carved-out extension (256, 400)
    /// never feed the anomaly detector, however unusual their pattern
    /// looks.</summary>
    public static bool IsExcludedFromAnomalyDetection(string? orig, string? dest, string callClassification) =>
        callClassification == Constants.CallClassInternal &&
        (Constants.AnomalyExcludedExtensions.Contains(orig ?? "") || Constants.AnomalyExcludedExtensions.Contains(dest ?? ""));
}
