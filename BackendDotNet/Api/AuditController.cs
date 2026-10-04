// Audit log read (admin only). Mirrors Backend/api/audit.py 1:1.
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

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(a => a.OccuredAt).Skip((page - 1) * limit).Take(limit).ToListAsync();
        return Ok(new
        {
            data = rows.Select(a => a.ToDict()).ToList(),
            meta = Pagination.PaginateMeta(page, limit, total),
        });
    }
}
