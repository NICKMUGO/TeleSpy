// Entity classes mirroring Backend/models/models.py table-for-table (see
// that file's docstring for the departures from the raw ERD/class diagrams
// — all preserved here unchanged). ToDict()/business-rule methods mirror
// the Python model methods 1:1, including the field-level privacy rules.
//
// EF Core does not lazy-load navigation properties by default (SQLAlchemy
// relationships do) — callers must `.Include()` whatever a ToDict() call
// below is going to walk (e.g. Employee.ToDict needs .User, .User.Role,
// .Allocations.Sim, .UsageSummaries loaded first), or that data comes back
// empty/null instead of populated.
using TeleSpy.Core;

namespace TeleSpy.Models;

public class Role
{
    public string RoleId { get; set; } = "";
    public string RoleName { get; set; } = "";
    public List<string> Permissions { get; set; } = [];
    public double? CallLimitKshs { get; set; }

    public List<User> Users { get; set; } = [];

    public bool HasPermission(string action) => Permissions.Contains(action);
    public double? GetCallUnit() => CallLimitKshs;

    public Dictionary<string, object?> ToDict(ISet<string>? include = null)
    {
        include ??= new HashSet<string>();
        var outDict = new Dictionary<string, object?>
        {
            ["id"] = RoleId,
            ["role_name"] = RoleName,
            ["permissions"] = Permissions,
            ["call_limit_kshs"] = CallLimitKshs,
        };
        if (include.Contains("users"))
        {
            outDict["users"] = Users.Select(u => u.ToDict()).ToList();
        }
        return outDict;
    }
}

public class Department
{
    public string DepartmentId { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string? CostCentreCode { get; set; }
    public double? BudgetCeiling { get; set; }
    /// <summary>Its people work the customer service ticket desk: they
    /// raise tickets for other departments to handle.</summary>
    public bool HandlesCustomerService { get; set; }
    public DateTime CreatedAt { get; set; } = Clock.UtcNow();

    public List<Employee> Employees { get; set; } = [];
    public List<ForecastResult> ForecastResults { get; set; } = [];

    public string GetBudgetStatus(double spend) =>
        BudgetCeiling is null ? "unmonitored" : spend > BudgetCeiling ? "over_budget" : "within_budget";

    public Dictionary<string, object?> ToDict(ISet<string>? include = null)
    {
        include ??= new HashSet<string>();
        var outDict = new Dictionary<string, object?>
        {
            ["id"] = DepartmentId,
            ["name"] = Name,
            ["cost_centre_code"] = CostCentreCode,
            ["budget_ceiling"] = BudgetCeiling,
            ["handles_customer_service"] = HandlesCustomerService,
        };
        if (include.Contains("employees"))
        {
            outDict["employees"] = Employees.Select(e => e.ToDict()).ToList();
        }
        if (include.Contains("forecast_results"))
        {
            outDict["forecast_results"] = ForecastResults.OrderBy(f => f.Period).Select(f => f.ToDict()).ToList();
        }
        return outDict;
    }
}

/// <summary>HR/org record — NOT the login. See User below.</summary>
public class Employee
{
    public string EmployeeId { get; set; } = Guid.NewGuid().ToString();
    public string? DepartmentId { get; set; }
    // Nullable: an Admin can create the record first and assign the
    // staff_number/department later.
    public string? StaffNumber { get; set; }
    public string FullName { get; set; } = "";
    // The 3-digit PBX extension this person answers on, e.g. "370" — the
    // last three digits of their company number (see
    // BillingSettings.CompanyNumberPrefix). It follows the SIM: whoever a
    // SIM is allocated to holds that SIM's extension, and it moves with the
    // SIM when an Admin hands the line to someone else (AllocationService).
    // Nullable/unique like StaffNumber.
    public string? ExtensionCode { get; set; }
    public DateTime CreatedAt { get; set; } = Clock.UtcNow();
    // Set when this person leaves the company (EmployeeRemoval): their
    // line goes back to the pool or to their replacement, their login is
    // disabled and they drop out of every list — but the row stays, so
    // their past calls, bills and invoices still add up.
    public DateTime? RemovedAt { get; set; }
    // Why they left — one of EmployeeRemoval.Reasons.
    public string? RemovalReason { get; set; }

    public Department? Department { get; set; }
    public User? User { get; set; }
    public List<SimAllocation> Allocations { get; set; } = [];
    public UsageProfile? UsageProfile { get; set; }
    public List<UsageSummary> UsageSummaries { get; set; } = [];

    public SimAllocation? GetActiveAllocation()
    {
        var now = Clock.UtcNow();
        return Allocations.FirstOrDefault(a => a.IsActiveAt(now));
    }

    /// <summary>Field-level protections the brief calls out: the assigned
    /// extension is decrypted only for authorized viewers, and
    /// total_cost_kes is stripped entirely (not nulled — omitted) unless the
    /// viewer is Admin, this employee's own Manager, or the employee
    /// themselves.</summary>
    public Dictionary<string, object?> ToDict(User? viewer = null, ISet<string>? include = null)
    {
        include ??= new HashSet<string>();
        var outDict = new Dictionary<string, object?>
        {
            ["id"] = EmployeeId,
            ["staff_number"] = StaffNumber,
            ["full_name"] = FullName,
            ["department_id"] = DepartmentId,
            ["extension_code"] = ExtensionCode,
            ["removed_at"] = UtcTime.Iso(RemovedAt),
            ["removal_reason"] = RemovalReason,
        };
        if (User is not null)
        {
            outDict["email"] = User.Email;
            outDict["role"] = User.Role?.RoleName;
            outDict["role_id"] = User.RoleId;
            outDict["is_active"] = User.IsActive;
        }

        var viewerRole = viewer?.Role?.RoleName;
        var isSelf = viewer is not null && viewer.EmployeeId == EmployeeId;
        var isOwnManager = viewerRole == TeleSpy.Role.Manager && viewer?.Employee is not null &&
                            viewer.Employee.DepartmentId == DepartmentId;
        var canViewExtension = viewerRole == TeleSpy.Role.Admin || isOwnManager || isSelf;
        var canViewCost = viewerRole == TeleSpy.Role.Admin || isOwnManager || isSelf;

        var allocation = GetActiveAllocation();
        if (allocation is not null && canViewExtension)
        {
            outDict["extension"] = allocation.Sim?.MsisdnPbxEnc is { Length: > 0 }
                ? Security.DecryptValue(allocation.Sim.MsisdnPbxEnc)
                : null;
            outDict["sim_id"] = allocation.SimId;
            // The line's full number is Admin-only, as on SimCard.ToDict.
            if (viewerRole == TeleSpy.Role.Admin && allocation.Sim is not null)
            {
                outDict["msisdn"] = Security.DecryptValue(allocation.Sim.MsisdnEnc);
            }
        }

        if (canViewCost)
        {
            var currentMonth = Clock.UtcNow().ToString("yyyy-MM");
            var summary = UsageSummaries.FirstOrDefault(s => s.Month == currentMonth);
            outDict["total_cost_kes"] = summary?.TotalCost ?? 0;
        }

        // Opt-in one-to-many expansions. Cost history is gated behind the
        // same can_view_cost check as the single-month figure above — the
        // `include` flag never widens what a viewer is allowed to see.
        if (include.Contains("usage_summaries") && canViewCost)
        {
            outDict["usage_summaries"] = UsageSummaries.OrderBy(s => s.Month).Select(s => s.ToDict()).ToList();
        }
        if (include.Contains("allocations"))
        {
            outDict["allocations"] = Allocations.OrderBy(a => a.StartAt).Select(a => a.ToDict()).ToList();
        }

        return outDict;
    }
}

/// <summary>Login identity — 1:1 with Employee.</summary>
public class User
{
    public string UserId { get; set; } = Guid.NewGuid().ToString();
    // Every login is tied to an HR record — Admins/Managers get an Employee
    // row too (department + staff_number), provisioned the same way as any
    // Employee.
    public string EmployeeId { get; set; } = "";

    private string _email = "";
    public string Email
    {
        get => _email;
        set => _email = value.Trim().ToLowerInvariant();
    }

    public string PasswordHash { get; set; } = "";
    public string RoleId { get; set; } = "";

    public bool IsActive { get; set; } = true;
    public bool MustChangePassword { get; set; }
    public int FailedLoginAttempts { get; set; }
    public DateTime? LockedUntil { get; set; }
    public DateTime CreatedAt { get; set; } = Clock.UtcNow();
    public DateTime UpdatedAt { get; set; } = Clock.UtcNow();

    public Employee? Employee { get; set; }
    public Role? Role { get; set; }
    public List<PasswordHistory> PasswordHistory { get; set; } = [];
    public List<AuditLog> AuditEntries { get; set; } = [];

    /// <summary>Write-only, mirroring the Python hybrid_property: there is no
    /// getter for the plaintext password, only this setter (hashes via
    /// bcrypt) and CheckPassword below.</summary>
    public void SetPassword(string rawPassword) => PasswordHash = BCrypt.Net.BCrypt.HashPassword(rawPassword);

    public bool CheckPassword(string rawPassword) =>
        !string.IsNullOrEmpty(PasswordHash) && BCrypt.Net.BCrypt.Verify(rawPassword, PasswordHash);

    public Dictionary<string, object?> ToDict()
    {
        var outDict = new Dictionary<string, object?>
        {
            ["id"] = UserId,
            ["email"] = Email,
            ["role"] = Role?.RoleName,
            ["role_id"] = RoleId,
            ["is_active"] = IsActive,
            ["must_change_password"] = MustChangePassword,
        };
        if (Employee is not null)
        {
            outDict["employee_id"] = Employee.EmployeeId;
            outDict["full_name"] = Employee.FullName;
            outDict["staff_number"] = Employee.StaffNumber;
            outDict["department_id"] = Employee.DepartmentId;
        }
        return outDict;
    }
}

/// <summary>The Password Bank: a hash of every password a user has set, so a
/// new one can be checked against the last PasswordHistoryLimit.</summary>
public class PasswordHistory
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string UserId { get; set; } = "";
    public string PasswordHashValue { get; set; } = "";
    public DateTime CreatedAt { get; set; } = Clock.UtcNow();

    public User? User { get; set; }
}

public class PasswordResetToken
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string UserId { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public bool Consumed { get; set; }
    public DateTime CreatedAt { get; set; } = Clock.UtcNow();
}

/// <summary>Kenya Data Protection Act (2019) + Terms & Conditions consent,
/// captured explicitly at registration — never inferred.</summary>
public class Consent
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string UserId { get; set; } = "";
    public bool AcceptedTerms { get; set; }
    public bool AcceptedDpaNotice { get; set; }
    public string DpaPolicyVersion { get; set; } = "";
    public DateTime CreatedAt { get; set; } = Clock.UtcNow();
}

public class TutorialProgress
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string UserId { get; set; } = "";
    public List<string> CompletedStepIds { get; set; } = [];
    public bool Dismissed { get; set; }
    public DateTime UpdatedAt { get; set; } = Clock.UtcNow();
}

public class TelcoPlan
{
    public string PlanId { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string? Provider { get; set; }
    // Self-referential per the class diagram's "+FK plan_id" on TELCO_PLAN
    // itself — models a plan being superseded by a successor plan.
    public string? PlanIdRef { get; set; }
    public string LifecycleState { get; set; } = "active";
    public double? RatePerMinuteKes { get; set; }

    public List<SimCard> Sims { get; set; } = [];

    public Dictionary<string, object?> GetRateCard() => new() { ["rate_per_minute_kes"] = RatePerMinuteKes };

    public Dictionary<string, object?> ToDict(User? viewer = null, ISet<string>? include = null)
    {
        include ??= new HashSet<string>();
        var outDict = new Dictionary<string, object?>
        {
            ["id"] = PlanId,
            ["name"] = Name,
            ["provider"] = Provider,
            ["plan_id_ref"] = PlanIdRef,
            ["lifecycle_state"] = LifecycleState,
            ["rate_per_minute_kes"] = RatePerMinuteKes,
        };
        // SimCard.ToDict needs a viewer for its field-level masking, so a
        // plan can only expand its SIMs when one is supplied.
        if (include.Contains("sims") && viewer is not null)
        {
            outDict["sims"] = Sims.Select(s => s.ToDict(viewer)).ToList();
        }
        return outDict;
    }
}

/// <summary>Not in the original ERD/class diagrams — added so call rates
/// (previously hardcoded in ML/training/billing.py) are Admin-editable at
/// runtime via PATCH /call-rates/local, per Safaricom's published local
/// tariff. Singleton row, fixed Id like Role.RoleId — there is exactly one
/// active billing configuration, not a set of records. Bootstrapped with
/// defaults by CallRateBootstrap (Core/Startup.cs), the same pattern
/// RoleBootstrap uses for the roles table. billing.py reads this table
/// fresh on every run — see that module's "Call rating" section.</summary>
public class BillingSettings
{
    public string Id { get; set; } = "";
    // Local (Kenyan) list rates per minute, tax-inclusive, before the
    // contract discount below.
    public double PeakRateKes { get; set; }
    public double OffPeakRateKes { get; set; }
    public int PeakStartHour { get; set; } // 0-23, inclusive
    public int PeakEndHour { get; set; } // 0-23, exclusive
    // Fallback rate for an International destination whose country code
    // isn't (yet) priced in InternationalCallRates.
    public double DefaultInternationalRateKes { get; set; }
    // Contract discount per call type, as a percentage (0-100) off the list
    // rate. "On-net" is a call to another Safaricom number, "off-net" one
    // to any other Kenyan network or a fixed line.
    public double DiscountOnNetPeakPct { get; set; } = BillingConstants.DefaultDiscountOnNetPeakPct;
    public double DiscountOnNetOffPeakPct { get; set; } = BillingConstants.DefaultDiscountOnNetOffPeakPct;
    public double DiscountOffNetPeakPct { get; set; } = BillingConstants.DefaultDiscountOffNetPeakPct;
    public double DiscountOffNetOffPeakPct { get; set; } = BillingConstants.DefaultDiscountOffNetOffPeakPct;
    public double DiscountInternationalPct { get; set; } = BillingConstants.DefaultDiscountInternationalPct;
    // Which telco the organisation is on, and the number prefixes that
    // count as on-net (see BillingConstants.DefaultOnNetPrefixes).
    public string HomeNetworkName { get; set; } = BillingConstants.DefaultHomeNetworkName;
    public string OnNetPrefixes { get; set; } = BillingConstants.DefaultOnNetPrefixes;
    // The line's fixed monthly rental, before tax — a company-level cost,
    // not attributed to any employee — and the taxes the telco adds to it.
    public double FixedMonthlyChargeKes { get; set; } = BillingConstants.DefaultFixedMonthlyChargeKes;
    public double ExciseRatePct { get; set; } = BillingConstants.DefaultExciseRatePct;
    public double VatRatePct { get; set; } = BillingConstants.DefaultVatRatePct;
    // The company's standard number format: every staff line is this prefix
    // followed by the 3-digit extension, e.g. "0703083" + "370" =
    // 0703083370. Not a billing figure, but this row is the organisation's
    // one settings record. Admin-editable via PATCH /settings/number-format.
    public string CompanyNumberPrefix { get; set; } = BillingConstants.DefaultCompanyNumberPrefix;
    // Ticket SLA targets, in hours from raising to resolved, per priority.
    // Admin-editable via PATCH /tickets/sla-targets.
    public int SlaHighHours { get; set; } = BillingConstants.DefaultSlaHighHours;
    public int SlaMediumHours { get; set; } = BillingConstants.DefaultSlaMediumHours;
    public int SlaLowHours { get; set; } = BillingConstants.DefaultSlaLowHours;
    public DateTime UpdatedAt { get; set; } = Clock.UtcNow();

    public int SlaHoursFor(string priority) => priority switch
    {
        TicketPriority.High => SlaHighHours,
        TicketPriority.Low => SlaLowHours,
        _ => SlaMediumHours,
    };

    /// <summary>Excise is charged on the amount, then VAT on amount + excise
    /// — 1.15 x 1.16 = 1.334 at the default rates.</summary>
    public double TaxMultiplier() => (1 + ExciseRatePct / 100.0) * (1 + VatRatePct / 100.0);

    public double FixedMonthlyChargeWithTaxKes() => Math.Round(FixedMonthlyChargeKes * TaxMultiplier(), 2);

    /// <summary>The company number for an extension under the current format.</summary>
    public string CompanyNumberFor(string extension) => CompanyNumberPrefix + extension;

    public Dictionary<string, object?> ToDict() => new()
    {
        ["home_network_name"] = HomeNetworkName,
        ["on_net_prefixes"] = OnNetPrefixes,
        ["discount_on_net_peak_pct"] = DiscountOnNetPeakPct,
        ["discount_on_net_off_peak_pct"] = DiscountOnNetOffPeakPct,
        ["discount_off_net_peak_pct"] = DiscountOffNetPeakPct,
        ["discount_off_net_off_peak_pct"] = DiscountOffNetOffPeakPct,
        ["discount_international_pct"] = DiscountInternationalPct,
        ["fixed_monthly_charge_kes"] = FixedMonthlyChargeKes,
        ["fixed_monthly_charge_with_tax_kes"] = FixedMonthlyChargeWithTaxKes(),
        ["excise_rate_pct"] = ExciseRatePct,
        ["vat_rate_pct"] = VatRatePct,
        ["peak_rate_kes"] = PeakRateKes,
        ["off_peak_rate_kes"] = OffPeakRateKes,
        ["peak_start_hour"] = PeakStartHour,
        ["peak_end_hour"] = PeakEndHour,
        ["default_international_rate_kes"] = DefaultInternationalRateKes,
        ["updated_at"] = UtcTime.Iso(UpdatedAt),
    };
}

/// <summary>Per-country KES/minute, sourced from
/// ML/training/International_Calling_Rates.pdf (Safaricom international
/// rates). Admin-editable via PATCH /call-rates/international/&lt;country_code&gt;.
/// Longest-prefix matched against a dialled number by billing.py.</summary>
public class InternationalCallRate
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string CountryCode { get; set; } = ""; // E.164 dial code digits, no "+", e.g. "254", "1876"
    public string? CountryName { get; set; }
    public double RateKesPerMinute { get; set; }
    public DateTime UpdatedAt { get; set; } = Clock.UtcNow();

    public Dictionary<string, object?> ToDict() => new()
    {
        ["id"] = Id,
        ["country_code"] = CountryCode,
        ["country_name"] = CountryName,
        ["rate_kes_per_minute"] = RateKesPerMinute,
        ["updated_at"] = UtcTime.Iso(UpdatedAt),
    };
}

/// <summary>ICCID/MSISDN/extension are encrypted at rest, with blind-index
/// fingerprints for uniqueness checks and lookups (see Security.cs).</summary>
public class SimCard
{
    public string SimId { get; set; } = Guid.NewGuid().ToString();
    public string IccidEnc { get; set; } = "";
    public string IccidHash { get; set; } = "";
    public string MsisdnEnc { get; set; } = ""; // the SIM's own subscriber number
    public string MsisdnHash { get; set; } = "";
    public string? Provider { get; set; }
    public string? PlanId { get; set; }
    public string LifecycleState { get; set; } = "active"; // active | suspended | decommissioned
    // The internal PBX extension this SIM answers to — the "extension" the
    // brief asks to encrypt. It lives on the SIM (a fixed property of the
    // physical line), not the employee; who currently holds it is tracked
    // by SimAllocation below.
    public string? MsisdnPbxEnc { get; set; }
    public string? MsisdnPbxHash { get; set; }
    public DateTime CreatedAt { get; set; } = Clock.UtcNow();
    public DateTime UpdatedAt { get; set; } = Clock.UtcNow();

    public TelcoPlan? Plan { get; set; }
    public List<SimAllocation> Allocations { get; set; } = [];

    public SimAllocation? GetCurrentAllocation()
    {
        var now = Clock.UtcNow();
        return Allocations.FirstOrDefault(a => a.IsActiveAt(now));
    }

    public string? Extension() => MsisdnPbxEnc is { Length: > 0 } ? Security.DecryptValue(MsisdnPbxEnc) : null;

    public bool IsAvailableForAllocation() => LifecycleState == "active" && GetCurrentAllocation() is null;

    public Dictionary<string, object?> ToDict(User viewer, ISet<string>? include = null)
    {
        include ??= new HashSet<string>();
        var current = GetCurrentAllocation();
        var outDict = new Dictionary<string, object?>
        {
            ["id"] = SimId,
            ["provider"] = Provider,
            ["plan_id"] = PlanId,
            ["lifecycle_state"] = LifecycleState,
            ["employee_id"] = current?.EmployeeId,
            // The holder's name, when the allocation's Employee was loaded
            // — so a list of SIMs can say who has each one without a
            // second lookup the viewer may not be allowed to make (a
            // Manager's employee list covers only their own department).
            ["employee_name"] = current?.Employee?.FullName,
            ["created_at"] = UtcTime.Iso(CreatedAt),
        };
        if (include.Contains("allocations"))
        {
            outDict["allocations"] = Allocations.OrderBy(a => a.StartAt).Select(a => a.ToDict()).ToList();
        }
        if (viewer.Role?.RoleName == TeleSpy.Role.Admin)
        {
            outDict["iccid"] = Security.DecryptValue(IccidEnc);
            outDict["msisdn"] = Security.DecryptValue(MsisdnEnc);
            outDict["extension"] = Extension();
        }
        else
        {
            var msisdn = Security.DecryptValue(MsisdnEnc) ?? "";
            outDict["msisdn_masked"] = msisdn.Length >= 4
                ? new string('*', Math.Max(0, msisdn.Length - 4)) + msisdn[^4..]
                : "****";
        }
        return outDict;
    }
}

/// <summary>The employee &lt;-&gt; SIM/extension mapping, time-bounded.</summary>
public class SimAllocation
{
    public string AllocationId { get; set; } = Guid.NewGuid().ToString();
    public string SimId { get; set; } = "";
    public string EmployeeId { get; set; } = "";
    public DateTime StartAt { get; set; } = Clock.UtcNow();
    public DateTime? EndAt { get; set; } // null = currently active

    public SimCard? Sim { get; set; }
    public Employee? Employee { get; set; }
    public List<UsageEvent> UsageEvents { get; set; } = [];

    public bool IsActiveAt(DateTime timestamp) => StartAt <= timestamp && (EndAt is null || timestamp < EndAt);

    public void CloseAllocation(DateTime? endAt = null) => EndAt = endAt ?? Clock.UtcNow();

    public Dictionary<string, object?> ToDict(ISet<string>? include = null)
    {
        include ??= new HashSet<string>();
        var outDict = new Dictionary<string, object?>
        {
            ["id"] = AllocationId,
            ["sim_id"] = SimId,
            ["employee_id"] = EmployeeId,
            ["start_at"] = UtcTime.Iso(StartAt),
            ["end_at"] = UtcTime.Iso(EndAt),
        };
        if (include.Contains("usage_events"))
        {
            outDict["usage_events"] = UsageEvents.OrderBy(e => e.OccuredAt).Select(e => e.ToDict()).ToList();
        }
        return outDict;
    }
}

/// <summary>One CDR row.</summary>
public class UsageEvent
{
    public string EventId { get; set; } = Guid.NewGuid().ToString();
    // Nullable: an event whose msisdn_pbx doesn't match any known SIM at the
    // time of the call is stored anyway, just unattributed.
    public string? AllocationId { get; set; }
    public string MsisdnPbx { get; set; } = ""; // the internal extension side of the call
    public string Destination { get; set; } = "";
    public DateTime OccuredAt { get; set; }
    public double DurationMinutes { get; set; }
    public double ComputedCost { get; set; }
    public string AttributionState { get; set; } = "unattributed"; // attributed | unattributed
    // Required to implement the classification + 256/400 anomaly carve-out
    // rule without re-deriving it on every read.
    public string? CallClassification { get; set; } // Internal | External | International | Unknown
    public bool ExcludedFromAnomalyDetection { get; set; }
    public string? SourceFile { get; set; }
    public DateTime IngestedAt { get; set; } = Clock.UtcNow();

    public SimAllocation? Allocation { get; set; }
    public AnomalyFlag? AnomalyFlag { get; set; }

    public void AttributeToAllocation(SimAllocation? allocation)
    {
        AllocationId = allocation?.AllocationId;
        AttributionState = allocation is not null ? "attributed" : "unattributed";
    }

    public void FlagAsUnattributed()
    {
        AllocationId = null;
        AttributionState = "unattributed";
    }

    public Dictionary<string, object?> ToDict() => new()
    {
        ["id"] = EventId,
        ["allocation_id"] = AllocationId,
        ["msisdn_pbx"] = MsisdnPbx,
        ["destination"] = Destination,
        // A CDR call time is the phone system's local (Nairobi) clock, not
        // UTC like the app's own timestamps, so it is deliberately sent
        // without a UTC marker — the browser shows it as recorded.
        ["occured_at"] = OccuredAt.ToString("o"),
        ["duration_minutes"] = DurationMinutes,
        ["computed_cost"] = ComputedCost,
        ["attribution_state"] = AttributionState,
        ["call_classification"] = CallClassification,
        ["excluded_from_anomaly_detection"] = ExcludedFromAnomalyDetection,
    };
}

/// <summary>Persisted per usage_event at ingestion time, matching the
/// sequence diagram: scoring happens during ingest, not on-demand at GET
/// /analytics/anomalies time. Score() is the seam an Isolation Forest model
/// swaps into later — see Services/Anomaly.cs.</summary>
public class AnomalyFlag
{
    public string FlagId { get; set; } = Guid.NewGuid().ToString();
    public string EventId { get; set; } = "";
    public double AnomalyScore { get; set; }
    public Dictionary<string, object?> ContributingFeatures { get; set; } = [];
    public DateTime CreatedAt { get; set; } = Clock.UtcNow();
    // Backs "Resolve anomaly flag" (Admin only) — a flag with no way to
    // close it out isn't reviewable in practice.
    public DateTime? ResolvedAt { get; set; }
    public string? ResolvedByUserId { get; set; }

    public UsageEvent? Event { get; set; }

    public Dictionary<string, object?> GetContributingFeatures() => ContributingFeatures;

    public Dictionary<string, object?> ToDict() => new()
    {
        ["id"] = FlagId,
        ["event_id"] = EventId,
        ["anomaly_score"] = AnomalyScore,
        ["contributing_features"] = ContributingFeatures,
        ["resolved"] = ResolvedAt is not null,
        ["resolved_at"] = UtcTime.Iso(ResolvedAt),
    };
}

/// <summary>KMeans cluster per employee.</summary>
public class UsageProfile
{
    public string ProfileId { get; set; } = Guid.NewGuid().ToString();
    public string EmployeeId { get; set; } = "";
    public string? ClusterLabel { get; set; } // null until the KMeans model is wired up
    public DateTime UpdatedAt { get; set; } = Clock.UtcNow();

    public Employee? Employee { get; set; }

    public Dictionary<string, object?> ToDict() => new()
    {
        ["id"] = ProfileId,
        ["employee_id"] = EmployeeId,
        ["cluster_label"] = ClusterLabel,
    };
}

/// <summary>Spend on an extension nobody held — a line in the pool that was
/// still being used. Written by ML/training/billing.py next to
/// usage_summaries, per extension per month, so that spend is reported
/// and reconciled instead of being billed to no one.</summary>
public class UnassignedLineUsage
{
    public string UsageId { get; set; } = Guid.NewGuid().ToString();
    public string ExtensionCode { get; set; } = "";
    public string Month { get; set; } = ""; // "YYYY-MM"
    public double TotalCost { get; set; }
    public double ListCost { get; set; }
    public int Calls { get; set; }
    public DateTime UpdatedAt { get; set; } = Clock.UtcNow();

    public Dictionary<string, object?> ToDict() => new()
    {
        ["id"] = UsageId,
        ["extension_code"] = ExtensionCode,
        ["month"] = Month,
        ["total_cost_kes"] = TotalCost,
        ["list_cost_kes"] = ListCost,
        ["calls"] = Calls,
        ["updated_at"] = UtcTime.Iso(UpdatedAt),
    };
}

/// <summary>Per employee, per month — source of "Total Cost per Employee"
/// and what cost-ceiling checks compare against.</summary>
public class UsageSummary
{
    public string SummaryId { get; set; } = Guid.NewGuid().ToString();
    public string EmployeeId { get; set; } = "";
    public string Month { get; set; } = ""; // "YYYY-MM"
    // What the employee's calls actually cost: list price less the
    // contract discount, tax-inclusive.
    public double TotalCost { get; set; }
    // The same calls at list price, before the discount — kept so the
    // discount's value can be reported (ListCost - TotalCost).
    public double ListCost { get; set; }
    // Denormalized copy of Employee.ExtensionCode as of when this row was
    // last written — filled in by ML/training/billing.py (see that
    // module's docstring), so a row is self-contained for reporting
    // without a join back to employees.
    public string? ExtensionCode { get; set; }
    public DateTime UpdatedAt { get; set; } = Clock.UtcNow();

    public Employee? Employee { get; set; }

    public bool CheckThresholdBreach(double? limitKshs) => limitKshs is not null && TotalCost > limitKshs;

    public Dictionary<string, object?> ToDict() => new()
    {
        ["id"] = SummaryId,
        ["employee_id"] = EmployeeId,
        ["month"] = Month,
        ["total_cost"] = TotalCost,
        ["list_cost"] = ListCost,
        ["extension_code"] = ExtensionCode,
        ["updated_at"] = UtcTime.Iso(UpdatedAt),
    };
}

/// <summary>The telco's actual invoice total for one month of calls, typed
/// in by an Admin so it can be set beside the bill the application rebuilds
/// from its own records (GET /reconciliation). `Month` is the month the
/// calls were made in — the invoice itself is dated the 1st of the next.</summary>
public class MonthlyInvoice
{
    public string Month { get; set; } = ""; // "YYYY-MM"
    public double InvoiceTotalKes { get; set; }
    public string? Note { get; set; }
    public DateTime UpdatedAt { get; set; } = Clock.UtcNow();
}

/// <summary>Prophet output per department/period.</summary>
public class ForecastResult
{
    public string ForecastId { get; set; } = Guid.NewGuid().ToString();
    public string DepartmentId { get; set; } = "";
    public string Period { get; set; } = ""; // e.g. "2026-10"
    public double? ForecastedCost { get; set; }
    public double? ConfidenceLow { get; set; }
    public double? ConfidenceHigh { get; set; }
    public DateTime GeneratedAt { get; set; } = Clock.UtcNow();

    public Department? Department { get; set; }

    public Dictionary<string, object?> ToDict() => new()
    {
        ["id"] = ForecastId,
        ["department_id"] = DepartmentId,
        ["period"] = Period,
        ["forecasted_cost"] = ForecastedCost,
        ["confidence_low"] = ConfidenceLow,
        ["confidence_high"] = ConfidenceHigh,
    };
}

public class AuditLog
{
    public string AuditId { get; set; } = Guid.NewGuid().ToString();
    public string? ActorUserId { get; set; }
    public string Action { get; set; } = "";
    public DateTime OccuredAt { get; set; } = Clock.UtcNow();
    // Extra columns beyond the ERD's 4, kept for a genuinely useful trail.
    public string? ActorRole { get; set; }
    public string? Resource { get; set; }
    public string? ResourceId { get; set; }
    public Dictionary<string, object?> Meta { get; set; } = [];

    public User? Actor { get; set; }

    public Dictionary<string, object?> ToDict() => new()
    {
        ["id"] = AuditId,
        ["actor_user_id"] = ActorUserId,
        ["actor_role"] = ActorRole,
        ["action"] = Action,
        ["resource"] = Resource,
        ["resource_id"] = ResourceId,
        ["meta"] = Meta,
        ["occured_at"] = UtcTime.Iso(OccuredAt),
    };
}

// --- Customer service tickets -------------------------------------------
// A ticket is raised by hand by someone on the customer service desk when a
// customer's issue needs another department (a rebooking, a flight
// problem, a refund). Calls themselves never create tickets.

public static class TicketStatus
{
    /// <summary>In the handling department's queue, nobody on it yet.</summary>
    public const string Open = "open";
    /// <summary>Claimed by someone in the handling department.</summary>
    public const string InProgress = "in_progress";
    /// <summary>Sent back to the desk (wrong department, missing details);
    /// the agent fixes it and sends it again.</summary>
    public const string Returned = "returned";
    /// <summary>Closed with a resolution note: a successful escalation for
    /// the agent who raised it.</summary>
    public const string Resolved = "resolved";

    public static readonly string[] All = [Open, InProgress, Returned, Resolved];
}

/// <summary>How urgent a ticket is, which sets its SLA target.</summary>
public static class TicketPriority
{
    public const string High = "high";
    public const string Medium = "medium";
    public const string Low = "low";

    public static readonly string[] All = [High, Medium, Low];
}

/// <summary>Where a ticket stands against its deadline.</summary>
public static class SlaStatus
{
    /// <summary>Still being worked, deadline not passed.</summary>
    public const string OnTrack = "on_track";
    /// <summary>Still being worked, deadline passed.</summary>
    public const string Overdue = "overdue";
    /// <summary>Back with the raiser: the clock stops until it's sent again.</summary>
    public const string Paused = "paused";
    /// <summary>Resolved by the deadline.</summary>
    public const string Met = "met";
    /// <summary>Resolved after the deadline.</summary>
    public const string Missed = "missed";
}

/// <summary>What a ticket is about, and the department that handles it by
/// default. Admin-managed in Settings.</summary>
public class TicketCategory
{
    public string CategoryId { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string DepartmentId { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = Clock.UtcNow();

    public Department? Department { get; set; }

    public Dictionary<string, object?> ToDict() => new()
    {
        ["id"] = CategoryId,
        ["name"] = Name,
        ["department_id"] = DepartmentId,
        ["department_name"] = Department?.Name,
        ["is_active"] = IsActive,
    };
}

public class Ticket
{
    public string TicketId { get; set; } = Guid.NewGuid().ToString();
    /// <summary>Human-facing sequence number, shown as TKT-000042.</summary>
    public int Number { get; set; }
    public string Subject { get; set; } = "";
    public string Description { get; set; } = "";
    /// <summary>Null when the ticket isn't for a customer — anyone outside
    /// the customer service desk can raise an internal ticket too.</summary>
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }
    public string? CustomerEmail { get; set; }
    /// <summary>The airline booking reference (PNR), if the issue has one.</summary>
    public string? BookingReference { get; set; }
    /// <summary>One of the quick categories, or null when the raiser wrote
    /// their own reason (CustomReason) and picked the department themselves.</summary>
    public string? CategoryId { get; set; }
    public string? CustomReason { get; set; }
    public string DepartmentId { get; set; } = "";
    public string Status { get; set; } = TicketStatus.Open;
    public string Priority { get; set; } = TicketPriority.Medium;
    /// <summary>The SLA deadline: raised + the priority's target, unless the
    /// raiser set one of their own. Pushed back by however long the ticket
    /// sat returned with the raiser, since the team couldn't work it then.</summary>
    public DateTime DueAt { get; set; }

    public string RaisedByUserId { get; set; } = "";
    public string? ClaimedByUserId { get; set; }
    public DateTime? ClaimedAt { get; set; }
    public string? ResolvedByUserId { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public string? ResolutionNote { get; set; }
    /// <summary>How many times it came back to the desk — a resolved ticket
    /// is still a success, this just shows how cleanly it went.</summary>
    public int ReturnCount { get; set; }

    public DateTime CreatedAt { get; set; } = Clock.UtcNow();
    public DateTime UpdatedAt { get; set; } = Clock.UtcNow();

    public TicketCategory? Category { get; set; }
    public Department? Department { get; set; }
    public User? RaisedBy { get; set; }
    public User? ClaimedBy { get; set; }
    public User? ResolvedBy { get; set; }
    public List<TicketEvent> Events { get; set; } = [];

    public static string FormatNumber(int number) => $"TKT-{number:D6}";

    public string SlaStatusAt(DateTime now) => Status switch
    {
        TicketStatus.Resolved => ResolvedAt <= DueAt ? SlaStatus.Met : SlaStatus.Missed,
        TicketStatus.Returned => SlaStatus.Paused,
        _ => now > DueAt ? SlaStatus.Overdue : SlaStatus.OnTrack,
    };

    /// <summary>Minutes from raised to resolved, null until resolved.</summary>
    public int? ResolutionMinutes() =>
        ResolvedAt is null ? null : (int)Math.Round((ResolvedAt.Value - CreatedAt).TotalMinutes);

    public Dictionary<string, object?> ToDict(bool includeEvents = false)
    {
        var outDict = new Dictionary<string, object?>
        {
            ["id"] = TicketId,
            ["number"] = FormatNumber(Number),
            ["subject"] = Subject,
            ["description"] = Description,
            ["customer_name"] = CustomerName,
            ["customer_phone"] = CustomerPhone,
            ["customer_email"] = CustomerEmail,
            ["booking_reference"] = BookingReference,
            ["category_id"] = CategoryId,
            ["category_name"] = Category?.Name ?? CustomReason,
            ["custom_reason"] = CustomReason,
            ["department_id"] = DepartmentId,
            ["department_name"] = Department?.Name,
            ["status"] = Status,
            ["priority"] = Priority,
            ["due_at"] = UtcTime.Iso(DueAt),
            ["sla_status"] = SlaStatusAt(Clock.UtcNow()),
            ["raised_by_id"] = RaisedByUserId,
            ["raised_by_name"] = RaisedBy?.Employee?.FullName ?? RaisedBy?.Email,
            ["claimed_by_id"] = ClaimedByUserId,
            ["claimed_by_name"] = ClaimedBy?.Employee?.FullName ?? ClaimedBy?.Email,
            ["claimed_at"] = UtcTime.Iso(ClaimedAt),
            ["resolved_by_name"] = ResolvedBy?.Employee?.FullName ?? ResolvedBy?.Email,
            ["resolved_at"] = UtcTime.Iso(ResolvedAt),
            ["resolution_minutes"] = ResolutionMinutes(),
            ["resolution_note"] = ResolutionNote,
            ["return_count"] = ReturnCount,
            ["created_at"] = UtcTime.Iso(CreatedAt),
            ["updated_at"] = UtcTime.Iso(UpdatedAt),
        };
        if (includeEvents)
        {
            outDict["events"] = Events.OrderBy(e => e.CreatedAt).Select(e => e.ToDict()).ToList();
        }
        return outDict;
    }
}

/// <summary>One line of a ticket's history: raised, assigned, claimed, a
/// note, returned, sent again, resolved.</summary>
public class TicketEvent
{
    public string EventId { get; set; } = Guid.NewGuid().ToString();
    public string TicketId { get; set; } = "";
    public string ActorUserId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string? Body { get; set; }
    public DateTime CreatedAt { get; set; } = Clock.UtcNow();

    public User? Actor { get; set; }

    public Dictionary<string, object?> ToDict() => new()
    {
        ["id"] = EventId,
        ["kind"] = Kind,
        ["body"] = Body,
        ["actor_name"] = Actor?.Employee?.FullName ?? Actor?.Email,
        ["created_at"] = UtcTime.Iso(CreatedAt),
    };
}
