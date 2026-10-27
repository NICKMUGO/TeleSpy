// Audit log read (admin only). Mirrors Backend/api/audit.py 1:1.
using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Api;

[ApiController]
public class AuditController(TeleSpyDbContext db) : ControllerBase
{
    [HttpGet("/audit")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Get()
    {
        var (page, limit) = Pagination.PaginateArgs(Request);
        var query = db.AuditLogs.AsQueryable();

        var action = Request.Query["action"].ToString();
        if (!string.IsNullOrEmpty(action))
        {
            query = query.Where(a => a.Action == action);
        }
        var actorUserId = Request.Query["actor_user_id"].ToString();
        if (!string.IsNullOrEmpty(actorUserId))
        {
            query = query.Where(a => a.ActorUserId == actorUserId);
        }
        // A time window: `from` inclusive, `to` exclusive, as ISO 8601
        // instants. The frontend sends the viewer's local midnights, so a
        // picked day means that day where they are, not in UTC.
        foreach (var (param, isFrom) in new[] { ("from", true), ("to", false) })
        {
            var raw = Request.Query[param].ToString();
            if (string.IsNullOrEmpty(raw)) continue;
            if (!DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var instant))
            {
                return StatusCode(422, new
                {
                    error_type = "validation_error",
                    message = $"'{param}' isn't a valid date.",
                    field = param,
                    hint = "Send an ISO 8601 date or date-time, e.g. 2026-07-01T00:00:00Z.",
                    status = 422,
                    path = Request.Path.Value,
                    method = Request.Method,
                    timestamp = DateTime.UtcNow.ToString("o"),
                });
            }
            // Stored as naive UTC (see Clock).
            var bound = DateTime.SpecifyKind(instant, DateTimeKind.Unspecified);
            query = isFrom ? query.Where(a => a.OccuredAt >= bound) : query.Where(a => a.OccuredAt < bound);
        }

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(a => a.OccuredAt).Skip((page - 1) * limit).Take(limit).ToListAsync();
        return Ok(new
        {
            data = rows.Select(a => a.ToDict()).ToList(),
            meta = Pagination.PaginateMeta(page, limit, total),
        });
    }
}
