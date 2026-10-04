// Seed data for local development / demos — mirrors Backend/seed.py's model
// exactly (same departments, telco plans, credentials, and heavy-caller
// variance), generated with Bogus — the long-established C# counterpart to
// Python's Faker (same idea: fake-but-plausible records, deterministically
// seeded). Never point this at a real environment.
//
// Creates: departments, telco plans, an Admin account, one Manager per
// department, several Employees per department, a SIM card + allocation for
// every Manager/Employee, and a few months of CDR-shaped usage history (run
// through the same classify/cost/anomaly-score services the real CDR
// ingestion endpoint uses, so seeded data obeys the same business rules real
// traffic would).
//
// Idempotent: skips entirely if any Department already exists, so re-running
// this after real data has accumulated is a no-op rather than a
// duplicate-data hazard.
//
// Run with:
//     dotnet run -- --seed
using Bogus;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy;

public static class Seed
{
    private const int SeedValue = 20260912;

    // Every seeded account uses one of these two passwords, so the demo has
    // known, working credentials out of the box (MustChangePassword=false).
    // The Admin and the DemoManagerDepartment manager use real mailboxes so
    // their MFA OTP / password-reset mail actually arrives when SMTP is
    // configured; every other seeded account stays on an unroutable
    // @telespy.local (or Bogus) address.
    public const string AdminEmail = "nickmugo2@gmail.com";
    public const string AdminPassword = "Admin@12345!";
    public const string DemoPassword = "Passw0rd@1";
    public const string DemoManagerDepartment = "ENG";
    public const string DemoManagerEmail = "nicknjuru13@gmail.com";

    private static readonly (string Name, string Code, double Budget)[] Departments =
    [
        ("Engineering", "ENG", 250_000.0),
        ("Sales", "SLS", 180_000.0),
        ("Finance", "FIN", 90_000.0),
        ("Human Resources", "HR", 60_000.0),
        ("Operations", "OPS", 120_000.0),
    ];

    private static readonly (string Name, string Provider, double Rate)[] TelcoPlanSeeds =
    [
        ("Safaricom Corporate 500", "Safaricom", 4.5),
        ("Airtel Business Flex", "Airtel", 4.0),
        ("Telkom Enterprise", "Telkom", 5.5),
    ];

    private const int EmployeesPerDepartment = 4;
    private const int MonthsOfHistory = 3;
    private const int EventsPerEmployeePerMonth = 12;
    // A few real country codes from Constants.InternationalCountryCodeZones,
    // used to generate a realistic slice of international traffic.
    private static readonly string[] InternationalSampleCodes = ["44", "1", "971", "256"];

    // Employee.ExtensionCode values, drawn from the 3-digit codes that
    // actually appear as a call's origin in the real CDR dataset
    // (ML/data/processed/cdr_preprocessed.csv) with billable (External /
    // International) traffic — so ML/training/billing.py's per-employee
    // cost rollup has real data to attribute to seeded employees out of
    // the box, rather than every seeded extension_code missing the
    // dataset entirely. Mirrors Backend/seed.py's KNOWN_BILLABLE_EXTENSIONS.
    private static readonly string[] KnownBillableExtensions =
    [
        "201", "206", "222", "225", "228", "229", "264", "277", "288", "292",
        "298", "313", "332", "335", "345", "347", "351", "352", "355", "356",
        "364", "365", "366", "367", "368", "369", "372", "376", "379", "382",
        "383", "384", "389", "391", "393", "419", "424", "425", "427", "431",
        "433", "435", "436", "437",
    ];

    public static async Task RunAsync()
    {
        Randomizer.Seed = new Random(SeedValue);
        var faker = new Faker();

        await using var db = DatabaseConfig.CreateStandaloneContext();
        await db.Database.MigrateAsync(); // harmless if already migrated — mirrors seed.py's db.create_all() fallback
        await RoleBootstrap.EnsureDefaultRolesAsync(db, NullLogger.Instance);
        await CallRateBootstrap.EnsureDefaultCallRatesAsync(db, NullLogger.Instance);

        if (await db.Departments.AnyAsync())
        {
            Console.WriteLine("Seed data already present (a Department row exists) — skipping.");
            return;
        }

        var departments = new Dictionary<string, Department>();
        foreach (var (name, code, budget) in Departments)
        {
            var dept = new Department { Name = name, CostCentreCode = code, BudgetCeiling = budget };
            db.Departments.Add(dept);
            departments[code] = dept;
        }
        await db.SaveChangesAsync();

        var plans = new List<TelcoPlan>();
        foreach (var (name, provider, rate) in TelcoPlanSeeds)
        {
            var plan = new TelcoPlan { Name = name, Provider = provider, RatePerMinuteKes = rate, LifecycleState = "active" };
            db.TelcoPlans.Add(plan);
            plans.Add(plan);
        }
        await db.SaveChangesAsync();

        // --- Admin (no department, no SIM — matches how RoleBootstrap
        // treats Admin as having no personal cost ceiling either). ----------
        var adminEmployee = new Employee { FullName = "System Administrator", StaffNumber = "ADM-0001" };
        db.Employees.Add(adminEmployee);
        await db.SaveChangesAsync();
        await MakeUserAsync(db, adminEmployee, AdminEmail, Role.Admin, AdminPassword);

        var simIndex = 0;
        var usedEmails = new HashSet<string>();
        var roster = new List<(Employee Employee, SimAllocation Allocation, string Extension, bool Heavy)>();

        foreach (var (code, dept) in departments)
        {
            // One Manager per department.
            var managerEmployee = new Employee
            {
                DepartmentId = dept.DepartmentId, FullName = faker.Name.FullName(), StaffNumber = $"{code}-MGR-01",
                ExtensionCode = KnownBillableExtensions[simIndex],
            };
            db.Employees.Add(managerEmployee);
            await db.SaveChangesAsync();
            var managerEmail = code == DemoManagerDepartment
                ? DemoManagerEmail
                : $"{code.ToLowerInvariant()}.manager@telespy.local";
            var managerUser = await MakeUserAsync(db, managerEmployee, managerEmail, Role.Manager, DemoPassword);
            managerEmployee.User = managerUser;

            var (managerSim, managerExtension) = MakeSim(faker, simIndex);
            managerSim.PlanId = faker.PickRandom(plans).PlanId;
            db.SimCards.Add(managerSim);
            await db.SaveChangesAsync();
            var managerAllocation = new SimAllocation
            {
                SimId = managerSim.SimId, EmployeeId = managerEmployee.EmployeeId, StartAt = Clock.UtcNow(),
            };
            db.SimAllocations.Add(managerAllocation);
            await db.SaveChangesAsync();
            managerAllocation.Sim = managerSim;
            roster.Add((managerEmployee, managerAllocation, managerExtension, faker.Random.Double() < 0.15));
            simIndex++;

            // A handful of Employees per department.
            for (var i = 1; i <= EmployeesPerDepartment; i++)
            {
                var employee = new Employee
                {
                    DepartmentId = dept.DepartmentId, FullName = faker.Name.FullName(), StaffNumber = $"{code}-{i:D3}",
                    ExtensionCode = KnownBillableExtensions[simIndex],
                };
                db.Employees.Add(employee);
                await db.SaveChangesAsync();
                var email = UniqueEmail(faker, usedEmails);
                var user = await MakeUserAsync(db, employee, email, Role.Employee, DemoPassword);
                employee.User = user;

                var (sim, extension) = MakeSim(faker, simIndex);
                sim.PlanId = faker.PickRandom(plans).PlanId;
                db.SimCards.Add(sim);
                await db.SaveChangesAsync();
                var allocation = new SimAllocation { SimId = sim.SimId, EmployeeId = employee.EmployeeId, StartAt = Clock.UtcNow() };
                db.SimAllocations.Add(allocation);
                await db.SaveChangesAsync();
                allocation.Sim = sim;
                roster.Add((employee, allocation, extension, faker.Random.Double() < 0.15));
                simIndex++;
            }
        }

        var allExtensions = roster.Select(r => r.Extension).ToList();
        foreach (var (employee, allocation, extension, heavy) in roster)
        {
            await SeedUsageForAsync(db, faker, employee, allocation, extension, allExtensions, heavy);
        }

        db.AuditLogs.Add(new AuditLog
        {
            Action = "system_seeded",
            Resource = "database",
            Meta = new Dictionary<string, object?>
            {
                ["departments"] = Departments.Length,
                ["employees"] = roster.Count,
                ["plans"] = plans.Count,
            },
            OccuredAt = Clock.UtcNow(),
        });
        await db.SaveChangesAsync();

        Console.WriteLine($"Seeded {Departments.Length} departments, {plans.Count} telco plans, " +
            $"{roster.Count} Manager/Employee accounts (+1 Admin), and {MonthsOfHistory} months of usage history.");
        Console.WriteLine($"Admin login:    {AdminEmail} / {AdminPassword}");
        Console.WriteLine($"Manager login:  {DemoManagerEmail} / {DemoPassword}");
        Console.WriteLine($"All other seeded accounts share the password: {DemoPassword}");
        Console.WriteLine("(MFA OTP codes are logged to the console when MAIL_SUPPRESS_SEND=true.)");
    }

    private static string UniqueEmail(Faker faker, HashSet<string> used)
    {
        string email;
        do
        {
            email = faker.Internet.Email();
        } while (!used.Add(email));
        return email;
    }

    private static (SimCard Sim, string Extension) MakeSim(Faker faker, int index)
    {
        var iccid = $"8925{index:D15}"; // deterministic, guaranteed-unique 19-digit ICCID
        var msisdn = "07" + faker.Random.Replace("########");
        var extension = $"{100 + index:D3}";
        var sim = new SimCard
        {
            IccidEnc = Security.EncryptValue(iccid)!, IccidHash = Security.BlindIndex(iccid)!,
            MsisdnEnc = Security.EncryptValue(msisdn)!, MsisdnHash = Security.BlindIndex(msisdn)!,
            MsisdnPbxEnc = Security.EncryptValue(extension), MsisdnPbxHash = Security.BlindIndex(extension),
            Provider = faker.PickRandom("Safaricom", "Airtel", "Telkom"),
            LifecycleState = "active",
        };
        return (sim, extension);
    }

    private static async Task<User> MakeUserAsync(TeleSpyDbContext db, Employee employee, string email, string role, string password)
    {
        var user = new User
        {
            EmployeeId = employee.EmployeeId, Email = email, RoleId = Constants.RoleSlugs[role],
            IsActive = true, MustChangePassword = false,
        };
        user.SetPassword(password);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        db.PasswordHistories.Add(new PasswordHistory { UserId = user.UserId, PasswordHashValue = user.PasswordHash, CreatedAt = Clock.UtcNow() });
        return user;
    }

    /// <summary>Weighted mix of internal/external/international destinations,
    /// mirroring a realistic office calling pattern for
    /// CallClassification.ClassifyCall() to work with. At up to 300
    /// KES/minute (IntlZoneSatellite) a single long international call can
    /// dwarf an entire monthly ceiling, so `intlChance` is kept low for most
    /// employees — see SeedUsageForAsync's heavy-caller minority, which is
    /// where most breached ceilings should come from.</summary>
    private static string RandomDestination(Faker faker, List<string> otherExtensions, string ownExtension, double intlChance)
    {
        var roll = faker.Random.Double();
        if (roll < 1 - intlChance - 0.40 && otherExtensions.Count > 0)
        {
            var candidates = otherExtensions.Where(e => e != ownExtension).ToList();
            if (candidates.Count == 0) candidates = otherExtensions;
            return faker.PickRandom(candidates);
        }
        if (roll < 1 - intlChance)
        {
            return "9" + faker.Random.Replace("##########"); // Kenyan external, 10 digits after the 9
        }
        var code = faker.PickRandom(InternationalSampleCodes);
        return $"+{code}{faker.Random.Replace("#######")}";
    }

    private static async Task SeedUsageForAsync(TeleSpyDbContext db, Faker faker, Employee employee,
        SimAllocation allocation, string extension, List<string> allExtensions, bool heavy)
    {
        var now = Clock.UtcNow();
        // ~15% of employees are "heavy callers" (more calls, more
        // international) — the deliberate minority whose monthly total is
        // meant to actually breach their role's cost ceiling, so
        // /budgets/over-limit and /analytics/anomalies have a realistic
        // few-not-most story to tell.
        var eventCount = (int)(EventsPerEmployeePerMonth * (heavy ? 2.2 : 1));
        var intlChance = heavy ? 0.18 : 0.04;

        // Costing (ComputedCost) and usage_summaries are no longer
        // produced here, or at real CDR ingestion time — see
        // ML/training/billing.py, the sole place a KES figure now gets
        // attached to usage, computed straight from the CDR dataset
        // rather than from these seeded events. Run
        // `python ML/training/billing.py` after seeding to populate
        // initial usage_summaries / cost figures.
        for (var monthOffset = MonthsOfHistory - 1; monthOffset >= 0; monthOffset--)
        {
            var monthAnchor = new DateTime(now.Year, now.Month, 1).AddMonths(-monthOffset);
            var monthEnd = monthAnchor.AddMonths(1);

            for (var i = 0; i < eventCount; i++)
            {
                var dest = RandomDestination(faker, allExtensions, extension, intlChance);
                var callClassification = CallClassification.ClassifyCall(extension, dest);
                var excluded = CallClassification.IsExcludedFromAnomalyDetection(extension, dest, callClassification);
                var occuredAt = DateTime.SpecifyKind(faker.Date.Between(monthAnchor, monthEnd), DateTimeKind.Unspecified);
                // International calls are capped much shorter than local
                // ones — a long satellite/premium-zone call is expensive per
                // minute (see Constants.InternationalZoneRateKesPerMinute),
                // so keeping these brief avoids a single call dominating the
                // whole month's cost.
                var durationMinutes = Math.Round(
                    callClassification == Constants.CallClassInternational
                        ? faker.Random.Double(0.5, 5.0)
                        : faker.Random.Double(0.5, 20.0), 2);

                var @event = new UsageEvent
                {
                    AllocationId = allocation.AllocationId, MsisdnPbx = extension, Destination = dest,
                    OccuredAt = occuredAt, DurationMinutes = durationMinutes,
                    CallClassification = callClassification, ExcludedFromAnomalyDetection = excluded,
                    AttributionState = "attributed", SourceFile = "seed", IngestedAt = Clock.UtcNow(),
                };
                db.UsageEvents.Add(@event);
                await db.SaveChangesAsync();
            }
        }
    }
}
