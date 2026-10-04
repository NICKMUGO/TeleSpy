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
    // Nullable: a self-registered Employee (POST /auth/register) has no
    // staff_number/department yet — HR/Admin assigns those later.
    public string? StaffNumber { get; set; }
    public string FullName { get; set; } = "";
    // Permanent 3-digit PBX extension, e.g. "083" — independent of whichever
    // SIM is currently allocated (that has its own separate MsisdnPbx).
    // Nullable/unique like StaffNumber: assigned once, stays fixed.
    public string? ExtensionCode { get; set; }
    public DateTime CreatedAt { get; set; } = Clock.UtcNow();

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
    // Safaricom's published local (on-net + off-net) tariff: KSh 4.87/minute
    // in peak hours, KSh 2.50/minute off-peak.
    public double PeakRateKes { get; set; }
    public double OffPeakRateKes { get; set; }
    public int PeakStartHour { get; set; } // 0-23, inclusive
    public int PeakEndHour { get; set; } // 0-23, exclusive
    // Fallback rate for an International destination whose country code
    // isn't (yet) priced in InternationalCallRates.
    public double DefaultInternationalRateKes { get; set; }
    public DateTime UpdatedAt { get; set; } = Clock.UtcNow();

    public Dictionary<string, object?> ToDict() => new()
    {
        ["peak_rate_kes"] = PeakRateKes,
        ["off_peak_rate_kes"] = OffPeakRateKes,
        ["peak_start_hour"] = PeakStartHour,
        ["peak_end_hour"] = PeakEndHour,
        ["default_international_rate_kes"] = DefaultInternationalRateKes,
        ["updated_at"] = UpdatedAt.ToString("o"),
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
        ["updated_at"] = UpdatedAt.ToString("o"),
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
            ["created_at"] = CreatedAt.ToString("o"),
        };
        if (include.Contains("allocations"))
        {
            outDict["allocations"] = Allocations.OrderBy(a => a.StartAt).Select(a => a.ToDict()).ToList();
        }
        if (viewer.Role?.RoleName == TeleSpy.Role.Admin)
        {
            outDict["iccid"] = Security.DecryptValue(IccidEnc);
            outDict["msisdn"] = Security.DecryptValue(MsisdnEnc);
            outDict["extension"] = MsisdnPbxEnc is { Length: > 0 } ? Security.DecryptValue(MsisdnPbxEnc) : null;
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
            ["start_at"] = StartAt.ToString("o"),
            ["end_at"] = EndAt?.ToString("o"),
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
        ["resolved_at"] = ResolvedAt?.ToString("o"),
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

/// <summary>Per employee, per month — source of "Total Cost per Employee"
/// and what cost-ceiling checks compare against.</summary>
public class UsageSummary
{
    public string SummaryId { get; set; } = Guid.NewGuid().ToString();
    public string EmployeeId { get; set; } = "";
    public string Month { get; set; } = ""; // "YYYY-MM"
    public double TotalCost { get; set; }
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
        ["extension_code"] = ExtensionCode,
        ["updated_at"] = UpdatedAt.ToString("o"),
    };
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
        ["occured_at"] = OccuredAt.ToString("o"),
    };
}
