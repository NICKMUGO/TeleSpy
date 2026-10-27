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
// Each SIM's mobile number follows the company number format — the standard
// prefix, then the extension — so extension 370 is 0703083370.
//
// Not in the dataset, so still generated with Bogus (the C# counterpart to
// Python's Faker): departments, telco plans, people's names, staff numbers,
// email addresses, and each SIM's ICCID.
//
// No real person and no known password is seeded. Every seeded account is a
// placeholder: an unroutable @telespy.local address and a random password
// nobody is told, so none of them can sign in. The first extension dealt to
// each department is that department's placeholder Manager; creating a real
// Manager for the department in the app makes the placeholder an Employee.
// The Admin isn't seeded either — the API creates the first one on boot from
// BOOTSTRAP_ADMIN_EMAIL (see AdminBootstrap), and that Admin creates the
// real accounts.
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

    // Placeholder accounts' addresses: never a deliverable domain, so a
    // seeded database can't email anyone real.
    private const string PlaceholderEmailDomain = "telespy.local";

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
            // Already seeded: never reseed over real edits, only add the
            // dataset extensions that have no one on them yet.
            await TopUpMissingExtensionsAsync(db, faker);
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

        // Every extension that places a call in the dataset — answered or
        // not, so a line whose calls all went unanswered still has its
        // holder (with nothing billed). Shuffled (deterministically) so
        // departments don't end up as contiguous number ranges.
        var extensions = faker.Random.Shuffle(
            fromExtension.Select(c => c.Orig)
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
        var allocationStart = fromExtension.Min(c => c.OccuredAt).Date.AddDays(-1);

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

        // --- One Employee + SIM + allocation per dataset extension, dealt
        // round-robin across the departments. The first extension dealt to
        // each department is its (placeholder) Manager. --------------------
        // Names and emails are unique — including against an Admin the API
        // may already have bootstrapped.
        var usedEmails = (await db.Users.Select(u => u.Email).ToListAsync()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var usedNames = (await db.Employees.Select(e => e.FullName).ToListAsync()).ToHashSet(StringComparer.OrdinalIgnoreCase);
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

            var email = UniqueEmail(isManager ? $"{code}.manager" : employee.FullName, usedEmails);
            await MakePlaceholderUserAsync(db, employee, email, isManager ? Role.Manager : Role.Employee);

            var sim = MakeSim(index, extension);
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
            $"{extensions.Count} placeholder Manager/Employee accounts — one per calling extension in the dataset.");
        Console.WriteLine($"Seeded {calls.Count} usage events from the dataset, each attributed to the employee who placed it, " +
            $"{calls.Min(c => c.OccuredAt):yyyy-MM-dd} to {calls.Max(c => c.OccuredAt):yyyy-MM-dd}.");
        Console.WriteLine($"Seeded accounts are placeholders (@{PlaceholderEmailDomain}, no usable password) — none can sign in.");
        Console.WriteLine("Start the API with BOOTSTRAP_ADMIN_EMAIL set in .env to create the first Admin, then add real people from Employees.");
    }

    /// <summary>For a database seeded before every calling extension got a
    /// holder: adds a placeholder Employee + SIM + allocation for each
    /// dataset extension that no employee has and no SIM carries, into the
    /// department with the fewest people. Nothing existing is changed.
    /// Only unanswered calls come from these lines, so they get no usage
    /// events — they show up with nothing billed.</summary>
    private static async Task TopUpMissingExtensionsAsync(TeleSpyDbContext db, Faker faker)
    {
        var datasetPath = ResolveDatasetPath();
        var fromExtension = LoadDataset(datasetPath)
            .Where(c => CallClassification.ClassifyNumber(c.Orig) == Constants.CallClassInternal)
            .ToList();
        var held = (await db.Employees.Where(e => e.ExtensionCode != null)
            .Select(e => e.ExtensionCode!).ToListAsync()).ToHashSet();
        var carriedHashes = (await db.SimCards.Where(s => s.MsisdnPbxHash != null)
            .Select(s => s.MsisdnPbxHash!).ToListAsync()).ToHashSet();
        var missing = fromExtension.Select(c => c.Orig).Distinct().Order(StringComparer.Ordinal)
            .Where(x => !held.Contains(x) && !carriedHashes.Contains(Security.BlindIndex(x)!))
            .ToList();
        if (missing.Count == 0)
        {
            Console.WriteLine("Seed data already present, and every calling extension in the dataset has a holder — nothing to add.");
            return;
        }

        var departments = await db.Departments.ToListAsync();
        var headcount = await db.Employees.Where(e => e.RemovedAt == null)
            .GroupBy(e => e.DepartmentId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Key ?? "", g => g.Count);
        var staffNumbers = (await db.Employees.Where(e => e.StaffNumber != null)
            .Select(e => e.StaffNumber!).ToListAsync()).ToHashSet();
        var iccidHashes = (await db.SimCards.Select(s => s.IccidHash).ToListAsync()).ToHashSet();
        var planIds = await db.TelcoPlans.Select(p => p.PlanId).ToListAsync();
        var usedEmails = (await db.Users.Select(u => u.Email).ToListAsync()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var usedNames = (await db.Employees.Select(e => e.FullName).ToListAsync()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var allocationStart = fromExtension.Min(c => c.OccuredAt).Date.AddDays(-1);
        var simIndex = await db.SimCards.CountAsync();

        foreach (var extension in missing)
        {
            var dept = departments.MinBy(d => headcount.GetValueOrDefault(d.DepartmentId))!;
            headcount[dept.DepartmentId] = headcount.GetValueOrDefault(dept.DepartmentId) + 1;
            var code = dept.CostCentreCode!;
            var number = 1;
            while (staffNumbers.Contains($"{code}-{number:D3}")) number++;
            var staffNumber = $"{code}-{number:D3}";
            staffNumbers.Add(staffNumber);

            var employee = new Employee
            {
                DepartmentId = dept.DepartmentId, FullName = UniqueName(faker, usedNames),
                StaffNumber = staffNumber, ExtensionCode = extension,
            };
            db.Employees.Add(employee);
            await db.SaveChangesAsync();
            await MakePlaceholderUserAsync(db, employee, UniqueEmail(employee.FullName, usedEmails), Role.Employee);

            SimCard sim;
            do { sim = MakeSim(simIndex++, extension); } while (iccidHashes.Contains(sim.IccidHash));
            iccidHashes.Add(sim.IccidHash);
            if (planIds.Count > 0) sim.PlanId = faker.PickRandom(planIds);
            db.SimCards.Add(sim);
            await db.SaveChangesAsync();
            db.SimAllocations.Add(new SimAllocation { SimId = sim.SimId, EmployeeId = employee.EmployeeId, StartAt = allocationStart });
            await db.SaveChangesAsync();
            Console.WriteLine($"Added extension {extension}: {employee.FullName} ({staffNumber}, {dept.Name}).");
        }

        db.AuditLogs.Add(new AuditLog
        {
            Action = "system_seed_topped_up",
            Resource = "database",
            Meta = new Dictionary<string, object?> { ["extensions"] = missing, ["dataset"] = Path.GetFileName(datasetPath) },
            OccuredAt = Clock.UtcNow(),
        });
        await db.SaveChangesAsync();
        Console.WriteLine($"Added {missing.Count} placeholder employee(s) for dataset extensions that had no holder.");
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

    /// <summary>"Jane O'Neil" -> jane.oneil@telespy.local (then
    /// jane.oneil2@…, … if taken).</summary>
    private static string UniqueEmail(string basis, HashSet<string> used)
    {
        var words = basis.ToLowerInvariant()
            .Split([' ', '.', '-'], StringSplitOptions.RemoveEmptyEntries)
            .Select(w => new string(w.Where(char.IsAsciiLetterOrDigit).ToArray()))
            .Where(w => w.Length > 0);
        var local = string.Join('.', words);
        if (local.Length == 0) local = "user";
        var email = $"{local}@{PlaceholderEmailDomain}";
        for (var n = 2; !used.Add(email); n++) email = $"{local}{n}@{PlaceholderEmailDomain}";
        return email;
    }

    /// <summary>A SIM whose PBX extension is the dataset extension it stands
    /// for — the value CDR ingestion matches a call's `orig` against — and
    /// whose mobile number is the company prefix followed by that extension.
    /// The ICCID isn't in the dataset, so it's generated.</summary>
    private static SimCard MakeSim(int index, string extension)
    {
        var iccid = $"8925{index:D15}"; // deterministic, guaranteed-unique 19-digit ICCID
        var msisdn = BillingConstants.DefaultCompanyNumberPrefix + extension;
        return new SimCard
        {
            IccidEnc = Security.EncryptValue(iccid)!, IccidHash = Security.BlindIndex(iccid)!,
            MsisdnEnc = Security.EncryptValue(msisdn)!, MsisdnHash = Security.BlindIndex(msisdn)!,
            MsisdnPbxEnc = Security.EncryptValue(extension), MsisdnPbxHash = Security.BlindIndex(extension),
            Provider = BillingConstants.DefaultHomeNetworkName, // the company numbers are all on the home network
            LifecycleState = "active",
        };
    }

    /// <summary>A login nobody can use: a random password that is never
    /// shown (as EmployeesController.Post does before emailing a link).
    /// The account exists so the person has a role — Manager or Employee.</summary>
    private static async Task<User> MakePlaceholderUserAsync(TeleSpyDbContext db, Employee employee, string email, string role)
    {
        var user = new User
        {
            EmployeeId = employee.EmployeeId, Email = email, RoleId = Constants.RoleSlugs[role],
            IsActive = true, MustChangePassword = true,
        };
        user.SetPassword(Security.GenerateResetToken());
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
