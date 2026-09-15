// Static, code-owned in-app tutorial content, one track per role — mirrors
// Backend/core/tutorial_content.py verbatim. App configuration, not seed
// data; ships with the code and needs no database record to exist.
namespace TeleSpy.Core;

public record TutorialStep(string Id, string Title, string Body, string Href);

public static class TutorialContent
{
    private static readonly List<TutorialStep> Common =
    [
        new("welcome", "Welcome to TeleSpy", "TeleSpy tracks company SIMs, call usage, and telecom cost across departments.", "/dashboard"),
        new("dashboard", "Your dashboard", "See usage and cost trends for your scope at a glance.", "/dashboard"),
        new("settings", "Your settings", "Update your profile and review your security settings here.", "/settings"),
    ];

    public static readonly IReadOnlyDictionary<string, List<TutorialStep>> Tracks = new Dictionary<string, List<TutorialStep>>
    {
        [Role.Admin] = [.. Common,
            new("sims", "SIM inventory", "Provision, assign, and decommission company SIM cards.", "/sims"),
            new("employees", "Employees", "Manage employee records and their extension/department mapping.", "/employees"),
            new("departments", "Departments", "Organize employees into departments for budgeting and reporting.", "/departments"),
            new("ingestion", "CDR upload", "Ingest new Call Detail Record batches for processing.", "/ingestion"),
            new("usage", "Usage events", "Browse individual call records, filterable by date, extension, and type.", "/usage"),
            new("anomalies", "Anomalies", "Review calls and employees flagged for unusual cost or usage.", "/analytics/anomalies"),
            new("forecasts", "Forecasts", "Projected telecom spend for upcoming periods.", "/analytics/forecasts"),
            new("profiles", "Usage profiles", "Employees clustered by calling behavior.", "/analytics/profiles"),
            new("budgets", "Budgets", "Set the monthly cost ceiling per role.", "/budgets"),
            new("audit", "Audit log", "A full, tamper-evident trail of sensitive actions across the system.", "/audit"),
            new("users", "User provisioning", "Create Admin and Manager accounts.", "/settings/users"),
        ],
        [Role.Manager] = [.. Common,
            new("employees", "Your team", "View the employees in your department.", "/employees"),
            new("usage", "Usage events", "Browse call records for your department.", "/usage"),
            new("anomalies", "Anomalies", "Review employees in your department flagged for unusual cost.", "/analytics/anomalies"),
            new("budgets", "Budgets", "See the monthly cost ceiling that applies to your team.", "/budgets"),
        ],
        [Role.Employee] = [.. Common,
            new("usage", "Your usage", "See your own recent call activity.", "/usage"),
        ],
    };

    public static List<TutorialStep> StepsForRole(string? role) =>
        role is not null && Tracks.TryGetValue(role, out var steps) ? steps : Common;
}
