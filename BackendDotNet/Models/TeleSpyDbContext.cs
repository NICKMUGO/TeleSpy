// EF Core DbContext mirroring Backend/models/models.py's SQLAlchemy mapping:
// same table names, snake_case columns, foreign keys, unique constraints and
// indexes. JSON columns (Role.Permissions, AnomalyFlag.ContributingFeatures,
// AuditLog.Meta, TutorialProgress.CompletedStepIds) are stored as a
// serialized string on every provider — the same DB-agnostic behavior
// SQLAlchemy's db.JSON type gives Flask across SQLite/Postgres.
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace TeleSpy.Models;

public class TeleSpyDbContext(DbContextOptions<TeleSpyDbContext> options) : DbContext(options)
{
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<User> Users => Set<User>();
    public DbSet<PasswordHistory> PasswordHistories => Set<PasswordHistory>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();
    public DbSet<Consent> Consents => Set<Consent>();
    public DbSet<TutorialProgress> TutorialProgresses => Set<TutorialProgress>();
    public DbSet<TelcoPlan> TelcoPlans => Set<TelcoPlan>();
    public DbSet<SimCard> SimCards => Set<SimCard>();
    public DbSet<SimAllocation> SimAllocations => Set<SimAllocation>();
    public DbSet<UsageEvent> UsageEvents => Set<UsageEvent>();
    public DbSet<AnomalyFlag> AnomalyFlags => Set<AnomalyFlag>();
    public DbSet<UsageProfile> UsageProfiles => Set<UsageProfile>();
    public DbSet<UsageSummary> UsageSummaries => Set<UsageSummary>();
    public DbSet<ForecastResult> ForecastResults => Set<ForecastResult>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    // All DateTime values in this app are naive UTC wall-clock (see
    // Core/Time.cs's Clock.UtcNow(), Kind=Unspecified) — mirroring
    // Backend/models/models.py's plain `db.DateTime` (no timezone=True),
    // which SQLAlchemy maps to Postgres TIMESTAMP WITHOUT TIME ZONE. Without
    // this, Npgsql's default mapping (`timestamp with time zone`) rejects
    // any non-UTC-Kind DateTime at write time.
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<DateTime>().HaveColumnType("timestamp without time zone");
        configurationBuilder.Properties<DateTime?>().HaveColumnType("timestamp without time zone");
    }

    private static ValueConverter<List<string>, string> StringListConverter() => new(
        v => JsonSerializer.Serialize(v, JsonSerializerOptions.Default),
        v => JsonSerializer.Deserialize<List<string>>(v, JsonSerializerOptions.Default) ?? new List<string>());

    private static ValueComparer<List<string>> StringListComparer() => new(
        (a, b) => (a ?? new()).SequenceEqual(b ?? new()),
        v => v.Aggregate(0, (hash, s) => HashCode.Combine(hash, s.GetHashCode())),
        v => v.ToList());

    private static ValueConverter<Dictionary<string, object?>, string> JsonDictConverter() => new(
        v => JsonSerializer.Serialize(v, JsonSerializerOptions.Default),
        v => JsonSerializer.Deserialize<Dictionary<string, object?>>(v, JsonSerializerOptions.Default) ?? new());

    private static ValueComparer<Dictionary<string, object?>> JsonDictComparer() => new(
        (a, b) => JsonSerializer.Serialize(a, JsonSerializerOptions.Default) == JsonSerializer.Serialize(b, JsonSerializerOptions.Default),
        v => JsonSerializer.Serialize(v, JsonSerializerOptions.Default).GetHashCode(),
        v => new Dictionary<string, object?>(v));

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Role>(e =>
        {
            e.ToTable("roles");
            e.HasKey(x => x.RoleId);
            e.Property(x => x.RoleId).HasColumnName("role_id").HasMaxLength(20);
            e.Property(x => x.RoleName).HasColumnName("role_name").HasMaxLength(32).IsRequired();
            e.HasIndex(x => x.RoleName).IsUnique();
            e.Property(x => x.Permissions).HasColumnName("permissions")
                .HasConversion(StringListConverter()).Metadata.SetValueComparer(StringListComparer());
            e.Property(x => x.CallLimitKshs).HasColumnName("call_limit_kshs");
            e.HasMany(x => x.Users).WithOne(x => x.Role).HasForeignKey(x => x.RoleId);
        });

        modelBuilder.Entity<Department>(e =>
        {
            e.ToTable("departments");
            e.HasKey(x => x.DepartmentId);
            e.Property(x => x.DepartmentId).HasColumnName("department_id").HasMaxLength(36);
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(120).IsRequired();
            e.HasIndex(x => x.Name).IsUnique();
            e.Property(x => x.CostCentreCode).HasColumnName("cost_centre_code").HasMaxLength(40);
            e.HasIndex(x => x.CostCentreCode).IsUnique();
            e.Property(x => x.BudgetCeiling).HasColumnName("budget_ceiling");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.HasMany(x => x.Employees).WithOne(x => x.Department).HasForeignKey(x => x.DepartmentId);
            e.HasMany(x => x.ForecastResults).WithOne(x => x.Department).HasForeignKey(x => x.DepartmentId);
        });

        modelBuilder.Entity<Employee>(e =>
        {
            e.ToTable("employees");
            e.HasKey(x => x.EmployeeId);
            e.Property(x => x.EmployeeId).HasColumnName("employee_id").HasMaxLength(36);
            e.Property(x => x.DepartmentId).HasColumnName("department_id").HasMaxLength(36);
            e.Property(x => x.StaffNumber).HasColumnName("staff_number").HasMaxLength(32);
            e.HasIndex(x => x.StaffNumber).IsUnique();
            e.Property(x => x.FullName).HasColumnName("full_name").HasMaxLength(120).IsRequired();
            e.Property(x => x.ExtensionCode).HasColumnName("extension_code").HasMaxLength(3);
            e.HasIndex(x => x.ExtensionCode).IsUnique();
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.HasOne(x => x.User).WithOne(x => x.Employee).HasForeignKey<User>(x => x.EmployeeId);
            e.HasMany(x => x.Allocations).WithOne(x => x.Employee).HasForeignKey(x => x.EmployeeId);
            e.HasOne(x => x.UsageProfile).WithOne(x => x.Employee).HasForeignKey<UsageProfile>(x => x.EmployeeId);
            e.HasMany(x => x.UsageSummaries).WithOne(x => x.Employee).HasForeignKey(x => x.EmployeeId);
        });

        modelBuilder.Entity<User>(e =>
        {
            e.ToTable("users");
            e.HasKey(x => x.UserId);
            e.Property(x => x.UserId).HasColumnName("user_id").HasMaxLength(36);
            e.Property(x => x.EmployeeId).HasColumnName("employee_id").HasMaxLength(36).IsRequired();
            e.HasIndex(x => x.EmployeeId).IsUnique();
            e.Property(x => x.Email).HasColumnName("email").HasMaxLength(120).IsRequired();
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.PasswordHash).HasColumnName("password_hash").HasMaxLength(128).IsRequired();
            e.Property(x => x.RoleId).HasColumnName("role_id").HasMaxLength(20).IsRequired();
            e.Property(x => x.IsActive).HasColumnName("is_active");
            e.Property(x => x.MustChangePassword).HasColumnName("must_change_password");
            e.Property(x => x.FailedLoginAttempts).HasColumnName("failed_login_attempts");
            e.Property(x => x.LockedUntil).HasColumnName("locked_until");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
            e.HasMany(x => x.PasswordHistory).WithOne(x => x.User).HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.AuditEntries).WithOne(x => x.Actor).HasForeignKey(x => x.ActorUserId);
        });

        modelBuilder.Entity<PasswordHistory>(e =>
        {
            e.ToTable("password_history");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasMaxLength(36);
            e.Property(x => x.UserId).HasColumnName("user_id").HasMaxLength(36).IsRequired();
            e.HasIndex(x => x.UserId);
            e.Property(x => x.PasswordHashValue).HasColumnName("password_hash").HasMaxLength(128).IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
        });

        modelBuilder.Entity<PasswordResetToken>(e =>
        {
            e.ToTable("password_reset_tokens");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasMaxLength(36);
            e.Property(x => x.UserId).HasColumnName("user_id").HasMaxLength(36).IsRequired();
            e.HasIndex(x => x.UserId);
            e.Property(x => x.TokenHash).HasColumnName("token_hash").HasMaxLength(64).IsRequired();
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.Property(x => x.ExpiresAt).HasColumnName("expires_at").IsRequired();
            e.Property(x => x.Consumed).HasColumnName("consumed");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
        });

        modelBuilder.Entity<Consent>(e =>
        {
            e.ToTable("consents");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasMaxLength(36);
            e.Property(x => x.UserId).HasColumnName("user_id").HasMaxLength(36).IsRequired();
            e.HasIndex(x => x.UserId);
            e.Property(x => x.AcceptedTerms).HasColumnName("accepted_terms").IsRequired();
            e.Property(x => x.AcceptedDpaNotice).HasColumnName("accepted_dpa_notice").IsRequired();
            e.Property(x => x.DpaPolicyVersion).HasColumnName("dpa_policy_version").HasMaxLength(20).IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
        });

        modelBuilder.Entity<TutorialProgress>(e =>
        {
            e.ToTable("tutorial_progress");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id").HasMaxLength(36);
            e.Property(x => x.UserId).HasColumnName("user_id").HasMaxLength(36).IsRequired();
            e.HasIndex(x => x.UserId).IsUnique();
            e.Property(x => x.CompletedStepIds).HasColumnName("completed_step_ids")
                .HasConversion(StringListConverter()).Metadata.SetValueComparer(StringListComparer());
            e.Property(x => x.Dismissed).HasColumnName("dismissed");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        });

        modelBuilder.Entity<TelcoPlan>(e =>
        {
            e.ToTable("telco_plans");
            e.HasKey(x => x.PlanId);
            e.Property(x => x.PlanId).HasColumnName("plan_id").HasMaxLength(36);
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(80).IsRequired();
            e.HasIndex(x => x.Name).IsUnique();
            e.Property(x => x.Provider).HasColumnName("provider").HasMaxLength(60);
            e.Property(x => x.PlanIdRef).HasColumnName("plan_id_ref").HasMaxLength(36);
            e.Property(x => x.LifecycleState).HasColumnName("lifecycle_state").HasMaxLength(20);
            e.Property(x => x.RatePerMinuteKes).HasColumnName("rate_per_minute_kes");
            e.HasMany(x => x.Sims).WithOne(x => x.Plan).HasForeignKey(x => x.PlanId);
        });

        modelBuilder.Entity<SimCard>(e =>
        {
            e.ToTable("sim_cards");
            e.HasKey(x => x.SimId);
            e.Property(x => x.SimId).HasColumnName("sim_id").HasMaxLength(36);
            e.Property(x => x.IccidEnc).HasColumnName("iccid_enc").HasMaxLength(255).IsRequired();
            e.Property(x => x.IccidHash).HasColumnName("iccid_hash").HasMaxLength(64).IsRequired();
            e.HasIndex(x => x.IccidHash).IsUnique();
            e.Property(x => x.MsisdnEnc).HasColumnName("msisdn_enc").HasMaxLength(255).IsRequired();
            e.Property(x => x.MsisdnHash).HasColumnName("msisdn_hash").HasMaxLength(64).IsRequired();
            e.HasIndex(x => x.MsisdnHash).IsUnique();
            e.Property(x => x.Provider).HasColumnName("provider").HasMaxLength(60);
            e.Property(x => x.PlanId).HasColumnName("plan_id").HasMaxLength(36);
            e.Property(x => x.LifecycleState).HasColumnName("lifecycle_state").HasMaxLength(20);
            e.Property(x => x.MsisdnPbxEnc).HasColumnName("msisdn_pbx_enc").HasMaxLength(255);
            e.Property(x => x.MsisdnPbxHash).HasColumnName("msisdn_pbx_hash").HasMaxLength(64);
            e.HasIndex(x => x.MsisdnPbxHash).IsUnique();
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
            e.HasMany(x => x.Allocations).WithOne(x => x.Sim).HasForeignKey(x => x.SimId);
        });

        modelBuilder.Entity<SimAllocation>(e =>
        {
            e.ToTable("sim_allocations");
            e.HasKey(x => x.AllocationId);
            e.Property(x => x.AllocationId).HasColumnName("allocation_id").HasMaxLength(36);
            e.Property(x => x.SimId).HasColumnName("sim_id").HasMaxLength(36).IsRequired();
            e.Property(x => x.EmployeeId).HasColumnName("employee_id").HasMaxLength(36).IsRequired();
            e.Property(x => x.StartAt).HasColumnName("start_at").IsRequired();
            e.Property(x => x.EndAt).HasColumnName("end_at");
            e.HasMany(x => x.UsageEvents).WithOne(x => x.Allocation).HasForeignKey(x => x.AllocationId);
        });

        modelBuilder.Entity<UsageEvent>(e =>
        {
            e.ToTable("usage_events");
            e.HasKey(x => x.EventId);
            e.Property(x => x.EventId).HasColumnName("event_id").HasMaxLength(36);
            e.Property(x => x.AllocationId).HasColumnName("allocation_id").HasMaxLength(36);
            e.HasIndex(x => x.AllocationId);
            e.Property(x => x.MsisdnPbx).HasColumnName("msisdn_pbx").HasMaxLength(20).IsRequired();
            e.HasIndex(x => x.MsisdnPbx);
            e.Property(x => x.Destination).HasColumnName("destination").HasMaxLength(20).IsRequired();
            e.Property(x => x.OccuredAt).HasColumnName("occured_at").IsRequired();
            e.HasIndex(x => x.OccuredAt);
            e.Property(x => x.DurationMinutes).HasColumnName("duration_minutes").IsRequired();
            e.Property(x => x.ComputedCost).HasColumnName("computed_cost");
            e.Property(x => x.AttributionState).HasColumnName("attribution_state").HasMaxLength(20);
            e.Property(x => x.CallClassification).HasColumnName("call_classification").HasMaxLength(20);
            e.HasIndex(x => x.CallClassification);
            e.Property(x => x.ExcludedFromAnomalyDetection).HasColumnName("excluded_from_anomaly_detection");
            e.Property(x => x.SourceFile).HasColumnName("source_file").HasMaxLength(255);
            e.Property(x => x.IngestedAt).HasColumnName("ingested_at");
            e.HasOne(x => x.AnomalyFlag).WithOne(x => x.Event).HasForeignKey<AnomalyFlag>(x => x.EventId);
        });

        modelBuilder.Entity<AnomalyFlag>(e =>
        {
            e.ToTable("anomaly_flags");
            e.HasKey(x => x.FlagId);
            e.Property(x => x.FlagId).HasColumnName("flag_id").HasMaxLength(36);
            e.Property(x => x.EventId).HasColumnName("event_id").HasMaxLength(36).IsRequired();
            e.HasIndex(x => x.EventId).IsUnique();
            e.Property(x => x.AnomalyScore).HasColumnName("anomaly_score").IsRequired();
            e.Property(x => x.ContributingFeatures).HasColumnName("contributing_features")
                .HasConversion(JsonDictConverter()).Metadata.SetValueComparer(JsonDictComparer());
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.ResolvedAt).HasColumnName("resolved_at");
            e.Property(x => x.ResolvedByUserId).HasColumnName("resolved_by_user_id").HasMaxLength(36);
        });

        modelBuilder.Entity<UsageProfile>(e =>
        {
            e.ToTable("usage_profiles");
            e.HasKey(x => x.ProfileId);
            e.Property(x => x.ProfileId).HasColumnName("profile_id").HasMaxLength(36);
            e.Property(x => x.EmployeeId).HasColumnName("employee_id").HasMaxLength(36).IsRequired();
            e.HasIndex(x => x.EmployeeId).IsUnique();
            e.Property(x => x.ClusterLabel).HasColumnName("cluster_label").HasMaxLength(40);
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        });

        modelBuilder.Entity<UsageSummary>(e =>
        {
            e.ToTable("usage_summaries");
            e.HasKey(x => x.SummaryId);
            e.Property(x => x.SummaryId).HasColumnName("summary_id").HasMaxLength(36);
            e.Property(x => x.EmployeeId).HasColumnName("employee_id").HasMaxLength(36).IsRequired();
            e.Property(x => x.Month).HasColumnName("month").HasMaxLength(7).IsRequired();
            e.HasIndex(x => new { x.EmployeeId, x.Month }).IsUnique().HasDatabaseName("uq_usage_summaries_employee_month");
            e.Property(x => x.TotalCost).HasColumnName("total_cost");
            e.Property(x => x.ExtensionCode).HasColumnName("extension_code").HasMaxLength(3);
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        });

        modelBuilder.Entity<ForecastResult>(e =>
        {
            e.ToTable("forecast_results");
            e.HasKey(x => x.ForecastId);
            e.Property(x => x.ForecastId).HasColumnName("forecast_id").HasMaxLength(36);
            e.Property(x => x.DepartmentId).HasColumnName("department_id").HasMaxLength(36).IsRequired();
            e.Property(x => x.Period).HasColumnName("period").HasMaxLength(20).IsRequired();
            e.Property(x => x.ForecastedCost).HasColumnName("forecasted_cost");
            e.Property(x => x.ConfidenceLow).HasColumnName("confidence_low");
            e.Property(x => x.ConfidenceHigh).HasColumnName("confidence_high");
            e.Property(x => x.GeneratedAt).HasColumnName("generated_at");
        });

        modelBuilder.Entity<AuditLog>(e =>
        {
            e.ToTable("audit_logs");
            e.HasKey(x => x.AuditId);
            e.Property(x => x.AuditId).HasColumnName("audit_id").HasMaxLength(36);
            e.Property(x => x.ActorUserId).HasColumnName("actor_user_id").HasMaxLength(36);
            e.Property(x => x.Action).HasColumnName("action").HasMaxLength(60).IsRequired();
            e.Property(x => x.OccuredAt).HasColumnName("occured_at");
            e.HasIndex(x => x.OccuredAt);
            e.Property(x => x.ActorRole).HasColumnName("actor_role").HasMaxLength(32);
            e.Property(x => x.Resource).HasColumnName("resource").HasMaxLength(60);
            e.Property(x => x.ResourceId).HasColumnName("resource_id").HasMaxLength(60);
            e.Property(x => x.Meta).HasColumnName("meta")
                .HasConversion(JsonDictConverter()).Metadata.SetValueComparer(JsonDictComparer());
        });
    }
}
