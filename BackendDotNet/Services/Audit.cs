// AuditLog writer — mirrors Backend/services/audit.py: one helper so every
// controller records the trail the same way (actor resolved from the
// current JWT unless overridden).
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Services;

public interface IAuditService
{
    Task RecordAuditAsync(string action, string resource, string? resourceId = null,
        Dictionary<string, object?>? meta = null, string? actorId = null, string? actorRole = null);
}

public class AuditService(TeleSpyDbContext db, ICurrentUserAccessor currentUser) : IAuditService
{
    public async Task RecordAuditAsync(string action, string resource, string? resourceId = null,
        Dictionary<string, object?>? meta = null, string? actorId = null, string? actorRole = null)
    {
        var cu = currentUser.Current;
        db.AuditLogs.Add(new AuditLog
        {
            ActorUserId = actorId ?? cu.Id,
            ActorRole = actorRole ?? cu.Role,
            Action = action,
            Resource = resource,
            ResourceId = resourceId,
            Meta = meta ?? [],
            OccuredAt = Clock.UtcNow(),
        });
        await db.SaveChangesAsync();
    }
}
