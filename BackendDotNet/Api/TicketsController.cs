// Tickets. Anyone can raise one for an issue another department has to
// handle — the customer service desk (a department with
// HandlesCustomerService) for customers' issues, anyone else for internal
// ones. It's about one of the quick categories (which picks the department)
// or a reason the raiser writes themselves (and then picks the department).
// It goes to the whole department by default, or straight to one person in
// it. That department claims it, and either resolves it with a note — a
// successful escalation for the agent who raised it — or rejects it back to
// the raiser (wrong department, a duplicate, or not a real issue) to fix and
// send again. Missing details aren't a reason to reject: they're asked in the
// ticket's chat. Whoever is on a ticket can also hand it back to their
// team's queue. Calls never create tickets on their own.
//
// Like an incident, every ticket has a priority (high/medium/low) and an
// SLA deadline: raised + that priority's target hours (Admin-set), or how
// long the raiser gives it (4 hours to a month) or a time they pick. Resolved by the deadline meets the SLA,
// after it misses it; time spent returned to the raiser doesn't count.
// GET /tickets/sla reports how the whole organisation is doing against it.
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

public class CreateTicketRequest
{
    public string? Subject { get; set; }
    public string? Description { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }
    public string? CustomerEmail { get; set; }
    public string? BookingReference { get; set; }
    /// <summary>A quick category — or leave it out and give CustomReason
    /// plus DepartmentId.</summary>
    public string? CategoryId { get; set; }
    public string? CustomReason { get; set; }
    /// <summary>Overrides the category's department, when the agent knows
    /// better. Required with a custom reason.</summary>
    public string? DepartmentId { get; set; }
    /// <summary>One person in that department to send it to. Left out, the
    /// whole department's queue gets it.</summary>
    public string? AssignedToUserId { get; set; }
    /// <summary>high | medium | low; medium when left out.</summary>
    public string? Priority { get; set; }
    /// <summary>Hours from now until it breaches the SLA, chosen by the
    /// raiser (4 hours up to a month), instead of the priority's target.
    /// Counted from the server's clock, so a wrong browser clock can't
    /// shift it.</summary>
    public int? SlaHours { get; set; }
    /// <summary>An ISO time to have it resolved by, instead of the
    /// priority's SLA target.</summary>
    public string? DueAt { get; set; }
}

public class SlaTargetsRequest
{
    public int? HighHours { get; set; }
    public int? MediumHours { get; set; }
    public int? LowHours { get; set; }
}

public class TicketNoteRequest
{
    public string? Body { get; set; }
}

public class ResolveTicketRequest
{
    public string? ResolutionNote { get; set; }
}

public class ReturnTicketRequest
{
    /// <summary>wrong_department | duplicate | invalid (TicketRejectReason).</summary>
    public string? ReasonCode { get; set; }
    /// <summary>Optional detail, e.g. which department it belongs to.</summary>
    public string? Reason { get; set; }
}

/// <summary>Why a handling team rejects a ticket. Missing details are not one
/// of them: those are asked for in the ticket's chat.</summary>
public static class TicketRejectReason
{
    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>
    {
        ["wrong_department"] = "Wrong department",
        ["duplicate"] = "Duplicate of another ticket",
        ["invalid"] = "Not a real issue",
    };
}

public class ResendTicketRequest
{
    public string? CategoryId { get; set; }
    /// <summary>Switches the ticket to a reason of its own (no category).</summary>
    public string? CustomReason { get; set; }
    public string? DepartmentId { get; set; }
    public string? Note { get; set; }
}

public class TicketCategoryRequest
{
    public string? Name { get; set; }
    public string? DepartmentId { get; set; }
    public bool? IsActive { get; set; }
}

[ApiController]
public class TicketsController(
    TeleSpyDbContext db,
    IViewerContext viewerContext,
    IMailService mail,
    IHubContext<TicketsHub> hub,
    IPushService push,
    ILogger<TicketsController> logger) : ControllerBase
{
    private const int MaxListed = 200;
    /// <summary>How long a customer's rating link works.</summary>
    private const int FeedbackLinkDays = 14;

    private string NowIso() => DateTime.UtcNow.ToString("o");

    private ObjectResult Error(string errorType, string message, int status, string? field = null, string? hint = null) =>
        StatusCode(status, new
        {
            error_type = errorType,
            message,
            field,
            hint,
            status,
            path = Request.Path.Value,
            method = Request.Method,
            timestamp = NowIso(),
        });

    /// <summary>Who the caller is, as far as tickets go.</summary>
    private sealed record Access(User Viewer, Department? Department, bool IsAdmin, bool IsManager)
    {
        /// <summary>Works the customer service desk: can raise tickets.</summary>
        public bool OnDesk => Department?.HandlesCustomerService == true;
        /// <summary>The desk's Manager sees every desk ticket and agent.</summary>
        public bool DeskManager => OnDesk && IsManager;
        public string? DepartmentId => Department?.DepartmentId;
    }

    private async Task<Access> LoadAccessAsync()
    {
        var viewer = (await viewerContext.LoadedUserAsync())!;
        var departmentId = viewer.Employee?.DepartmentId;
        var department = departmentId is null ? null : await db.Departments.FindAsync(departmentId);
        var role = viewer.Role?.RoleName;
        return new Access(viewer, department, role == TeleSpy.Role.Admin, role == TeleSpy.Role.Manager);
    }

    private IQueryable<Ticket> TicketsWithIncludes() => db.Tickets
        .Include(t => t.Category)
        .Include(t => t.Department)
        .Include(t => t.RaisedBy).ThenInclude(u => u!.Employee)
        .Include(t => t.ClaimedBy).ThenInclude(u => u!.Employee)
        .Include(t => t.ResolvedBy).ThenInclude(u => u!.Employee);

    /// <summary>Ids of everyone in the customer service desk departments —
    /// the people whose tickets the desk Manager oversees.</summary>
    private IQueryable<string> DeskUserIds() => db.Users
        .Where(u => u.Employee != null && u.Employee.Department != null && u.Employee.Department.HandlesCustomerService)
        .Select(u => u.UserId);

    private static bool CanSee(Access access, Ticket ticket) =>
        TicketVisibility.CanSee(access.Viewer, access.Department, ticket);

    /// <summary>Tell everyone with the ticket open (TicketsHub) that it
    /// changed, so their page refetches it. Best effort: a failed broadcast
    /// never fails the request — the page still catches up on its next load.</summary>
    private async Task BroadcastChangedAsync(string ticketId)
    {
        try
        {
            await hub.Clients.Group(TicketsHub.Group(ticketId)).SendAsync("ticketChanged", new { ticket_id = ticketId });
        }
        catch (Exception exc)
        {
            logger.LogWarning(exc, "Couldn't broadcast a change to ticket {TicketId}", ticketId);
        }
    }

    // --- Push notifications (Services/Push.cs) ----------------------------------

    private static string TicketUrl(Ticket ticket) => $"/tickets/{ticket.TicketId}";

    private static string Short(string text, int max = 120) =>
        text.Length <= max ? text : text[..(max - 1)].TrimEnd() + "…";

    /// <summary>A ticket arrived at a team: the one person it's assigned to,
    /// or else everyone in the department. Never whoever sent it.</summary>
    private async Task PushNewTicketAsync(Ticket ticket, string senderId, string? senderName)
    {
        List<string> to = ticket.ClaimedByUserId is { } assignee
            ? [assignee]
            : await AssignableUsers(ticket.DepartmentId).Select(u => u.UserId).ToListAsync();
        to.Remove(senderId);
        var number = Ticket.FormatNumber(ticket.Number);
        var title = ticket.ClaimedByUserId is null ? $"New ticket for {ticket.Department?.Name ?? "your team"}" : "New ticket for you";
        push.Notify(to, ticket.TicketId, $"{title} · {number}",
            $"{(senderName is null ? "" : $"{senderName}: ")}{Short(ticket.Subject)} ({ticket.Priority} priority)", TicketUrl(ticket));
    }

    /// <summary>A new message: once someone has claimed the ticket, only they
    /// and the person who raised it; before that, the raiser and the whole
    /// handling team. Never the sender.</summary>
    private async Task PushMessageAsync(Ticket ticket, User sender, string body)
    {
        var to = new HashSet<string> { ticket.RaisedByUserId };
        if (ticket.ClaimedByUserId is { } claimer) to.Add(claimer);
        else to.UnionWith(await AssignableUsers(ticket.DepartmentId).Select(u => u.UserId).ToListAsync());
        to.Remove(sender.UserId);
        push.Notify(to, ticket.TicketId,
            $"{sender.Employee?.FullName ?? sender.Email} · {Ticket.FormatNumber(ticket.Number)}", Short(body), TicketUrl(ticket));
    }

    /// <summary>Someone in the handling department: they claim and work it.</summary>
    private static bool OnHandlingTeam(Access access, Ticket ticket) =>
        access.DepartmentId is not null && ticket.DepartmentId == access.DepartmentId;

    /// <summary>Resolve/return: whoever claimed it, or the handling
    /// department's Manager (covering for someone away).</summary>
    private static bool CanClose(Access access, Ticket ticket) =>
        OnHandlingTeam(access, ticket) &&
        (ticket.ClaimedByUserId == access.Viewer.UserId || access.IsManager);

    private void AddEvent(Ticket ticket, User actor, string kind, string? body = null)
    {
        db.TicketEvents.Add(new TicketEvent { TicketId = ticket.TicketId, ActorUserId = actor.UserId, Kind = kind, Body = body });
        ticket.UpdatedAt = Clock.UtcNow();
    }

    private async Task<(Ticket? Ticket, Access Access, IActionResult? Problem)> LoadVisibleTicketAsync(string ticketId)
    {
        var access = await LoadAccessAsync();
        var ticket = await TicketsWithIncludes()
            .Include(t => t.Events).ThenInclude(e => e.Actor).ThenInclude(u => u!.Employee)
            .FirstOrDefaultAsync(t => t.TicketId == ticketId);
        // Not found and not visible look the same: a ticket's existence is
        // itself customer information.
        if (ticket is null || !CanSee(access, ticket))
        {
            return (null, access, Error("ticket_not_found", "Ticket not found.", 404, "ticket_id",
                $"No ticket you can see has id '{ticketId}'."));
        }
        return (ticket, access, null);
    }

    /// <summary>For emails: Kenya is UTC+3 all year.</summary>
    private static string NairobiTime(DateTime utc) => utc.AddHours(3).ToString("ddd d MMM yyyy, HH:mm") + " (Nairobi)";

    private static string? Clean(string? value, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return trimmed.Length > maxLength ? trimmed[..maxLength] : trimmed;
    }

    // --- Who am I, here --------------------------------------------------

    [HttpGet("/tickets/me")]
    public async Task<IActionResult> Me()
    {
        var access = await LoadAccessAsync();
        var receives = access.DepartmentId is not null &&
            await db.TicketCategories.AnyAsync(c => c.IsActive && c.DepartmentId == access.DepartmentId);
        var receivedAny = access.DepartmentId is not null &&
            await db.Tickets.AnyAsync(t => t.DepartmentId == access.DepartmentId);
        return Ok(new
        {
            data = new
            {
                on_desk = access.OnDesk,
                desk_manager = access.DeskManager,
                is_admin = access.IsAdmin,
                department_id = access.DepartmentId,
                department_name = access.Department?.Name,
                // Their department is (or has been) sent tickets, so they
                // get the team queue.
                handles_tickets = receives || receivedAny,
            },
        });
    }

    // --- Categories --------------------------------------------------------

    [HttpGet("/tickets/categories")]
    public async Task<IActionResult> Categories()
    {
        var access = await LoadAccessAsync();
        var includeInactive = access.IsAdmin && Request.Query["all"] == "true";
        var categories = await db.TicketCategories.Include(c => c.Department)
            .Where(c => includeInactive || c.IsActive)
            .OrderBy(c => c.Name)
            .ToListAsync();
        return Ok(new { data = categories.Select(c => c.ToDict()) });
    }

    [HttpPost("/tickets/categories")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> CreateCategory()
    {
        var data = await RequestBody.ReadJsonSilentAsync<TicketCategoryRequest>(Request);
        var name = Clean(data.Name, 80);
        if (name is null) return Error("validation_error", "Give the category a name.", 422, "name");
        if (await db.TicketCategories.AnyAsync(c => c.Name.ToLower() == name.ToLower()))
        {
            return Error("duplicate_category", "A category with that name already exists.", 409, "name",
                "Turn the existing one back on instead, or choose another name.");
        }
        if (data.DepartmentId is null || await db.Departments.FindAsync(data.DepartmentId) is null)
        {
            return Error("department_not_found", "Choose the department that handles this category.", 422, "department_id");
        }
        var category = new TicketCategory { Name = name, DepartmentId = data.DepartmentId };
        db.TicketCategories.Add(category);
        await db.SaveChangesAsync();
        await db.Entry(category).Reference(c => c.Department).LoadAsync();
        return StatusCode(201, new { data = category.ToDict() });
    }

    [HttpPatch("/tickets/categories/{categoryId}")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> UpdateCategory(string categoryId)
    {
        var category = await db.TicketCategories.FindAsync(categoryId);
        if (category is null) return Error("category_not_found", "Category not found.", 404, "category_id");
        var data = await RequestBody.ReadJsonSilentAsync<TicketCategoryRequest>(Request);
        if (data.Name is not null)
        {
            var name = Clean(data.Name, 80);
            if (name is null) return Error("validation_error", "Give the category a name.", 422, "name");
            if (await db.TicketCategories.AnyAsync(c => c.CategoryId != categoryId && c.Name.ToLower() == name.ToLower()))
            {
                return Error("duplicate_category", "A category with that name already exists.", 409, "name");
            }
            category.Name = name;
        }
        if (data.DepartmentId is not null)
        {
            if (await db.Departments.FindAsync(data.DepartmentId) is null)
            {
                return Error("department_not_found", "Department not found.", 404, "department_id");
            }
            // Only where new tickets go — tickets already raised stay put.
            category.DepartmentId = data.DepartmentId;
        }
        if (data.IsActive is not null) category.IsActive = data.IsActive.Value;
        await db.SaveChangesAsync();
        await db.Entry(category).Reference(c => c.Department).LoadAsync();
        return Ok(new { data = category.ToDict() });
    }

    // --- SLA targets -------------------------------------------------------

    private async Task<BillingSettings> SettingsAsync() =>
        await db.BillingSettings.FindAsync(BillingConstants.BillingSettingsId)
        ?? throw new InvalidOperationException("Company settings have not been initialised.");

    private static Dictionary<string, object?> TargetsDict(BillingSettings settings) => new()
    {
        ["high_hours"] = settings.SlaHighHours,
        ["medium_hours"] = settings.SlaMediumHours,
        ["low_hours"] = settings.SlaLowHours,
    };

    /// <summary>Hours to resolve, per priority. Anyone can read them — the
    /// new ticket form shows them.</summary>
    [HttpGet("/tickets/sla-targets")]
    public async Task<IActionResult> SlaTargets() => Ok(new { data = TargetsDict(await SettingsAsync()) });

    [HttpPatch("/tickets/sla-targets")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> UpdateSlaTargets()
    {
        var data = await RequestBody.ReadJsonSilentAsync<SlaTargetsRequest>(Request);
        foreach (var (field, value) in new[] { ("high_hours", data.HighHours), ("medium_hours", data.MediumHours), ("low_hours", data.LowHours) })
        {
            if (value is < 1 or > BillingConstants.SlaMaxHours)
            {
                return Error("validation_error", $"Targets are 1 to {BillingConstants.SlaMaxHours} hours.", 422, field);
            }
        }
        var settings = await SettingsAsync();
        var high = data.HighHours ?? settings.SlaHighHours;
        var medium = data.MediumHours ?? settings.SlaMediumHours;
        var low = data.LowHours ?? settings.SlaLowHours;
        if (high > medium || medium > low)
        {
            return Error("validation_error", "A higher priority needs a shorter (or equal) target.", 422, "high_hours",
                "Keep High ≤ Medium ≤ Low.");
        }
        settings.SlaHighHours = high;
        settings.SlaMediumHours = medium;
        settings.SlaLowHours = low;
        settings.UpdatedAt = Clock.UtcNow();
        await db.SaveChangesAsync();
        // Only tickets raised from now on — a deadline already given stands.
        return Ok(new { data = TargetsDict(settings) });
    }

    // --- Assigning ------------------------------------------------------------

    /// <summary>The active people in a department, for sending a ticket to
    /// one of them instead of the whole department.</summary>
    [HttpGet("/tickets/assignees")]
    public async Task<IActionResult> Assignees()
    {
        var departmentId = Request.Query["department_id"].ToString();
        if (string.IsNullOrEmpty(departmentId) || await db.Departments.FindAsync(departmentId) is null)
        {
            return Error("department_not_found", "Department not found.", 404, "department_id");
        }
        var people = await AssignableUsers(departmentId)
            .Select(u => new { user_id = u.UserId, name = u.Employee!.FullName })
            .OrderBy(p => p.name)
            .ToListAsync();
        return Ok(new { data = people });
    }

    private IQueryable<User> AssignableUsers(string departmentId) => db.Users
        .Include(u => u.Employee)
        .Where(u => u.IsActive && u.Employee != null && u.Employee.RemovedAt == null &&
                    u.Employee.DepartmentId == departmentId);

    // --- Lists ---------------------------------------------------------------

    /// <summary>?scope=mine (raised by me) | desk (everything the desk raised —
    /// desk Manager/Admin) | team (sent to my department) | all (Admin).
    /// ?status= narrows to one status.</summary>
    [HttpGet("/tickets")]
    public async Task<IActionResult> List()
    {
        var access = await LoadAccessAsync();
        var scope = Request.Query["scope"].ToString();
        var query = TicketsWithIncludes();
        switch (scope)
        {
            case "mine":
                query = query.Where(t => t.RaisedByUserId == access.Viewer.UserId);
                break;
            case "desk" when access.DeskManager || access.IsAdmin:
                var deskUsers = DeskUserIds();
                query = query.Where(t => deskUsers.Contains(t.RaisedByUserId));
                break;
            case "team" when access.DepartmentId is not null:
                query = query.Where(t => t.DepartmentId == access.DepartmentId);
                break;
            case "all" when access.IsAdmin:
                break;
            default:
                return Error("invalid_scope", "You can't list tickets that way.", 403, "scope",
                    "Use scope=mine for tickets you raised, or scope=team for your department's queue.");
        }
        var status = Request.Query["status"].ToString();
        if (TicketStatus.All.Contains(status)) query = query.Where(t => t.Status == status);
        var tickets = await query.OrderByDescending(t => t.UpdatedAt).Take(MaxListed).ToListAsync();
        return Ok(new { data = tickets.Select(t => t.ToDict()) });
    }

    /// <summary>One customer service agent's month (GET /tickets/stats).</summary>
    private sealed record AgentScore(
        string UserId, string Name, int Raised, int Resolved, int Successful,
        int Rejected, int Open, double? SuccessPct, double? SlaMetPct, int? AvgResolutionMinutes,
        double? CsatAvg, int CsatResponses)
    {
        public Dictionary<string, object?> ToDict() => new()
        {
            ["user_id"] = UserId,
            ["name"] = Name,
            ["raised"] = Raised,
            ["resolved"] = Resolved,
            ["successful"] = Successful,
            ["returned"] = Rejected,
            ["open"] = Open,
            ["success_pct"] = SuccessPct,
            ["sla_met_pct"] = SlaMetPct,
            ["avg_resolution_minutes"] = AvgResolutionMinutes,
            ["csat_avg"] = CsatAvg,
            ["csat_responses"] = CsatResponses,
        };
    }

    /// <summary>The customer service scorecard for ?month=YYYY-MM (default
    /// this month), per desk agent:
    /// - escalations: tickets they raised; successful = resolved without
    ///   ever being rejected; rejected and still open;
    /// - stars: customers' ratings of tickets they raised.
    /// SLA and time to resolve are shown alongside but don't decide success
    /// (they're mostly the handling team's doing).
    /// The desk Manager and Admin see every agent. An agent sees their own
    /// scorecard next to the team average and where they rank on each
    /// figure — never anyone else's numbers.</summary>
    [HttpGet("/tickets/stats")]
    public async Task<IActionResult> Stats()
    {
        var access = await LoadAccessAsync();
        if (!access.OnDesk && !access.IsAdmin)
        {
            return Error("not_on_desk", "The scorecard is for the customer service desk.", 403);
        }
        var month = Request.Query["month"].ToString();
        if (!DateTime.TryParseExact(month, "yyyy-MM", null, System.Globalization.DateTimeStyles.None, out var start))
        {
            var now = Clock.UtcNow();
            start = new DateTime(now.Year, now.Month, 1);
        }
        var end = start.AddMonths(1);

        // Everyone's figures are worked out (the team average and ranks need
        // them); only what the caller may see is returned.
        var agents = await db.Users.Include(u => u.Employee)
            .Where(u => u.IsActive && u.Employee != null && u.Employee.RemovedAt == null &&
                        u.Employee.Department != null && u.Employee.Department.HandlesCustomerService)
            .Select(u => new { u.UserId, Name = u.Employee!.FullName })
            .ToListAsync();
        var agentIds = agents.Select(a => a.UserId).ToList();

        // Raised in the month; resolved / rejected counted by when it
        // happened, so a ticket raised last month and resolved this month
        // scores this month.
        var raised = await db.Tickets.Where(t => agentIds.Contains(t.RaisedByUserId) && t.CreatedAt >= start && t.CreatedAt < end)
            .GroupBy(t => t.RaisedByUserId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
        var resolvedTickets = (await db.Tickets
                .Where(t => agentIds.Contains(t.RaisedByUserId) && t.ResolvedAt >= start && t.ResolvedAt < end)
                .Select(t => new { t.RaisedByUserId, t.CreatedAt, ResolvedAt = t.ResolvedAt!.Value, t.DueAt, t.ReturnCount })
                .ToListAsync())
            .GroupBy(t => t.RaisedByUserId).ToDictionary(g => g.Key, g => g.ToList());
        var rejected = await db.TicketEvents.Where(e => e.Kind == "returned" && e.CreatedAt >= start && e.CreatedAt < end)
            .Join(db.Tickets, e => e.TicketId, t => t.TicketId, (e, t) => t.RaisedByUserId)
            .Where(id => agentIds.Contains(id))
            .GroupBy(id => id).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
        var open = await db.Tickets.Where(t => agentIds.Contains(t.RaisedByUserId) && t.Status != TicketStatus.Resolved)
            .GroupBy(t => t.RaisedByUserId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
        var ratings = (await db.TicketFeedback
                .Where(f => f.Rating != null && f.RespondedAt >= start && f.RespondedAt < end &&
                            agentIds.Contains(f.Ticket!.RaisedByUserId))
                .Select(f => new { f.Ticket!.RaisedByUserId, Rating = f.Rating!.Value })
                .ToListAsync())
            .GroupBy(f => f.RaisedByUserId)
            .ToDictionary(g => g.Key, g => g.Select(f => f.Rating).ToList());

        var scores = agents.Select(a =>
        {
            var done = resolvedTickets.GetValueOrDefault(a.UserId) ?? [];
            var successful = done.Count(t => t.ReturnCount == 0);
            var stars = ratings.GetValueOrDefault(a.UserId) ?? [];
            return new AgentScore(
                a.UserId, a.Name, raised.GetValueOrDefault(a.UserId),
                done.Count, successful, rejected.GetValueOrDefault(a.UserId), open.GetValueOrDefault(a.UserId),
                done.Count == 0 ? null : Math.Round(100.0 * successful / done.Count, 1),
                done.Count == 0 ? null : Math.Round(100.0 * done.Count(t => t.ResolvedAt <= t.DueAt) / done.Count, 1),
                done.Count == 0 ? null : (int)Math.Round(done.Average(t => (t.ResolvedAt - t.CreatedAt).TotalMinutes)),
                stars.Count == 0 ? null : Math.Round(stars.Average(), 2), stars.Count);
        }).ToList();

        // The team average per agent (over everyone on the desk), and — for
        // the caller — their place on each figure (1 = best; ties share).
        double? Avg(Func<AgentScore, double?> pick)
        {
            var values = scores.Select(pick).Where(v => v is not null).Select(v => v!.Value).ToList();
            return values.Count == 0 ? null : Math.Round(values.Average(), 1);
        }
        var team = new
        {
            agents = scores.Count,
            raised = Avg(x => x.Raised),
            successful = Avg(x => x.Successful),
            success_pct = Avg(x => x.SuccessPct),
            csat_avg = Avg(x => x.CsatAvg),
        };
        int? Rank(AgentScore me, Func<AgentScore, double?> pick) =>
            pick(me) is { } mine ? 1 + scores.Count(x => pick(x) > mine) : null;
        var me = scores.FirstOrDefault(x => x.UserId == access.Viewer.UserId);
        var myRanks = me is null ? null : new
        {
            successful = Rank(me, x => x.Successful),
            success_pct = Rank(me, x => x.SuccessPct),
            csat_avg = Rank(me, x => x.CsatAvg),
        };

        var visible = access.DeskManager || access.IsAdmin
            ? scores
                // Agents with nothing at all this month only clutter the table.
                .Where(x => x.Raised + x.Resolved + x.Rejected + x.Open > 0 || x.UserId == access.Viewer.UserId)
                .OrderByDescending(x => x.Successful).ThenByDescending(x => x.Raised).ThenBy(x => x.Name)
                .ToList()
            : scores.Where(x => x.UserId == access.Viewer.UserId).ToList();
        return Ok(new
        {
            data = new
            {
                month = start.ToString("yyyy-MM"),
                agents = visible.Select(x => x.ToDict()),
                team,
                me = me is null ? null : new { ranks = myRanks },
            },
        });
    }

    // --- SLA report ------------------------------------------------------------

    private sealed record SlaRow(int Resolved, int Met, int Missed, double? CompliancePct, int? AvgResolutionMinutes);

    private static SlaRow Summarise(IReadOnlyCollection<Ticket> resolved)
    {
        var met = resolved.Count(t => t.ResolvedAt <= t.DueAt);
        return new SlaRow(
            resolved.Count,
            met,
            resolved.Count - met,
            resolved.Count == 0 ? null : Math.Round(100.0 * met / resolved.Count, 1),
            resolved.Count == 0 ? null : (int)Math.Round(resolved.Average(t => t.ResolutionMinutes()!.Value)));
    }

    private static Dictionary<string, object?> RowDict(SlaRow row) => new()
    {
        ["resolved"] = row.Resolved,
        ["met"] = row.Met,
        ["missed"] = row.Missed,
        ["compliance_pct"] = row.CompliancePct,
        ["avg_resolution_minutes"] = row.AvgResolutionMinutes,
    };

    /// <summary>How the organisation did against the SLA for ?month=YYYY-MM
    /// (default this month): tickets resolved that month, met vs missed,
    /// overall, per priority, per handling department and per person who
    /// resolved them, plus every ticket still open past its deadline. The
    /// figures are everyone's to see; the ticket rows only the ones the
    /// caller could open anyway.</summary>
    [HttpGet("/tickets/sla")]
    public async Task<IActionResult> SlaReport()
    {
        var access = await LoadAccessAsync();
        var month = Request.Query["month"].ToString();
        if (!DateTime.TryParseExact(month, "yyyy-MM", null, System.Globalization.DateTimeStyles.None, out var start))
        {
            var today = Clock.UtcNow();
            start = new DateTime(today.Year, today.Month, 1);
        }
        var end = start.AddMonths(1);
        var now = Clock.UtcNow();

        var resolved = await TicketsWithIncludes()
            .Where(t => t.Status == TicketStatus.Resolved && t.ResolvedAt >= start && t.ResolvedAt < end)
            .ToListAsync();
        var overdue = await TicketsWithIncludes()
            .Where(t => (t.Status == TicketStatus.Open || t.Status == TicketStatus.InProgress) && t.DueAt < now)
            .OrderBy(t => t.DueAt)
            .ToListAsync();
        var settings = await SettingsAsync();
        // Customer ratings answered this month, and how many were asked for.
        var answered = await db.TicketFeedback
            .Include(f => f.Ticket).ThenInclude(t => t!.Department)
            .Include(f => f.Ticket).ThenInclude(t => t!.ResolvedBy).ThenInclude(u => u!.Employee)
            .Where(f => f.Rating != null && f.RespondedAt >= start && f.RespondedAt < end)
            .ToListAsync();
        var asked = await db.TicketFeedback.CountAsync(f => f.SentAt >= start && f.SentAt < end);
        double? AvgRating(IEnumerable<TicketFeedback> rows) =>
            rows.Any() ? Math.Round(rows.Average(f => f.Rating!.Value), 2) : null;

        var byPriority = TicketPriority.All.Select(p =>
        {
            var row = RowDict(Summarise(resolved.Where(t => t.Priority == p).ToList()));
            row["priority"] = p;
            row["target_hours"] = settings.SlaHoursFor(p);
            row["overdue_open"] = overdue.Count(t => t.Priority == p);
            return row;
        });
        var byDepartment = resolved.Select(t => t.DepartmentId).Concat(overdue.Select(t => t.DepartmentId)).Distinct()
            .Select(id =>
            {
                var mine = resolved.Where(t => t.DepartmentId == id).ToList();
                var row = RowDict(Summarise(mine));
                row["department_id"] = id;
                row["department_name"] = mine.Concat(overdue).First(t => t.DepartmentId == id).Department?.Name;
                row["overdue_open"] = overdue.Count(t => t.DepartmentId == id);
                var rated = answered.Where(f => f.Ticket!.DepartmentId == id).ToList();
                row["csat_avg"] = AvgRating(rated);
                row["csat_responses"] = rated.Count;
                return row;
            })
            .OrderBy(r => (double?)r["compliance_pct"] ?? 101).ThenBy(r => r["department_name"] as string);
        var byResolver = resolved.Where(t => t.ResolvedByUserId is not null).GroupBy(t => t.ResolvedByUserId!)
            .Select(g =>
            {
                var row = RowDict(Summarise(g.ToList()));
                var first = g.First();
                row["user_id"] = g.Key;
                row["name"] = first.ResolvedBy?.Employee?.FullName ?? first.ResolvedBy?.Email;
                row["department_name"] = first.Department?.Name;
                var rated = answered.Where(f => f.Ticket!.ResolvedByUserId == g.Key).ToList();
                row["csat_avg"] = AvgRating(rated);
                row["csat_responses"] = rated.Count;
                return row;
            })
            .OrderByDescending(r => (int)r["resolved"]!).ThenBy(r => r["name"] as string);

        var totals = RowDict(Summarise(resolved));
        totals["overdue_open"] = overdue.Count;
        var csat = new
        {
            asked,
            responses = answered.Count,
            average = AvgRating(answered),
            // Satisfied = rated 4 or 5, the usual CSAT %.
            satisfied_pct = answered.Count == 0 ? (double?)null
                : Math.Round(100.0 * answered.Count(f => f.Rating >= 4) / answered.Count, 1),
            distribution = Enumerable.Range(1, 5).Select(r => new { rating = r, count = answered.Count(f => f.Rating == r) }),
            // Comments only from tickets the caller could open anyway.
            recent = answered.Where(f => f.Comment != null && CanSee(access, f.Ticket!))
                .OrderByDescending(f => f.RespondedAt).Take(20)
                .Select(f => new
                {
                    ticket_id = f.TicketId,
                    number = Ticket.FormatNumber(f.Ticket!.Number),
                    department_name = f.Ticket.Department?.Name,
                    rating = f.Rating,
                    comment = f.Comment,
                    responded_at = UtcTime.Iso(f.RespondedAt!.Value),
                }),
        };
        return Ok(new
        {
            data = new
            {
                month = start.ToString("yyyy-MM"),
                targets = TargetsDict(settings),
                totals,
                by_priority = byPriority,
                by_department = byDepartment,
                by_resolver = byResolver,
                csat,
                resolved = resolved.Where(t => CanSee(access, t)).OrderByDescending(t => t.ResolvedAt)
                    .Take(MaxListed).Select(t => t.ToDict()),
                overdue = overdue.Where(t => CanSee(access, t)).Take(MaxListed).Select(t => t.ToDict()),
            },
        });
    }

    [HttpGet("/tickets/{ticketId}")]
    public async Task<IActionResult> Get(string ticketId)
    {
        var (ticket, _, problem) = await LoadVisibleTicketAsync(ticketId);
        if (problem is not null) return problem;
        var dict = ticket!.ToDict(includeEvents: true);
        var reads = await db.TicketReads.Include(r => r.User).ThenInclude(u => u!.Employee)
            .Where(r => r.TicketId == ticketId).ToListAsync();
        dict["reads"] = reads.Select(r => r.ToDict()).ToList();
        return Ok(new { data = dict });
    }

    /// <summary>The caller has read the conversation up to now (their page
    /// is open and in front of them). Tells the others on the ticket, so
    /// their messages turn to two blue ticks.</summary>
    [HttpPost("/tickets/{ticketId}/read")]
    public async Task<IActionResult> MarkRead(string ticketId)
    {
        var (ticket, access, problem) = await LoadVisibleTicketAsync(ticketId);
        if (problem is not null) return problem;
        // Up to the newest message, so a read never claims more than exists.
        var upTo = ticket!.Events.Count == 0 ? Clock.UtcNow() : ticket.Events.Max(e => e.CreatedAt);
        var row = await db.TicketReads.FindAsync(ticketId, access.Viewer.UserId);
        if (row is not null && row.LastReadAt >= upTo) return NoContent();
        if (row is null)
        {
            row = new TicketRead { TicketId = ticketId, UserId = access.Viewer.UserId };
            db.TicketReads.Add(row);
        }
        row.LastReadAt = upTo;
        await db.SaveChangesAsync();
        try
        {
            await hub.Clients.Group(TicketsHub.Group(ticketId)).SendAsync("read", new
            {
                ticket_id = ticketId,
                user_id = access.Viewer.UserId,
                name = access.Viewer.Employee?.FullName ?? access.Viewer.Email,
                read_at = UtcTime.Iso(upTo),
            });
        }
        catch (Exception exc)
        {
            logger.LogWarning(exc, "Couldn't broadcast a read on ticket {TicketId}", ticketId);
        }
        return NoContent();
    }

    // --- Raising -------------------------------------------------------------

    [HttpPost("/tickets")]
    public async Task<IActionResult> Create()
    {
        var access = await LoadAccessAsync();
        var data = await RequestBody.ReadJsonSilentAsync<CreateTicketRequest>(Request);
        var subject = Clean(data.Subject, 160);
        var description = Clean(data.Description, 4000);
        var customerName = Clean(data.CustomerName, 120);
        var customerPhone = Clean(data.CustomerPhone, 32);
        var customerEmail = Clean(data.CustomerEmail, 120);
        if (subject is null) return Error("validation_error", "Give the ticket a short subject.", 422, "subject");
        if (description is null) return Error("validation_error", "Describe what's needed.", 422, "description");
        // The desk's tickets are always for a customer; anyone else's are
        // only when they fill the customer in.
        var forCustomer = access.OnDesk || customerName is not null || customerPhone is not null || customerEmail is not null;
        if (forCustomer && customerName is null) return Error("validation_error", "Enter the customer's name.", 422, "customer_name");
        if (forCustomer && customerPhone is null && customerEmail is null)
        {
            return Error("validation_error", "Add a phone number or email so the team can reach the customer.", 422, "customer_phone");
        }
        if (customerEmail is not null)
        {
            try { customerEmail = Validators.RequireValidEmail(customerEmail); }
            catch (ValidationFailed exc) { return Error("validation_error", exc.Message, 422, "customer_email"); }
        }

        TicketCategory? category = null;
        string? customReason = null;
        string? departmentId;
        if (!string.IsNullOrEmpty(data.CategoryId))
        {
            category = await db.TicketCategories.FindAsync(data.CategoryId);
            if (category is null || !category.IsActive)
            {
                return Error("category_not_found", "Choose what the ticket is about.", 422, "category_id");
            }
            departmentId = category.DepartmentId;
        }
        else
        {
            customReason = Clean(data.CustomReason, 80);
            if (customReason is null)
            {
                return Error("validation_error", "Choose what the ticket is about, or write your own reason.", 422, "custom_reason");
            }
            if (string.IsNullOrEmpty(data.DepartmentId))
            {
                return Error("validation_error", "Choose the department to send it to.", 422, "department_id");
            }
            departmentId = null;
        }
        if (!string.IsNullOrEmpty(data.DepartmentId) && data.DepartmentId != departmentId)
        {
            if (await db.Departments.FindAsync(data.DepartmentId) is null)
            {
                return Error("department_not_found", "Department not found.", 404, "department_id");
            }
            departmentId = data.DepartmentId;
        }

        var priority = string.IsNullOrEmpty(data.Priority) ? TicketPriority.Medium : data.Priority.ToLowerInvariant();
        if (!TicketPriority.All.Contains(priority))
        {
            return Error("validation_error", "Priority is high, medium or low.", 422, "priority");
        }
        var raisedAt = Clock.UtcNow();
        DateTime dueAt;
        if (data.SlaHours is { } slaHours)
        {
            if (slaHours < 1 || slaHours > BillingConstants.SlaMaxHours)
            {
                return Error("validation_error", "Choose a deadline from 1 hour to 30 days.", 422, "sla_hours");
            }
            dueAt = raisedAt.AddHours(slaHours);
        }
        else if (!string.IsNullOrEmpty(data.DueAt))
        {
            if (!DateTime.TryParse(data.DueAt, null,
                    System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal,
                    out var parsed))
            {
                return Error("validation_error", "That deadline isn't a date and time.", 422, "due_at");
            }
            dueAt = DateTime.SpecifyKind(parsed, DateTimeKind.Unspecified);
            if (dueAt <= raisedAt.AddMinutes(5) || dueAt > raisedAt.AddHours(BillingConstants.SlaMaxHours))
            {
                return Error("validation_error", "Set a deadline from a few minutes to 30 days from now.", 422, "due_at");
            }
        }
        else
        {
            dueAt = raisedAt.AddHours((await SettingsAsync()).SlaHoursFor(priority));
        }

        User? assignee = null;
        if (!string.IsNullOrEmpty(data.AssignedToUserId))
        {
            assignee = await AssignableUsers(departmentId!).FirstOrDefaultAsync(u => u.UserId == data.AssignedToUserId);
            if (assignee is null)
            {
                return Error("assignee_not_found", "That person isn't in the department you're sending it to.", 422,
                    "assigned_to_user_id", "Pick someone from the list, or send it to the whole department.");
            }
        }

        var ticket = new Ticket
        {
            Subject = subject,
            Description = description,
            CustomerName = customerName,
            CustomerPhone = customerPhone,
            CustomerEmail = customerEmail,
            BookingReference = Clean(data.BookingReference, 16)?.ToUpperInvariant(),
            CategoryId = category?.CategoryId,
            CustomReason = customReason,
            DepartmentId = departmentId!,
            Priority = priority,
            CreatedAt = raisedAt,
            UpdatedAt = raisedAt,
            DueAt = dueAt,
            RaisedByUserId = access.Viewer.UserId,
        };
        db.Tickets.Add(ticket);
        AddEvent(ticket, access.Viewer, "raised");
        if (assignee is not null)
        {
            // Sent to one person: it's theirs from the start, as if they'd
            // taken it — their Manager can still cover, and returning it
            // hands it back to the raiser as usual.
            var now = Clock.UtcNow();
            ticket.Status = TicketStatus.InProgress;
            ticket.ClaimedByUserId = assignee.UserId;
            ticket.ClaimedAt = now;
            // A moment after "raised", so the history keeps its order.
            db.TicketEvents.Add(new TicketEvent
            {
                TicketId = ticket.TicketId, ActorUserId = access.Viewer.UserId, Kind = "assigned",
                Body = $"To {assignee.Employee!.FullName}.", CreatedAt = now.AddMilliseconds(1),
            });
        }
        await db.SaveChangesAsync();

        var saved = await TicketsWithIncludes().FirstAsync(t => t.TicketId == ticket.TicketId);
        var number = Ticket.FormatNumber(saved.Number);
        if (assignee is not null)
        {
            mail.SendMailSafe(assignee.Email, $"{number} assigned to you ({saved.Priority} priority): {saved.Subject}",
                $"{saved.RaisedBy?.Employee?.FullName ?? saved.RaisedBy?.Email} sent you a ticket.\n\n" +
                $"About: {saved.Category?.Name ?? saved.CustomReason}\n" +
                $"Priority: {saved.Priority}\nResolve by: {NairobiTime(saved.DueAt)}\n\n{saved.Description}\n\n" +
                "Open it from Team tickets to work it.");
        }
        await PushNewTicketAsync(saved, access.Viewer.UserId, access.Viewer.Employee?.FullName);
        var sentTo = assignee is null
            ? saved.Department?.Name
            : $"{assignee.Employee!.FullName} in {saved.Department?.Name}";
        return StatusCode(201, new { data = saved.ToDict(), message = $"{number} sent to {sentTo}." });
    }

    // --- Working it ----------------------------------------------------------

    [HttpPost("/tickets/{ticketId}/claim")]
    public async Task<IActionResult> Claim(string ticketId)
    {
        var (ticket, access, problem) = await LoadVisibleTicketAsync(ticketId);
        if (problem is not null) return problem;
        if (!OnHandlingTeam(access, ticket!))
        {
            return Error("not_handling_team", $"Only {ticket!.Department?.Name} can take this ticket.", 403);
        }
        // Conditional update, so two people claiming at once can't both win.
        var now = Clock.UtcNow();
        var claimed = await db.Tickets
            .Where(t => t.TicketId == ticketId && t.Status == TicketStatus.Open)
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.Status, TicketStatus.InProgress)
                .SetProperty(t => t.ClaimedByUserId, access.Viewer.UserId)
                .SetProperty(t => t.ClaimedAt, now)
                .SetProperty(t => t.UpdatedAt, now));
        if (claimed == 0)
        {
            return Error("ticket_not_open", "Someone has already taken this ticket, or it's no longer open.", 409, "status",
                "Refresh to see who has it.");
        }
        db.TicketEvents.Add(new TicketEvent { TicketId = ticketId, ActorUserId = access.Viewer.UserId, Kind = "claimed" });
        await db.SaveChangesAsync();
        await BroadcastChangedAsync(ticketId);
        // The update went straight to the database, so drop the copy loaded
        // above or the response would still say "open".
        db.ChangeTracker.Clear();
        return Ok(new { data = (await TicketsWithIncludes().FirstAsync(t => t.TicketId == ticketId)).ToDict() });
    }

    [HttpPost("/tickets/{ticketId}/notes")]
    public async Task<IActionResult> AddNote(string ticketId)
    {
        var (ticket, access, problem) = await LoadVisibleTicketAsync(ticketId);
        if (problem is not null) return problem;
        var data = await RequestBody.ReadJsonSilentAsync<TicketNoteRequest>(Request);
        var body = Clean(data.Body, 4000);
        if (body is null) return Error("validation_error", "Write the note first.", 422, "body");
        AddEvent(ticket!, access.Viewer, "note", body);
        await db.SaveChangesAsync();
        await BroadcastChangedAsync(ticketId);
        await PushMessageAsync(ticket!, access.Viewer, body);
        return StatusCode(201, new { data = new { ticket_id = ticketId } });
    }

    [HttpPost("/tickets/{ticketId}/resolve")]
    public async Task<IActionResult> Resolve(string ticketId)
    {
        var (ticket, access, problem) = await LoadVisibleTicketAsync(ticketId);
        if (problem is not null) return problem;
        if (ticket!.Status is TicketStatus.Resolved or TicketStatus.Returned)
        {
            return Error("ticket_not_active", "Only an open or in-progress ticket can be resolved.", 409, "status");
        }
        // An unclaimed ticket is claimed by whoever resolves it.
        if (ticket.Status == TicketStatus.Open && OnHandlingTeam(access, ticket))
        {
            ticket.ClaimedByUserId = access.Viewer.UserId;
            ticket.ClaimedAt = Clock.UtcNow();
        }
        if (!CanClose(access, ticket))
        {
            return Error("not_ticket_owner", "Only the person working this ticket, or their Manager, can resolve it.", 403);
        }
        var data = await RequestBody.ReadJsonSilentAsync<ResolveTicketRequest>(Request);
        var note = Clean(data.ResolutionNote, 4000);
        if (note is null)
        {
            return Error("validation_error", "Say how it was resolved — the desk and the customer rely on it.", 422, "resolution_note");
        }
        ticket.Status = TicketStatus.Resolved;
        ticket.ResolvedByUserId = access.Viewer.UserId;
        ticket.ResolvedAt = Clock.UtcNow();
        ticket.ResolutionNote = note;
        AddEvent(ticket, access.Viewer, "resolved", note);
        await db.SaveChangesAsync();
        await BroadcastChangedAsync(ticketId);
        if (ticket.RaisedBy is not null)
        {
            mail.SendMailSafe(ticket.RaisedBy.Email, $"{Ticket.FormatNumber(ticket.Number)} resolved: {ticket.Subject}",
                $"{ticket.Department?.Name} resolved the ticket you raised{(ticket.CustomerName is null ? "" : $" for {ticket.CustomerName}")}.\n\nResolution:\n{note}");
        }
        await SendFeedbackRequestAsync(ticket);
        var saved = await TicketsWithIncludes().FirstAsync(t => t.TicketId == ticketId);
        return Ok(new { data = saved.ToDict() });
    }

    [HttpPost("/tickets/{ticketId}/return")]
    public async Task<IActionResult> Return(string ticketId)
    {
        var (ticket, access, problem) = await LoadVisibleTicketAsync(ticketId);
        if (problem is not null) return problem;
        if (ticket!.Status is TicketStatus.Resolved or TicketStatus.Returned)
        {
            return Error("ticket_not_active", "Only an open or in-progress ticket can be rejected.", 409, "status");
        }
        var canReturn = ticket.Status == TicketStatus.Open ? OnHandlingTeam(access, ticket) : CanClose(access, ticket);
        if (!canReturn)
        {
            return Error("not_ticket_owner", "Only the person working this ticket, or their Manager, can reject it.", 403);
        }
        var data = await RequestBody.ReadJsonSilentAsync<ReturnTicketRequest>(Request);
        if (data.ReasonCode is null || !TicketRejectReason.Labels.TryGetValue(data.ReasonCode, out var label))
        {
            return Error("validation_error",
                "Choose why: wrong department, a duplicate, or not a real issue. Ask for missing details in the chat instead.",
                422, "reason_code");
        }
        var note = Clean(data.Reason, 4000);
        var reason = note is null ? label : $"{label}: {note}";
        ticket.Status = TicketStatus.Returned;
        ticket.ClaimedByUserId = null;
        ticket.ClaimedAt = null;
        ticket.ReturnCount++;
        AddEvent(ticket, access.Viewer, "returned", reason);
        await db.SaveChangesAsync();
        await BroadcastChangedAsync(ticketId);
        if (ticket.RaisedBy is not null)
        {
            mail.SendMailSafe(ticket.RaisedBy.Email, $"{Ticket.FormatNumber(ticket.Number)} rejected: {ticket.Subject}",
                $"{ticket.Department?.Name} rejected the ticket you raised{(ticket.CustomerName is null ? "" : $" for {ticket.CustomerName}")}.\n\nReason:\n{reason}\n\n" +
                "Fix it and send it again from your tickets.");
        }
        var saved = await TicketsWithIncludes().FirstAsync(t => t.TicketId == ticketId);
        return Ok(new { data = saved.ToDict() });
    }

    /// <summary>Whoever is on a ticket (or their Manager) puts it back in
    /// their department's queue for anyone there to take — e.g. it was
    /// assigned to the wrong person, or they're going on leave.</summary>
    [HttpPost("/tickets/{ticketId}/release")]
    public async Task<IActionResult> Release(string ticketId)
    {
        var (ticket, access, problem) = await LoadVisibleTicketAsync(ticketId);
        if (problem is not null) return problem;
        if (ticket!.Status != TicketStatus.InProgress)
        {
            return Error("ticket_not_claimed", "Only a ticket someone is working can be handed back to the team.", 409, "status");
        }
        if (!CanClose(access, ticket))
        {
            return Error("not_ticket_owner", "Only the person working this ticket, or their Manager, can hand it back.", 403);
        }
        ticket.Status = TicketStatus.Open;
        ticket.ClaimedByUserId = null;
        ticket.ClaimedAt = null;
        AddEvent(ticket, access.Viewer, "released", null);
        await db.SaveChangesAsync();
        await BroadcastChangedAsync(ticketId);
        var saved = await TicketsWithIncludes().FirstAsync(t => t.TicketId == ticketId);
        return Ok(new { data = saved.ToDict() });
    }

    /// <summary>The desk sends a rejected ticket again — optionally to a
    /// different category/department, with a note on what changed.</summary>
    [HttpPost("/tickets/{ticketId}/resend")]
    public async Task<IActionResult> Resend(string ticketId)
    {
        var (ticket, access, problem) = await LoadVisibleTicketAsync(ticketId);
        if (problem is not null) return problem;
        if (ticket!.RaisedByUserId != access.Viewer.UserId && !access.DeskManager && !access.IsAdmin)
        {
            return Error("not_ticket_owner", "Only the person who raised this ticket, or the desk Manager, can send it again.", 403);
        }
        if (ticket.Status != TicketStatus.Returned)
        {
            return Error("ticket_not_returned", "Only a returned ticket can be sent again.", 409, "status");
        }
        var data = await RequestBody.ReadJsonSilentAsync<ResendTicketRequest>(Request);
        if (!string.IsNullOrEmpty(data.CategoryId) && data.CategoryId != ticket.CategoryId)
        {
            var category = await db.TicketCategories.FindAsync(data.CategoryId);
            if (category is null || !category.IsActive)
            {
                return Error("category_not_found", "Choose what the ticket is about.", 422, "category_id");
            }
            ticket.CategoryId = category.CategoryId;
            ticket.CustomReason = null;
            ticket.DepartmentId = category.DepartmentId;
        }
        else if (string.IsNullOrEmpty(data.CategoryId) && Clean(data.CustomReason, 80) is { } customReason)
        {
            ticket.CategoryId = null;
            ticket.CustomReason = customReason;
        }
        if (!string.IsNullOrEmpty(data.DepartmentId) && data.DepartmentId != ticket.DepartmentId)
        {
            if (await db.Departments.FindAsync(data.DepartmentId) is null)
            {
                return Error("department_not_found", "Department not found.", 404, "department_id");
            }
            ticket.DepartmentId = data.DepartmentId;
        }
        // The SLA clock stood still while it was back with the raiser.
        var returnedAt = ticket.Events.Where(e => e.Kind == "returned").Max(e => (DateTime?)e.CreatedAt);
        if (returnedAt is not null) ticket.DueAt += Clock.UtcNow() - returnedAt.Value;
        ticket.Status = TicketStatus.Open;
        AddEvent(ticket, access.Viewer, "resent", Clean(data.Note, 4000));
        await db.SaveChangesAsync();
        await BroadcastChangedAsync(ticketId);
        var saved = await TicketsWithIncludes().FirstAsync(t => t.TicketId == ticketId);
        // Sent again — possibly to a different department that's never seen
        // it — so it's a new ticket in that team's queue.
        await PushNewTicketAsync(saved, access.Viewer.UserId, access.Viewer.Employee?.FullName);
        return Ok(new { data = saved.ToDict() });
    }

    // --- Customer satisfaction (CSAT) -------------------------------------------

    /// <summary>One email to the customer when their ticket is resolved,
    /// saying so, with five stars inside it to rate us — one tap, like a
    /// ride-hailing receipt. Each star opens a small page the API serves
    /// (FeedbackController), never the app. Only for customer tickets with an
    /// email, and only once per ticket — no reminders.</summary>
    private async Task SendFeedbackRequestAsync(Ticket ticket)
    {
        if (string.IsNullOrWhiteSpace(ticket.CustomerEmail)) return;
        if (await db.TicketFeedback.AnyAsync(f => f.TicketId == ticket.TicketId)) return;

        var token = Security.GenerateResetToken();
        db.TicketFeedback.Add(new TicketFeedback
        {
            TicketId = ticket.TicketId,
            TokenHash = Security.HashToken(token),
            ExpiresAt = Clock.UtcNow().AddDays(FeedbackLinkDays),
        });
        await db.SaveChangesAsync();

        var page = $"{Config.PublicApiUrl}{FeedbackController.PagePath}?t={Uri.EscapeDataString(token)}";
        string Link(int r) => $"{page}&s={r}";
        var number = Ticket.FormatNumber(ticket.Number);
        var greeting = ticket.CustomerName is null ? "Hello," : $"Hello {ticket.CustomerName},";
        var team = ticket.Department?.Name is { } d ? $"our {d} team" : "our team";
        var labels = FeedbackController.Labels;

        var text =
            $"{greeting}\n\nGood news: your request {number} (\"{ticket.Subject}\") has been resolved by {team}.\n\n" +
            "How did we do? Tap a rating:\n\n" +
            string.Join("\n", Enumerable.Range(1, 5).Select(r => $"  {new string('*', r)} {labels[r - 1]}: {Link(r)}")) +
            $"\n\nIt takes one tap; you can add a comment after. Thank you for flying with us.\n\nCustomer Service";

        static string H(string? s) => System.Net.WebUtility.HtmlEncode(s ?? "");
        var starCells = string.Concat(Enumerable.Range(1, 5).Select(r => $"""
            <td align="center" style="padding:0 4px;">
              <a href="{H(Link(r))}" title="{r} — {H(labels[r - 1])}" style="text-decoration:none;color:#f5a623;font-size:40px;line-height:44px;display:block;">&#9733;</a>
              <span style="font-size:12px;color:#5d6878;">{r}</span>
            </td>
            """));
        var html = $"""
            <!doctype html>
            <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="margin:0;padding:0;background:#f6f7f9;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;">
            <tr><td align="center" style="padding:24px 16px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #d9dee5;border-radius:12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c2430;">
                <tr><td style="padding:24px 24px 8px;">
                  <p style="margin:0 0 4px;font-size:13px;color:#5d6878;">Request {H(number)}</p>
                  <h1 style="margin:0 0 12px;font-size:22px;">Your request is resolved</h1>
                  <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">{H(greeting)}</p>
                  <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Good news: your request &ldquo;{H(ticket.Subject)}&rdquo; has been resolved by {H(team)}.</p>
                </td></tr>
                <tr><td align="center" style="padding:8px 24px 4px;">
                  <p style="margin:0 0 8px;font-size:17px;font-weight:600;">How did we do?</p>
                  <table role="presentation" cellpadding="0" cellspacing="0"><tr>{starCells}</tr></table>
                  <p style="margin:8px 0 0;font-size:12px;color:#5d6878;">Tap a star &mdash; 1 is very poor, 5 is excellent. You can add a comment after.</p>
                </td></tr>
                <tr><td style="padding:16px 24px 24px;font-size:14px;line-height:1.5;color:#5d6878;">
                  Thank you for flying with us.<br>Customer Service
                </td></tr>
              </table>
            </td></tr></table>
            </body></html>
            """;
        mail.SendMailSafe(ticket.CustomerEmail!, $"Resolved: your request {number} — how did we do?", text, html);
    }
}
