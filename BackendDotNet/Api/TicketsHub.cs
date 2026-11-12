// Live ticket conversation (SignalR, built into ASP.NET Core — no outside
// service). A browser with a ticket open joins that ticket's group; when
// anything happens on the ticket (a message, claimed, resolved…) the API
// tells the group "ticketChanged" and each page refetches the ticket, so a
// message shows up for everyone at once. "typing" is passed straight to the
// others in the group and never stored.
//
// Sign-in: CurrentUserMiddleware checks the token on the connection request
// (a browser can't send an Authorization header on a WebSocket, so the
// SignalR client puts it in ?access_token=) and records the user id in
// HttpContext.Items, which the hub reads for every call on the connection.
// Joining checks the same visibility rule the REST endpoints use.
//
// Presence ("who's viewing"): TicketPresence remembers, in memory, which
// people have each ticket open in a tab that's in front of them, and the hub
// sends the group the new list ("viewers") whenever it changes. Push
// notifications use it too: someone already looking at a ticket isn't
// pushed about it. In memory is enough because the whole app runs as one
// process on one VM; a restart just empties it until pages reconnect.
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Api;

public class TicketsHub(TeleSpyDbContext db, TicketPresence presence) : Hub
{
    public const string Path = "/hubs/tickets";

    public static string Group(string ticketId) => $"ticket:{ticketId}";

    private string? UserId => Context.GetHttpContext()?.Items[CurrentUserMiddleware.UserIdItem] as string;

    /// <summary>Start getting live updates for one ticket. Returns false
    /// (and joins nothing) when the caller can't see it.</summary>
    public async Task<bool> JoinTicket(string ticketId, bool visible = true)
    {
        var userId = UserId;
        if (userId is null) return false;
        var viewer = await db.Users.Include(u => u.Role).Include(u => u.Employee).ThenInclude(e => e!.Department)
            .FirstOrDefaultAsync(u => u.UserId == userId && u.IsActive);
        var ticket = await db.Tickets.AsNoTracking().Include(t => t.Forwards)
            .FirstOrDefaultAsync(t => t.TicketId == ticketId);
        if (viewer is null || ticket is null || !TicketVisibility.CanSee(viewer, viewer.Employee?.Department, ticket))
        {
            return false;
        }
        var name = viewer.Employee?.FullName ?? viewer.Email;
        Context.Items[ticketId] = name;
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(ticketId));
        presence.Set(ticketId, Context.ConnectionId, userId, name, visible);
        await SendViewersAsync(ticketId);
        return true;
    }

    public async Task LeaveTicket(string ticketId)
    {
        Context.Items.Remove(ticketId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(ticketId));
        if (presence.Remove(ticketId, Context.ConnectionId)) await SendViewersAsync(ticketId);
    }

    /// <summary>The tab went to the background or came back. Only after a
    /// successful JoinTicket.</summary>
    public async Task SetVisible(string ticketId, bool visible)
    {
        if (!Context.Items.TryGetValue(ticketId, out var name) || UserId is not { } userId) return;
        if (presence.Set(ticketId, Context.ConnectionId, userId, (string)name!, visible))
        {
            await SendViewersAsync(ticketId);
        }
    }

    /// <summary>"Someone is typing" for the others on the ticket. Only after
    /// a successful JoinTicket, so it can't be sent to a ticket the caller
    /// can't see.</summary>
    public Task Typing(string ticketId) =>
        Context.Items.TryGetValue(ticketId, out var name)
            ? Clients.OthersInGroup(Group(ticketId)).SendAsync("typing", new { ticket_id = ticketId, name })
            : Task.CompletedTask;

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        foreach (var ticketId in presence.RemoveConnection(Context.ConnectionId))
        {
            await SendViewersAsync(ticketId);
        }
        await base.OnDisconnectedAsync(exception);
    }

    private Task SendViewersAsync(string ticketId) =>
        Clients.Group(Group(ticketId)).SendAsync("viewers", new
        {
            ticket_id = ticketId,
            viewers = presence.Viewers(ticketId).Select(v => new { user_id = v.UserId, name = v.Name }),
        });
}

/// <summary>Who has each ticket open in a tab in front of them, kept in
/// memory (one process — see the top of this file). A person with the ticket
/// open in two tabs is listed once; a hidden tab doesn't count.</summary>
public class TicketPresence
{
    private record Entry(string UserId, string Name, bool Visible);

    private readonly object gate = new();
    // ticketId -> connectionId -> who
    private readonly Dictionary<string, Dictionary<string, Entry>> tickets = [];

    /// <summary>Returns true when the visible-viewers list changed.</summary>
    public bool Set(string ticketId, string connectionId, string userId, string name, bool visible)
    {
        lock (gate)
        {
            var before = Signature(ticketId);
            if (!tickets.TryGetValue(ticketId, out var connections)) tickets[ticketId] = connections = [];
            connections[connectionId] = new Entry(userId, name, visible);
            return before != Signature(ticketId);
        }
    }

    public bool Remove(string ticketId, string connectionId)
    {
        lock (gate)
        {
            if (!tickets.TryGetValue(ticketId, out var connections)) return false;
            var before = Signature(ticketId);
            connections.Remove(connectionId);
            if (connections.Count == 0) tickets.Remove(ticketId);
            return before != Signature(ticketId);
        }
    }

    /// <summary>Drops a closed connection everywhere; returns the tickets
    /// whose viewers changed.</summary>
    public List<string> RemoveConnection(string connectionId)
    {
        lock (gate)
        {
            var changed = new List<string>();
            foreach (var ticketId in tickets.Where(t => t.Value.ContainsKey(connectionId)).Select(t => t.Key).ToList())
            {
                if (Remove(ticketId, connectionId)) changed.Add(ticketId);
            }
            return changed;
        }
    }

    public List<(string UserId, string Name)> Viewers(string ticketId)
    {
        lock (gate)
        {
            if (!tickets.TryGetValue(ticketId, out var connections)) return [];
            return connections.Values.Where(e => e.Visible)
                .GroupBy(e => e.UserId).Select(g => (g.Key, g.First().Name))
                .OrderBy(v => v.Name).ToList();
        }
    }

    /// <summary>Is this person looking at the ticket right now?</summary>
    public bool IsViewing(string ticketId, string userId) => Viewers(ticketId).Any(v => v.UserId == userId);

    private string Signature(string ticketId) =>
        string.Join(",", Viewers(ticketId).Select(v => v.UserId));
}

/// <summary>Who can see a ticket — shared by TicketsController and
/// TicketsHub so the two can never disagree.</summary>
public static class TicketVisibility
{
    public static bool CanSee(User viewer, Department? department, Ticket ticket)
    {
        var role = viewer.Role?.RoleName;
        var deskManager = department?.HandlesCustomerService == true && role == TeleSpy.Role.Manager;
        return role == TeleSpy.Role.Admin ||
            ticket.RaisedByUserId == viewer.UserId ||
            (department is not null && ticket.DepartmentId == department.DepartmentId) ||
            deskManager ||
            // Forwarded to them, or to their department, for something (Forwards
            // must be loaded). Stays visible once sent back, as history.
            ticket.Forwards.Any(f => f.ToUserId == viewer.UserId ||
                                     (department is not null && f.ToDepartmentId == department.DepartmentId));
    }
}
