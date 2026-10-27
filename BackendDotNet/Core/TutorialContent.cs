// Static, code-owned in-app tutorial content, one track per role. App
// configuration, not seed data; ships with the code and needs no database
// record to exist.
namespace TeleSpy.Core;

// Href is the page the tour opens for the step. Target names the element
// it spotlights there — the frontend's matching data-tour="…" attribute.
// Null Target = no spotlight, the card sits centred over the dimmed page.
public record TutorialStep(string Id, string Title, string Body, string Href, string? Target);

public static class TutorialContent
{
    private static readonly List<TutorialStep> Common =
    [
        new("welcome", "Welcome to TeleSpy", "TeleSpy tracks company SIMs, call usage, and telecom cost across departments.", "/dashboard", null),
        new("dashboard", "Your dashboard", "See usage and cost trends for your scope at a glance.", "/dashboard", "dashboard-kpis"),
        new("settings", "Your settings", "Adjust text size, spacing and motion to suit you.", "/settings", "settings-display"),
    ];

    public static readonly IReadOnlyDictionary<string, List<TutorialStep>> Tracks = new Dictionary<string, List<TutorialStep>>
    {
        [Role.Admin] = [.. Common,
            new("sims", "SIM inventory", "Every company SIM card, who holds it, and its lifecycle state.", "/sims", "sims-table"),
            new("employees", "Employees", "Manage employee records and their extension/department mapping.", "/employees", "employees-table"),
            new("users", "Adding people", "Add employee creates the person's account and emails them a link to set their password. Pick Manager or Admin in the form to give them more access.", "/employees", "employees-add"),
            new("departments", "Departments", "Compare each department's call spend against its budget and last month.", "/departments", "departments-kpis"),
            new("ingestion", "CDR upload", "Ingest new Call Detail Record batches for processing.", "/ingestion", "ingestion-upload"),
            new("usage", "Usage events", "Browse individual call records: pick a month, or search by extension or destination.", "/usage", "usage-filters"),
            new("anomalies", "Anomalies", "Review calls and employees flagged for unusual cost or usage.", "/analytics/anomalies", "anomalies-flagged"),
            new("forecasts", "Forecasts", "Projected telecom spend for upcoming periods.", "/analytics/forecasts", "forecasts-chart"),
            new("profiles", "Usage profiles", "Employees clustered by calling behavior.", "/analytics/profiles", "profiles-groups"),
            new("audit", "Audit log", "A full, tamper-evident trail of sensitive actions across the system.", "/audit", "audit-table"),
        ],
        [Role.Manager] = [.. Common,
            new("employees", "Your team", "View the employees in your department.", "/employees", "employees-table"),
            new("usage", "Usage events", "Browse call records for your department.", "/usage", "usage-filters"),
            new("anomalies", "Anomalies", "Review employees in your department flagged for unusual cost.", "/analytics/anomalies", "anomalies-flagged"),
        ],
        // /usage is Admin/Manager-only (CdrController), so an Employee's own
        // activity is the dashboard step from Common.
        [Role.Employee] = [.. Common],
    };

    public static List<TutorialStep> StepsForRole(string? role) =>
        role is not null && Tracks.TryGetValue(role, out var steps) ? steps : Common;
}
