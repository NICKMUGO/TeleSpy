// Deadline alerts for tickets, checked every few minutes:
// - a ticket past its SLA deadline (and not paused) escalates: the handling
//   department's Manager is emailed and pushed, and whoever is working it is
//   pushed — once per deadline (Ticket.EscalatedAt; reopening clears it);
// - a forward past its reply-by time: whoever forwarded it, whoever it went
//   to, and that department's Manager are told — once (TicketForward.EscalatedAt).
// Each alert is written to the ticket's history with no actor (TeleSpy did it).
// It also sweeps up any finished ticket's leftover conversation and files
// (Services/TicketFiles.cs).
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Api;
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Services;

public class TicketDeadlines(IServiceScopeFactory scopes, ILogger<TicketDeadlines> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the API finish starting (migrations, bootstrap) first.
        try { await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); }
        catch (OperationCanceledException) { return; }

        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                await CheckAsync(stoppingToken);
            }
            catch (Exception exc) when (exc is not OperationCanceledException)
            {
                logger.LogWarning(exc, "Ticket deadline check failed; trying again next round");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task CheckAsync(CancellationToken cancellationToken)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TeleSpyDbContext>();
        var mail = scope.ServiceProvider.GetRequiredService<IMailService>();
        var push = scope.ServiceProvider.GetRequiredService<IPushService>();
        var hub = scope.ServiceProvider.GetRequiredService<IHubContext<TicketsHub>>();
        var now = Clock.UtcNow();

        // Finished tickets that still have a conversation (from before this
        // was done on the spot, or a clean-up that failed): delete it.
        var finished = new[] { TicketStatus.Resolved, TicketStatus.Withdrawn, TicketStatus.Closed };
        var leftovers = await db.TicketEvents
            .Where(e => (e.Kind == "note" || e.Kind == "attachment") &&
                        db.Tickets.Any(t => t.TicketId == e.TicketId && finished.Contains(t.Status)))
            .Select(e => e.TicketId).Distinct().Take(200)
            .ToListAsync(cancellationToken);
        await TicketFiles.PurgeConversationAsync(db, leftovers, logger, cancellationToken);
        if (leftovers.Count > 0)
        {
            logger.LogInformation("Cleared the conversation of {Count} finished ticket(s)", leftovers.Count);
        }

        var overdue = await db.Tickets
            .Include(t => t.Department)
            .Include(t => t.ClaimedBy).ThenInclude(u => u!.Employee)
            .Include(t => t.Forwards)
            .Where(t => (t.Status == TicketStatus.Open || t.Status == TicketStatus.InProgress) &&
                        t.DueAt < now && t.EscalatedAt == null && t.PausedAt == null &&
                        !t.Forwards.Any(f => f.Status == TicketForwardStatus.Pending))
            .ToListAsync(cancellationToken);

        var lateForwards = await db.TicketForwards
            .Include(f => f.Ticket)
            .Include(f => f.FromUser).ThenInclude(u => u!.Employee)
            .Include(f => f.ToUser).ThenInclude(u => u!.Employee)
            .Include(f => f.ToDepartment)
            .Where(f => f.Status == TicketForwardStatus.Pending && f.DueAt != null && f.DueAt < now && f.EscalatedAt == null)
            .ToListAsync(cancellationToken);

        if (overdue.Count == 0 && lateForwards.Count == 0) return;

        var changed = new HashSet<string>();
        foreach (var ticket in overdue)
        {
            ticket.EscalatedAt = now;
            var number = Ticket.FormatNumber(ticket.Number);
            var late = Ago(now - ticket.DueAt);
            var who = ticket.ClaimedBy?.Employee?.FullName ?? "nobody has taken it yet";
            db.TicketEvents.Add(new TicketEvent
            {
                TicketId = ticket.TicketId, Kind = "escalated", CreatedAt = now,
                Body = $"Past its deadline ({who}). {ticket.Department?.Name}'s Manager was alerted.",
            });
            var managers = await Managers(db, ticket.DepartmentId).ToListAsync(cancellationToken);
            foreach (var manager in managers)
            {
                mail.SendMailSafe(manager.Email, $"Overdue: {number} {ticket.Subject}",
                    $"A ticket in {ticket.Department?.Name}'s queue is past its deadline ({late} late).\n\n" +
                    $"Priority: {ticket.Priority}\nWorking it: {who}\n\n{ticket.Description}\n\n" +
                    "Open it from Team tickets to follow up.");
            }
            var to = managers.Select(m => m.UserId).ToList();
            if (ticket.ClaimedByUserId is { } handler) to.Add(handler);
            push.Notify(to, ticket.TicketId, $"Overdue · {number}", $"Past its deadline: {Short(ticket.Subject)}",
                $"/tickets/{ticket.TicketId}");
            changed.Add(ticket.TicketId);
        }

        foreach (var forward in lateForwards)
        {
            forward.EscalatedAt = now;
            var ticket = forward.Ticket!;
            var number = Ticket.FormatNumber(ticket.Number);
            var target = forward.ToUser?.Employee?.FullName is { } name
                ? $"{name} ({forward.ToDepartment?.Name})"
                : $"everyone in {forward.ToDepartment?.Name}";
            db.TicketEvents.Add(new TicketEvent
            {
                TicketId = ticket.TicketId, Kind = "forward_overdue", CreatedAt = now,
                Body = $"{target} hasn't sent it back yet; it was due {Ago(now - forward.DueAt!.Value)} ago.",
            });
            var managers = await Managers(db, forward.ToDepartmentId).ToListAsync(cancellationToken);
            foreach (var manager in managers)
            {
                mail.SendMailSafe(manager.Email, $"Overdue reply: {number} {ticket.Subject}",
                    $"{forward.FromUser?.Employee?.FullName ?? forward.FromUser?.Email} forwarded a ticket to {target} and it's past its reply-by time.\n\n" +
                    $"What they need:\n{forward.Message}\n\nOpen it from Team tickets (Forwarded to you).");
            }
            if (forward.FromUser is not null)
            {
                mail.SendMailSafe(forward.FromUser.Email, $"No reply yet: {number} {ticket.Subject}",
                    $"{target} hasn't sent back the ticket you forwarded, and it's past the time you gave them. " +
                    "Their Manager has been told. You can also recall it from the ticket.");
            }
            var to = managers.Select(m => m.UserId).ToList();
            to.Add(forward.FromUserId);
            if (forward.ToUserId is { } toUser) to.Add(toUser);
            push.Notify(to, ticket.TicketId, $"Reply overdue · {number}", $"Due back from {target}: {Short(forward.Message)}",
                $"/tickets/{ticket.TicketId}");
            changed.Add(ticket.TicketId);
        }

        await db.SaveChangesAsync(cancellationToken);
        foreach (var ticketId in changed)
        {
            try
            {
                await hub.Clients.Group(TicketsHub.Group(ticketId))
                    .SendAsync("ticketChanged", new { ticket_id = ticketId }, cancellationToken);
            }
            catch (Exception exc) when (exc is not OperationCanceledException)
            {
                logger.LogWarning(exc, "Couldn't broadcast a change to ticket {TicketId}", ticketId);
            }
        }
        logger.LogInformation("Ticket deadlines: {Tickets} overdue ticket(s), {Forwards} overdue forward(s) escalated",
            overdue.Count, lateForwards.Count);
    }

    private static IQueryable<User> Managers(TeleSpyDbContext db, string departmentId) => db.Users
        .Where(u => u.IsActive && u.Role != null && u.Role.RoleName == Role.Manager &&
                    u.Employee != null && u.Employee.RemovedAt == null && u.Employee.DepartmentId == departmentId);

    private static string Short(string text, int max = 120) =>
        text.Length <= max ? text : text[..(max - 1)].TrimEnd() + "…";

    private static string Ago(TimeSpan span) =>
        span.TotalMinutes < 90 ? $"{Math.Max(1, (int)span.TotalMinutes)} min"
        : span.TotalHours < 48 ? $"{(int)span.TotalHours} h"
        : $"{(int)span.TotalDays} days";
}
