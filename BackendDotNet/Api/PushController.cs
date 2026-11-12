// Turning notifications on and off for one browser/device (Services/Push.cs).
// The browser asks the person first (its own Allow/Block question); this
// only stores what it hands back.
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Api;

public class PushKeys
{
    public string? P256dh { get; set; }
    public string? Auth { get; set; }
}

public class PushSubscribeRequest
{
    public string? Endpoint { get; set; }
    public PushKeys? Keys { get; set; }
}

[ApiController]
public class PushController(TeleSpyDbContext db, IViewerContext viewerContext) : ControllerBase
{
    /// <summary>The public key browsers need to subscribe; enabled = false
    /// when the server has no keys configured (push is off).</summary>
    [HttpGet("/push/key")]
    public IActionResult Key() => Ok(new
    {
        data = new { enabled = Config.PushEnabled, public_key = Config.PushEnabled ? Config.VapidPublicKey : null },
    });

    [HttpPost("/push/subscribe")]
    public async Task<IActionResult> Subscribe()
    {
        var viewer = (await viewerContext.LoadedUserAsync())!;
        var data = await RequestBody.ReadJsonSilentAsync<PushSubscribeRequest>(Request);
        var endpoint = data.Endpoint?.Trim();
        if (!Config.PushEnabled)
        {
            return StatusCode(503, new { error_type = "push_disabled", message = "Notifications aren't set up on this server.", status = 503 });
        }
        if (endpoint is null || !Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
            endpoint.Length > 1000 || string.IsNullOrEmpty(data.Keys?.P256dh) || string.IsNullOrEmpty(data.Keys?.Auth) ||
            data.Keys.P256dh.Length > 200 || data.Keys.Auth.Length > 100)
        {
            return StatusCode(422, new { error_type = "validation_error", message = "That isn't a valid notification subscription.", status = 422 });
        }
        // One row per device: the same browser signing in as someone else
        // now notifies them, not the previous person.
        var device = await db.PushDevices.FirstOrDefaultAsync(d => d.Endpoint == endpoint);
        if (device is null)
        {
            device = new PushDevice { Endpoint = endpoint };
            db.PushDevices.Add(device);
        }
        device.UserId = viewer.UserId;
        device.P256dh = data.Keys.P256dh;
        device.Auth = data.Keys.Auth;
        await db.SaveChangesAsync();
        return Ok(new { message = "Notifications are on for this device." });
    }

    [HttpPost("/push/unsubscribe")]
    public async Task<IActionResult> Unsubscribe()
    {
        var viewer = (await viewerContext.LoadedUserAsync())!;
        var data = await RequestBody.ReadJsonSilentAsync<PushSubscribeRequest>(Request);
        var device = await db.PushDevices.FirstOrDefaultAsync(d => d.Endpoint == data.Endpoint && d.UserId == viewer.UserId);
        if (device is not null)
        {
            db.PushDevices.Remove(device);
            await db.SaveChangesAsync();
        }
        return Ok(new { message = "Notifications are off for this device." });
    }
}
