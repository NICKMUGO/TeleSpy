// Push notifications (Web Push), sent to the browsers and devices where
// someone allowed them. Only two things are pushed (Terms clause 5): a new
// ticket sent to you or your team, and a new message on a ticket you're on.
//
// "Only when you're not on the app" is decided in two places:
// - here: nobody is pushed about a ticket they're looking at right now
//   (TicketPresence, Api/TicketsHub.cs);
// - in the browser (Frontend/public/sw.js): a push that arrives while a
//   TeleSpy tab is in front of you isn't shown.
//
// Like mail, pushes are queued and sent in the background so a request
// never waits on a push service. Payloads hold only a title, one line and
// the page to open — no customer details beyond the ticket's subject.
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Api;
using TeleSpy.Core;
using TeleSpy.Models;
using WebPush;

namespace TeleSpy.Services;

/// <summary>One notification for some people. Tag groups notifications
/// about the same ticket, so a newer one replaces an older one.</summary>
public record PushMessage(IReadOnlyCollection<string> UserIds, string Title, string Body, string Url, string Tag);

public interface IPushService
{
    /// <summary>Queues a notification for these people, leaving out anyone
    /// viewing <paramref name="ticketId"/> right now.</summary>
    void Notify(IEnumerable<string> userIds, string ticketId, string title, string body, string url);
}

public class PushQueue
{
    private readonly Channel<PushMessage> channel = Channel.CreateUnbounded<PushMessage>(
        new UnboundedChannelOptions { SingleReader = true });

    public void Enqueue(PushMessage message) => channel.Writer.TryWrite(message);

    public IAsyncEnumerable<PushMessage> ReadAllAsync(CancellationToken cancellationToken) =>
        channel.Reader.ReadAllAsync(cancellationToken);
}

public class PushService(PushQueue queue, TicketPresence presence) : IPushService
{
    public void Notify(IEnumerable<string> userIds, string ticketId, string title, string body, string url)
    {
        if (!Config.PushEnabled) return;
        var to = userIds.Distinct().Where(id => !presence.IsViewing(ticketId, id)).ToList();
        if (to.Count == 0) return;
        queue.Enqueue(new PushMessage(to, title, body, url, $"ticket-{ticketId}"));
    }
}

/// <summary>Delivers queued pushes, and forgets devices the push service
/// says are gone (uninstalled, permission withdrawn).</summary>
public class PushSender(PushQueue queue, IServiceScopeFactory scopes, ILogger<PushSender> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var client = new WebPushClient();
        await foreach (var message in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                var vapid = new VapidDetails(Config.VapidSubject, Config.VapidPublicKey, Config.VapidPrivateKey);
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<TeleSpyDbContext>();
                var active = db.Users.Where(u => u.IsActive).Select(u => u.UserId);
                var devices = await db.PushDevices
                    .Where(d => message.UserIds.Contains(d.UserId) && active.Contains(d.UserId))
                    .ToListAsync(stoppingToken);
                var payload = JsonSerializer.Serialize(new { title = message.Title, body = message.Body, url = message.Url, tag = message.Tag }, Json);
                var gone = new List<PushDevice>();
                foreach (var device in devices)
                {
                    try
                    {
                        await client.SendNotificationAsync(new PushSubscription(device.Endpoint, device.P256dh, device.Auth),
                            payload, vapid, stoppingToken);
                    }
                    catch (WebPushException exc) when (exc.StatusCode is System.Net.HttpStatusCode.Gone or System.Net.HttpStatusCode.NotFound)
                    {
                        gone.Add(device);
                    }
                    catch (Exception exc) when (exc is not OperationCanceledException)
                    {
                        logger.LogWarning(exc, "Couldn't push to a device of user {UserId}", device.UserId);
                    }
                }
                if (gone.Count > 0)
                {
                    db.PushDevices.RemoveRange(gone);
                    await db.SaveChangesAsync(stoppingToken);
                }
            }
            catch (Exception exc) when (exc is not OperationCanceledException)
            {
                logger.LogError(exc, "Couldn't send push notification \"{Title}\"", message.Title);
            }
        }
    }
}
