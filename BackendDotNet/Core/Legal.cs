// Terms & Conditions / Data Protection notice text — mirrors
// Backend/core/legal.py verbatim (same wording, same DPA_KE_POLICY_VERSION
// stamp from Config).
namespace TeleSpy.Core;

public static class Legal
{
    public const string TermsAndConditionsText = """
        TeleSpy Terms and Conditions

        1. TeleSpy is an internal tool for monitoring company-issued SIM cards,
           call activity, and associated telecom cost across departments.
        2. Your account and any data you submit may be viewed by authorized staff
           (system administrators, your department manager, and auditors) strictly
           for the purposes of telecom cost management, security, and audit.
        3. You are responsible for keeping your password and verification codes
           confidential, and for reporting any suspected unauthorized access.
        4. Misuse of the system, including attempting to access data outside your
           role's authorization, may result in account suspension and disciplinary
           action.
        5. Notifications: TeleSpy sends notifications to the browsers and devices
           where you allow them, only about your work in it — a new ticket sent
           to you or your team, and new messages on tickets you raised or are
           working on — and only when you don't have TeleSpy open in front of
           you. You can turn them off at any time in your profile or in your
           browser's settings.
        """;

    public static string DpaNoticeText() => $"""
        Data Protection Notice (Kenya Data Protection Act, 2019)

        Data Controller: your employer, operating TeleSpy internally.

        What we collect: your name, work email and phone, department, extension
        and SIM/MSISDN assignment, and records of calls made/received on company
        lines (origin, destination, time, duration, and cost).

        Purpose: telecom cost allocation and budgeting, fraud/anomaly detection on
        company phone lines, and internal audit — never for purposes unrelated to
        your employment.

        Legal basis: performance of your employment contract and your employer's
        legitimate interest in managing company telecom resources and cost.

        Retention: personal and call data is retained for as long as your account
        is active and for a reasonable period afterward for audit purposes, then
        deleted or anonymized.

        Your rights under the Act: you may request access to, correction of, or
        deletion of your personal data, object to processing, and lodge a
        complaint with the Office of the Data Protection Commissioner (ODPC),
        Kenya, if you believe your data has been mishandled.

        Policy version: {Config.DpaKePolicyVersion}
        """;
}
