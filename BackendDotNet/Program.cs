// TeleSpy API — application assembly point. Mirrors Backend/app.py: build
// the app, bind services, register the per-domain controllers under Api/,
// and bootstrap the structural `roles` rows. All request-handling logic
// lives under Api/, Services/, and Core/; the EF Core entities are under
// Models/.
//
// Run:
//     dotnet run                      # dev server
//     dotnet ef database update       # apply migrations (mirrors `flask db upgrade`)
//     dotnet run -- --seed            # load demo data (mirrors `python seed.py`)
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

DotNetEnv.Env.Load(); // mirrors core/config.py's load_dotenv()
Config.Validate();    // fail fast on missing secrets, mirrors Config.validate()

if (args.Contains("--seed"))
{
    await Seed.RunAsync();
    return;
}

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

builder.Services.AddDbContext<TeleSpyDbContext>(options => DatabaseConfig.Configure(options, Config.DatabaseUrl));

builder.Services.AddScoped<ICurrentUserAccessor, CurrentUserAccessor>();
builder.Services.AddSingleton<IJwtService, JwtService>();
builder.Services.AddSingleton<ICacheService, CacheService>();
builder.Services.AddScoped<IMailService, MailService>();
builder.Services.AddScoped<IAuditService, AuditService>();
builder.Services.AddScoped<IAllocationService, AllocationService>();
builder.Services.AddScoped<IPasswordResetService, PasswordResetService>();
builder.Services.AddScoped<TeleSpy.Api.IViewerContext, TeleSpy.Api.ViewerContext>();

const string CorsPolicy = "TeleSpyFrontend";
builder.Services.AddCors(options => options.AddPolicy(CorsPolicy, policy =>
    policy.WithOrigins(Config.FrontendOrigins.ToArray())
        .AllowAnyMethod()
        .AllowAnyHeader()
        .AllowCredentials()));

var app = builder.Build();

app.UseCors(CorsPolicy);
app.UseMiddleware<CurrentUserMiddleware>();
app.MapControllers();

using (var scope = app.Services.CreateScope())
{
    await RoleBootstrap.EnsureDefaultRolesAsync(scope.ServiceProvider.GetRequiredService<TeleSpyDbContext>(), app.Logger);
}

app.Run();

public partial class Program; // exposed for WebApplicationFactory-based integration tests
