// TeleSpy API — application assembly point. Mirrors Backend/app.py: build
// the app, bind services, register the per-domain controllers under Api/,
// and bootstrap the structural `roles` rows. All request-handling logic
// lives under Api/, Services/, and Core/; the EF Core entities are under
// Models/.
//
// Run:
//     dotnet run                      # dev server
//     dotnet ef database update       # apply migrations (mirrors `flask db upgrade`)
//     dotnet run -- --migrate         # apply pending migrations and exit (run by the container on deploy)
//     dotnet run -- --seed          # load demo data from the CDR dataset (mirrors `python seed.py`)
//     dotnet run -- --reencrypt       # move stored encrypted values to the current algorithm/key
//
// The first Admin is created on boot from BOOTSTRAP_ADMIN_EMAIL while no
// active Admin exists (see AdminBootstrap); everyone else is created by an
// Admin in the app.
//
// The ML batch jobs (Isolation Forest anomaly detection, KMeans usage
// profiling, spend forecasting) are no longer run in-process here — see
// ML/training/run_ml.ipynb, the single shared implementation both backends'
// databases are populated from (mirrors Backend/app.py, which likewise has
// no in-process ML trigger anymore).
using Microsoft.EntityFrameworkCore;
using TeleSpy;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

// NoClobber: a variable already set in the shell wins over .env (as
// python-dotenv does), so e.g. `DATABASE_URL=… dotnet run` targets another
// database without editing .env.
DotNetEnv.Env.NoClobber().Load(); // mirrors core/config.py's load_dotenv()
Config.Validate();    // fail fast on missing secrets, mirrors Config.validate()

if (args.Contains("--migrate"))
{
    await using var migrateDb = DatabaseConfig.CreateStandaloneContext();
    await migrateDb.Database.MigrateAsync();
    return;
}
if (args.Contains("--seed"))
{
    await Seed.RunAsync();
    return;
}
if (args.Contains("--reencrypt"))
{
    await ReEncrypt.RunAsync();
    return;
}

var builder = WebApplication.CreateBuilder(args);
// Every SQL command at Information floods the console and slows each
// request in Development; slow or failing queries still show as warnings.
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Warning);

builder.Services.AddControllers();

builder.Services.AddDbContext<TeleSpyDbContext>(options => DatabaseConfig.Configure(options, Config.DatabaseUrl));

builder.Services.AddScoped<ICurrentUserAccessor, CurrentUserAccessor>();
builder.Services.AddSingleton<IJwtService, JwtService>();
builder.Services.AddSingleton<ICacheService, CacheService>();
builder.Services.AddSingleton<MailQueue>();
builder.Services.AddHostedService<MailSender>();
builder.Services.AddScoped<IMailService, MailService>();
builder.Services.AddScoped<IAllocationService, AllocationService>();
builder.Services.AddScoped<IStepUpService, StepUpService>();
builder.Services.AddScoped<INotificationService, NotificationService>();
builder.Services.AddScoped<IPasswordResetService, PasswordResetService>();
builder.Services.AddScoped<TeleSpy.Api.IViewerContext, TeleSpy.Api.ViewerContext>();

const string CorsPolicy = "TeleSpyFrontend";
builder.Services.AddCors(options => options.AddPolicy(CorsPolicy, policy =>
    policy.WithOrigins(Config.FrontendOrigins.ToArray())
        .AllowAnyMethod()
        .AllowAnyHeader()
        .AllowCredentials()
        // Let the browser reuse a preflight answer instead of sending an
        // OPTIONS round trip before nearly every API call.
        .SetPreflightMaxAge(TimeSpan.FromHours(2))));

var app = builder.Build();

app.UseCors(CorsPolicy);
app.UseMiddleware<RuleViolationMiddleware>();
app.UseMiddleware<CurrentUserMiddleware>();
app.MapControllers();

using (var scope = app.Services.CreateScope())
{
    var scopedDb = scope.ServiceProvider.GetRequiredService<TeleSpyDbContext>();
    await RoleBootstrap.EnsureDefaultRolesAsync(scopedDb, app.Logger);
    await CallRateBootstrap.EnsureDefaultCallRatesAsync(scopedDb, app.Logger);
    await TicketCategoryBootstrap.EnsureDefaultCategoriesAsync(scopedDb, app.Logger);
    await AdminBootstrap.EnsureBootstrapAdminAsync(scopedDb,
        scope.ServiceProvider.GetRequiredService<IPasswordResetService>(), app.Logger);
}

app.Run();

public partial class Program; // exposed for WebApplicationFactory-based integration tests
