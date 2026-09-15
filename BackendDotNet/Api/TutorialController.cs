// In-app tutorial progress: fetch steps for the caller's role, mark a step
// done/undone, restart, or dismiss. Mirrors Backend/api/tutorial.py 1:1.
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Api;

public class TutorialStepUpdateRequest
{
    public string? StepId { get; set; }
    public bool? Completed { get; set; }
}

[ApiController]
public class TutorialController(TeleSpyDbContext db, IViewerContext viewerContext) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

    [HttpGet("/tutorial/progress")]
    public async Task<IActionResult> Get()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var steps = TutorialContent.StepsForRole(viewer!.Role?.RoleName);
        var record = await db.TutorialProgresses.FirstOrDefaultAsync(r => r.UserId == viewer.UserId);
        var completed = record?.CompletedStepIds ?? [];
        var nextStep = steps.FirstOrDefault(s => !completed.Contains(s.Id))?.Id;
        return Ok(new
        {
            data = new
            {
                steps,
                completed_step_ids = completed,
                next_step_id = nextStep,
                dismissed = record?.Dismissed ?? false,
            },
        });
    }

    [HttpPost("/tutorial/progress")]
    public async Task<IActionResult> Post()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var data = await RequestBody.ReadJsonSilentAsync<TutorialStepUpdateRequest>(Request);
        var stepId = data.StepId;
        var completed = data.Completed ?? true;
        if (string.IsNullOrEmpty(stepId))
        {
            return StatusCode(422, new
            {
                error_type = "validation_error",
                message = "step_id is required.",
                field = "step_id",
                hint = "Include the id of the tutorial step being marked complete/incomplete.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var record = await db.TutorialProgresses.FirstOrDefaultAsync(r => r.UserId == viewer!.UserId);
        if (record is null)
        {
            record = new TutorialProgress { UserId = viewer!.UserId, CompletedStepIds = [], Dismissed = false };
            db.TutorialProgresses.Add(record);
        }

        var ids = new HashSet<string>(record.CompletedStepIds);
        if (completed) ids.Add(stepId); else ids.Remove(stepId);
        record.CompletedStepIds = ids.OrderBy(x => x, StringComparer.Ordinal).ToList();
        record.UpdatedAt = Clock.UtcNow();
        await db.SaveChangesAsync();
        return Ok(new { data = new { step_id = stepId, completed } });
    }
}

[ApiController]
public class TutorialRestartController(TeleSpyDbContext db, IViewerContext viewerContext) : ControllerBase
{
    [HttpPost("/tutorial/restart")]
    public async Task<IActionResult> Post()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var record = await db.TutorialProgresses.FirstOrDefaultAsync(r => r.UserId == viewer!.UserId);
        if (record is null)
        {
            record = new TutorialProgress { UserId = viewer!.UserId };
            db.TutorialProgresses.Add(record);
        }
        record.CompletedStepIds = [];
        record.Dismissed = false;
        record.UpdatedAt = Clock.UtcNow();
        await db.SaveChangesAsync();
        return Ok(new { message = "Tutorial progress reset." });
    }
}

[ApiController]
public class TutorialDismissController(TeleSpyDbContext db, IViewerContext viewerContext) : ControllerBase
{
    [HttpPost("/tutorial/dismiss")]
    public async Task<IActionResult> Post()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var record = await db.TutorialProgresses.FirstOrDefaultAsync(r => r.UserId == viewer!.UserId);
        if (record is null)
        {
            record = new TutorialProgress { UserId = viewer!.UserId, CompletedStepIds = [] };
            db.TutorialProgresses.Add(record);
        }
        record.Dismissed = true;
        record.UpdatedAt = Clock.UtcNow();
        await db.SaveChangesAsync();
        return Ok(new { message = "Tutorial dismissed." });
    }
}
