// Telco plans (admin only): list + create. Mirrors Backend/api/telco_plans.py 1:1.
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

public class CreateTelcoPlanRequest
{
    public string? Name { get; set; }
    public string? Provider { get; set; }
    public string? PlanIdRef { get; set; }
    public double? RatePerMinuteKes { get; set; }
}

[ApiController]
public class TelcoPlansController(TeleSpyDbContext db, IAuditService audit) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

    [HttpGet("/telco-plans")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Get()
    {
        var plans = await db.TelcoPlans.ToListAsync();
        return Ok(new { data = plans.Select(p => p.ToDict()).ToList() });
    }

    [HttpPost("/telco-plans")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Post()
    {
        var data = await RequestBody.ReadJsonSilentAsync<CreateTelcoPlanRequest>(Request);
        var name = (data.Name ?? "").Trim();
        if (name.Length == 0)
        {
            return StatusCode(422, new
            {
                error_type = "validation_error",
                message = "Plan name is required.",
                field = "name",
                hint = "Include a non-empty name for the telco plan.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (await db.TelcoPlans.AnyAsync(p => p.Name == name))
        {
            return StatusCode(409, new
            {
                error_type = "duplicate_plan",
                message = "A plan with that name already exists.",
                field = "name",
                hint = "Choose a different plan name, or update the existing plan instead.",
                status = 409,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var plan = new TelcoPlan
        {
            Name = name,
            Provider = data.Provider,
            PlanIdRef = data.PlanIdRef,
            RatePerMinuteKes = data.RatePerMinuteKes,
        };
        db.TelcoPlans.Add(plan);
        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("telco_plan_created", "telco_plan", plan.PlanId);
        return StatusCode(201, new { data = plan.ToDict(), message = "Created." });
    }
}
