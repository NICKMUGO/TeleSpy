// CDR ingestion + the operational usage list. Ingestion is where each raw
// call row is classified and attributed to the SIM allocation active at
// call time. Costing and usage_summaries are no longer produced here — see
// ML/training/billing.py, the sole place a KES figure now gets attached to
// usage (computed straight from the CDR dataset, on its own schedule, not
// live as calls are ingested). Rule-based budget-ceiling anomaly flagging
// at ingest is gone with it, since it depended on a live-updated monthly
// total that no longer exists here; Isolation Forest
// (ML/training/anomaly_detection.py) still runs against usage_events
// independently of cost. Mirrors Backend/api/cdr.py 1:1.
using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

public class CdrRecordDto
{
    public string? Orig { get; set; }
    public string? Dest { get; set; }
    public int? DurationSec { get; set; }
    public string? Date { get; set; }
    public string? OrigTime { get; set; }
    public double? Charge { get; set; }
}

public class CdrIngestRequest
{
    public List<CdrRecordDto>? Records { get; set; }
    public string? SourceFile { get; set; }
}

[ApiController]
public class CdrController(TeleSpyDbContext db, IViewerContext viewerContext, IAuditService audit) : ControllerBase
{
    [HttpPost("/cdr/ingest")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Ingest()
    {
        var actor = await viewerContext.LoadedUserAsync();
        var data = await RequestBody.ReadJsonSilentAsync<CdrIngestRequest>(Request);
        var records = data.Records ?? [];
        var sourceFile = data.SourceFile;

        int ingested = 0, attributed = 0, unattributed = 0, skippedUnanswered = 0;

        // One transaction for the whole batch, mirroring Flask/SQLAlchemy's
        // single db.session.commit() at the end of the loop (with
        // intermediate .flush() calls) — a mid-batch failure rolls back
        // every row ingested so far instead of leaving a partial batch
        // committed.
        await using var transaction = await db.Database.BeginTransactionAsync();

        foreach (var row in records)
        {
            var orig = row.Orig ?? "";
            var dest = row.Dest ?? "";
            var durationSec = row.DurationSec ?? 0;
            // Duration runs from pickup to hang-up, so zero means the call
            // was never answered. Those cost nothing and tell the analytics
            // nothing — they are counted and dropped, not stored.
            if (durationSec <= 0)
            {
                skippedUnanswered++;
                continue;
            }
            var durationMinutes = durationSec / 60.0;
            var callClassification = CallClassification.ClassifyCall(orig, dest);
            var excluded = CallClassification.IsExcludedFromAnomalyDetection(orig, dest, callClassification);

            DateTime occuredAt;
            if (!DateTime.TryParseExact($"{row.Date} {row.OrigTime}", "yyyy-MM-dd HH:mm:ss",
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out occuredAt))
            {
                occuredAt = Clock.UtcNow();
            }

            // Resolve MSISDN (the CDR's own extension, `orig`) to the SIM
            // allocation that was active at the time of the call.
            var origHash = Security.BlindIndex(orig);
            var sim = await db.SimCards.Include(s => s.Allocations).ThenInclude(a => a.Employee).ThenInclude(e => e!.User)
                .ThenInclude(u => u!.Role)
                .Include(s => s.Plan)
                .FirstOrDefaultAsync(s => s.MsisdnPbxHash == origHash);
            SimAllocation? allocation = sim?.Allocations.FirstOrDefault(a => a.IsActiveAt(occuredAt));
            if (allocation is not null) allocation.Sim = sim;

            var @event = new UsageEvent
            {
                MsisdnPbx = orig,
                Destination = dest,
                OccuredAt = occuredAt,
                DurationMinutes = durationMinutes,
                CallClassification = callClassification,
                ExcludedFromAnomalyDetection = excluded,
                SourceFile = sourceFile,
                IngestedAt = Clock.UtcNow(),
            };
            @event.AttributeToAllocation(allocation);

            db.UsageEvents.Add(@event);
            await db.SaveChangesAsync();
            ingested++;

            if (allocation is not null)
            {
                attributed++;
            }
            else
            {
                unattributed++;
            }
        }

        await audit.RecordAuditAsync("cdr_ingested", "usage_event", actorId: actor!.UserId, actorRole: actor.Role?.RoleName,
            meta: new Dictionary<string, object?>
            {
                ["ingested"] = ingested,
                ["attributed"] = attributed,
                ["unattributed"] = unattributed,
                ["skipped_unanswered"] = skippedUnanswered,
                ["source_file"] = sourceFile,
            });
        await transaction.CommitAsync();
        return StatusCode(201, new
        {
            data = new { ingested, attributed, unattributed, skipped_unanswered = skippedUnanswered },
            message = skippedUnanswered > 0
                ? $"CDR batch ingested. {skippedUnanswered} unanswered call(s) with zero duration were skipped."
                : "CDR batch ingested.",
        });
    }
}

/// <summary>Operational list view for Admin/Manager — not in the diagrams,
/// but a reasonable addition alongside the self-service GET /me/usage.</summary>
[ApiController]
public class UsageController(TeleSpyDbContext db, IViewerContext viewerContext) : ControllerBase
{
    [HttpGet("/usage")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> Get()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var (page, limit) = Pagination.PaginateArgs(Request);
        var query = ScopedToViewer(viewer!);

        var classification = Request.Query["classification"].ToString();
        if (!string.IsNullOrEmpty(classification))
        {
            query = query.Where(e => e.CallClassification == classification);
        }
        var extension = Request.Query["extension"].ToString();
        if (!string.IsNullOrEmpty(extension))
        {
            query = query.Where(e => e.MsisdnPbx == extension || e.Destination == extension);
        }
        // ?search= — calls whose extension or destination contains the text.
        var search = Request.Query["search"].ToString().Trim();
        if (search.Length > 0)
        {
            query = query.Where(e => e.MsisdnPbx.Contains(search) || e.Destination.Contains(search));
        }
        // ?month=YYYY-MM — only calls made in that calendar month. Anything
        // that isn't a month is ignored, like an empty filter.
        if (DateTime.TryParseExact(Request.Query["month"].ToString(), "yyyy-MM", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var monthStart))
        {
            var monthEnd = monthStart.AddMonths(1);
            query = query.Where(e => e.OccuredAt >= monthStart && e.OccuredAt < monthEnd);
        }

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(e => e.OccuredAt).ThenBy(e => e.EventId).Skip((page - 1) * limit).Take(limit).ToListAsync();
        return Ok(new
        {
            data = rows.Select(r => r.ToDict()).ToList(),
            meta = Pagination.PaginateMeta(page, limit, total),
        });
    }

    /// <summary>GET /usage/months — the calendar months that have usage
    /// events (as "YYYY-MM", newest first) with how many each holds, so the
    /// usage list can offer a month to filter by.</summary>
    [HttpGet("/usage/months")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> Months()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var months = await ScopedToViewer(viewer!)
            .GroupBy(e => new { e.OccuredAt.Year, e.OccuredAt.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, Count = g.Count() })
            .OrderByDescending(m => m.Year).ThenByDescending(m => m.Month)
            .ToListAsync();
        return Ok(new
        {
            data = months.Select(m => new { month = $"{m.Year:D4}-{m.Month:D2}", count = m.Count }).ToList(),
        });
    }

    /// <summary>Every usage event an Admin may see; a Manager only sees
    /// events attributed to their own department's employees.</summary>
    private IQueryable<UsageEvent> ScopedToViewer(User viewer)
    {
        var query = db.UsageEvents.AsQueryable();
        if (viewer.Role!.RoleName == TeleSpy.Role.Manager)
        {
            var deptId = viewerContext.ViewerDepartmentId(viewer);
            var allocationIds = db.SimAllocations.Join(db.Employees, a => a.EmployeeId, e => e.EmployeeId, (a, e) => new { a.AllocationId, e.DepartmentId })
                .Where(x => x.DepartmentId == deptId).Select(x => x.AllocationId);
            // .Contains(<empty subquery>) correctly matches zero rows.
            query = query.Where(e => e.AllocationId != null && allocationIds.Contains(e.AllocationId));
        }
        return query;
    }
}
