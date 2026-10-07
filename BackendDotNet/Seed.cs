// Seed data for local development / demos, built from the real CDR dataset
// (ML/data/processed/cdr_preprocessed.csv — the file
// ML/preprocessing/run_preprocessing.py produces and ML/training/billing.py
// prices). Never point this at a real environment.
//
// From the dataset: every 3-digit extension that places a call becomes an
// Employee (ExtensionCode) with a SIM card whose PBX extension is that same
// code, and every call placed from one of those extensions becomes a usage
// event (calls coming in from outside numbers are not tracked) — same extension,
// destination, timestamp and duration as the CDR, classified and attributed
// by the same rules the real CDR ingestion endpoint (POST /cdr/ingest) uses.
//
// Not in the dataset, so still generated with Bogus (the C# counterpart to
// Python's Faker): departments, telco plans, people's names, staff numbers,
// email addresses, and each SIM's ICCID / mobile number.
//
// Idempotent: skips entirely if any Department already exists, so re-running
// this after real data has accumulated is a no-op rather than a
// duplicate-data hazard.
//
// Run with:
//     dotnet run -- --seed
using System.Globalization;
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

    // Monthly call-spend ceilings, sized from the dataset: each
    // department's spend in its one full month (after the contract
    // discount) plus about a quarter of headroom. The line's fixed monthly
    // charge is a company-level cost and is not part of these.
    private static readonly (string Name, string Code, double Budget)[] Departments =
    [
        ("Engineering", "ENG", 8_500.0),
        ("Sales", "SLS", 6_000.0),
        ("Finance", "FIN", 7_500.0),
        ("Human Resources", "HR", 4_500.0),
        ("Operations", "OPS", 7_500.0),
    ];

    private static readonly (string Name, string Provider, double Rate)[] TelcoPlanSeeds =
    [
        ("Safaricom Corporate 500", "Safaricom", 4.5),
        ("Airtel Business Flex", "Airtel", 4.0),
        ("Telkom Enterprise", "Telkom", 5.5),
    ];

    // The preprocessed CDR dataset, relative to the repository root. Found
    // by walking up from the working directory (the seed is run from
    // BackendDotNet/); set CDR_DATASET_PATH to point somewhere else.
    private const string DatasetRelativePath = "ML/data/processed/cdr_preprocessed.csv";
    private const string DatasetPathEnvVar = "CDR_DATASET_PATH";

    // Usage events are inserted in batches of this size rather than one
    // SaveChanges per row — the dataset is tens of thousands of calls.
    private const int UsageEventBatchSize = 2000;

    /// <summary>One call from the dataset — the same fields POST /cdr/ingest
    /// takes per record.</summary>
    private sealed record CdrRow(string Orig, string Dest, double DurationSec, DateTime OccuredAt, string? SourceFile);

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

        // Read the whole dataset before writing anything, so a missing or
        // malformed file fails here rather than leaving a half-seeded
        // database behind.
        var datasetPath = ResolveDatasetPath();
        var datasetCalls = LoadDataset(datasetPath);

        // Only calls placed *from* one of our extensions are tracked — the
        // same "bare 3-digit extension" rule ClassifyCall() uses to decide a
        // call is one of ours. Rows whose `orig` is anything else (an
        // outside number calling in, a blank origin) are left out. So are
        // calls that were never answered: duration runs from pickup to
        // hang-up, so a zero duration is a call that never connected —
        // nothing to cost or analyse, only rows to store.
        var fromExtension = datasetCalls
            .Where(c => CallClassification.ClassifyNumber(c.Orig) == Constants.CallClassInternal)
            .ToList();
        var calls = fromExtension.Where(c => c.DurationSec > 0).ToList();
        Console.WriteLine($"Loaded {datasetCalls.Count} calls from {datasetPath}; " +
            $"{calls.Count} answered calls placed from an extension kept, " +
            $"{datasetCalls.Count - fromExtension.Count} inbound/other and " +
            $"{fromExtension.Count - calls.Count} unanswered (zero duration) skipped.");

        // Every extension that places a call in the dataset. Shuffled
        // (deterministically) so departments don't end up as contiguous
        // number ranges.
        var extensions = faker.Random.Shuffle(
            calls.Select(c => c.Orig)
                .Distinct()
                .Order(StringComparer.Ordinal)
                .ToList()).ToList();
        if (extensions.Count < Departments.Length)
        {
            throw new InvalidDataException(
                $"{datasetPath} has only {extensions.Count} calling extension(s); need at least one per department ({Departments.Length}).");
        }

        // Allocations start before the dataset's first call, so every call
        // falls inside its extension's allocation (SimAllocation.IsActiveAt).
        var allocationStart = calls.Min(c => c.OccuredAt).Date.AddDays(-1);

        var departments = new List<Department>();
        foreach (var (name, code, budget) in Departments)
        {
            var dept = new Department { Name = name, CostCentreCode = code, BudgetCeiling = budget };
            db.Departments.Add(dept);
            departments.Add(dept);
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

        // --- One Employee + SIM + allocation per dataset extension, dealt
        // round-robin across the departments. The first extension dealt to
        // each department is its Manager. ----------------------------------
        var usedEmails = new HashSet<string>();
        // Employee names are unique (see EmployeeNames) — the Admin's is
        // already taken.
        var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { adminEmployee.FullName };
        var allocationByExtension = new Dictionary<string, string>();
        for (var index = 0; index < extensions.Count; index++)
        {
            var extension = extensions[index];
            var dept = departments[index % departments.Count];
            var code = dept.CostCentreCode!;
            var isManager = index < departments.Count;

            var employee = new Employee
            {
                DepartmentId = dept.DepartmentId, FullName = UniqueName(faker, usedNames),
                StaffNumber = isManager ? $"{code}-MGR-01" : $"{code}-{index / departments.Count:D3}",
                ExtensionCode = extension,
            };
            db.Employees.Add(employee);
            await db.SaveChangesAsync();

            string email;
            if (!isManager) email = UniqueEmail(faker, usedEmails);
            else if (code == DemoManagerDepartment) email = DemoManagerEmail;
            else email = $"{code.ToLowerInvariant()}.manager@telespy.local";
            await MakeUserAsync(db, employee, email, isManager ? Role.Manager : Role.Employee, DemoPassword);

            var sim = MakeSim(faker, index, extension);
            sim.PlanId = faker.PickRandom(plans).PlanId;
            db.SimCards.Add(sim);
            await db.SaveChangesAsync();
            var allocation = new SimAllocation { SimId = sim.SimId, EmployeeId = employee.EmployeeId, StartAt = allocationStart };
            db.SimAllocations.Add(allocation);
            await db.SaveChangesAsync();
            allocationByExtension[extension] = allocation.AllocationId;
        }

        await SeedUsageAsync(db, calls, allocationByExtension);

        db.AuditLogs.Add(new AuditLog
        {
            Action = "system_seeded",
            Resource = "database",
            Meta = new Dictionary<string, object?>
            {
                ["departments"] = Departments.Length,
                ["employees"] = extensions.Count,
                ["plans"] = plans.Count,
                ["usage_events"] = calls.Count,
                ["skipped_not_from_extension"] = datasetCalls.Count - calls.Count,
                ["dataset"] = Path.GetFileName(datasetPath),
            },
            OccuredAt = Clock.UtcNow(),
        });
        await db.SaveChangesAsync();

        Console.WriteLine($"Seeded {Departments.Length} departments, {plans.Count} telco plans, " +
            $"{extensions.Count} Manager/Employee accounts (+1 Admin) — one per calling extension in the dataset.");
        Console.WriteLine($"Seeded {calls.Count} usage events from the dataset, each attributed to the employee who placed it, " +
            $"{calls.Min(c => c.OccuredAt):yyyy-MM-dd} to {calls.Max(c => c.OccuredAt):yyyy-MM-dd}.");
        Console.WriteLine($"Admin login:    {AdminEmail} / {AdminPassword}");
        Console.WriteLine($"Manager login:  {DemoManagerEmail} / {DemoPassword}");
        Console.WriteLine($"All other seeded accounts share the password: {DemoPassword}");
        Console.WriteLine("(MFA OTP codes are logged to the console when MAIL_SUPPRESS_SEND=true.)");
    }

    /// <summary>CDR_DATASET_PATH if set, otherwise the first
    /// ML/data/processed/cdr_preprocessed.csv found walking up from the
    /// working directory.</summary>
    private static string ResolveDatasetPath()
    {
        var overridePath = Environment.GetEnvironmentVariable(DatasetPathEnvVar);
        if (!string.IsNullOrWhiteSpace(overridePath))
        {
            if (!File.Exists(overridePath)) throw new FileNotFoundException($"{DatasetPathEnvVar} points at a file that does not exist.", overridePath);
            return Path.GetFullPath(overridePath);
        }

        for (var dir = new DirectoryInfo(Directory.GetCurrentDirectory()); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, DatasetRelativePath);
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException(
            $"CDR dataset not found. Run ML/preprocessing/run_preprocessing.py to produce {DatasetRelativePath}, " +
            $"or set {DatasetPathEnvVar} to the file's path.");
    }

    /// <summary>Reads the preprocessed dataset's orig / dest / duration_sec /
    /// date / orig_time (/ source_file) columns. The file is plain
    /// comma-separated with no quoted fields. date + orig_time are already
    /// Nairobi wall-clock time (see run_preprocessing.py).</summary>
    private static List<CdrRow> LoadDataset(string path)
    {
        using var reader = new StreamReader(path);
        var header = (reader.ReadLine() ?? "").Split(',');
        int Column(string name)
        {
            var index = Array.IndexOf(header, name);
            if (index < 0) throw new InvalidDataException($"{path} has no '{name}' column.");
            return index;
        }
        int orig = Column("orig"), dest = Column("dest"), duration = Column("duration_sec"),
            date = Column("date"), time = Column("orig_time");
        var sourceFile = Array.IndexOf(header, "source_file"); // optional

        var calls = new List<CdrRow>();
        var lineNumber = 1;
        while (reader.ReadLine() is { } line)
        {
            lineNumber++;
            if (line.Length == 0) continue;
            var fields = line.Split(',');
            if (fields.Length != header.Length)
            {
                throw new InvalidDataException($"{path} line {lineNumber}: expected {header.Length} fields, found {fields.Length}.");
            }
            if (!DateTime.TryParseExact($"{fields[date]} {fields[time]}", "yyyy-MM-dd HH:mm:ss",
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out var occuredAt))
            {
                throw new InvalidDataException($"{path} line {lineNumber}: unreadable date/time '{fields[date]} {fields[time]}'.");
            }
            if (!double.TryParse(fields[duration], NumberStyles.Float, CultureInfo.InvariantCulture, out var durationSec))
            {
                throw new InvalidDataException($"{path} line {lineNumber}: unreadable duration '{fields[duration]}'.");
            }
            calls.Add(new CdrRow(fields[orig].Trim(), fields[dest].Trim(), durationSec, occuredAt,
                sourceFile >= 0 && fields[sourceFile].Length > 0 ? fields[sourceFile] : null));
        }
        if (calls.Count == 0) throw new InvalidDataException($"{path} contains no calls.");
        return calls;
    }

    private static string UniqueName(Faker faker, HashSet<string> used)
    {
        string name;
        do
        {
            name = faker.Name.FullName();
        } while (!used.Add(name));
        return name;
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

    /// <summary>A SIM whose PBX extension is the dataset extension it stands
    /// for — the value CDR ingestion matches a call's `orig` against. The
    /// ICCID and mobile number aren't in the dataset, so they're generated.</summary>
    private static SimCard MakeSim(Faker faker, int index, string extension)
    {
        var iccid = $"8925{index:D15}"; // deterministic, guaranteed-unique 19-digit ICCID
        var msisdn = "07" + faker.Random.Replace("########");
        return new SimCard
        {
            IccidEnc = Security.EncryptValue(iccid)!, IccidHash = Security.BlindIndex(iccid)!,
            MsisdnEnc = Security.EncryptValue(msisdn)!, MsisdnHash = Security.BlindIndex(msisdn)!,
            MsisdnPbxEnc = Security.EncryptValue(extension), MsisdnPbxHash = Security.BlindIndex(extension),
            Provider = faker.PickRandom("Safaricom", "Airtel", "Telkom"),
            LifecycleState = "active",
        };
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

    /// <summary>Stores every dataset call as a usage event, exactly as
    /// POST /cdr/ingest would: classified by ClassifyCall(), and attributed
    /// to the allocation of the extension that placed it — every call
    /// passed in was placed from an extension that has one.
    ///
    /// Costing (ComputedCost) and usage_summaries are not produced here —
    /// see ML/training/billing.py, the sole place a KES figure gets
    /// attached to usage, computed from this same dataset. Run
    /// `python ML/training/billing.py` after seeding to populate
    /// usage_summaries / cost figures.</summary>
    private static async Task SeedUsageAsync(TeleSpyDbContext db, List<CdrRow> calls,
        Dictionary<string, string> allocationByExtension)
    {
        // Everything saved so far is done with; stop tracking it so each
        // batch's SaveChanges only has that batch to look at.
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        foreach (var batch in calls.Chunk(UsageEventBatchSize))
        {
            foreach (var call in batch)
            {
                var callClassification = CallClassification.ClassifyCall(call.Orig, call.Dest);
                var excluded = CallClassification.IsExcludedFromAnomalyDetection(call.Orig, call.Dest, callClassification);
                db.UsageEvents.Add(new UsageEvent
                {
                    AllocationId = allocationByExtension[call.Orig], MsisdnPbx = call.Orig, Destination = call.Dest,
                    OccuredAt = call.OccuredAt, DurationMinutes = call.DurationSec / 60.0,
                    CallClassification = callClassification, ExcludedFromAnomalyDetection = excluded,
                    AttributionState = "attributed",
                    SourceFile = call.SourceFile, IngestedAt = Clock.UtcNow(),
                });
            }
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();
        }
    }
}
