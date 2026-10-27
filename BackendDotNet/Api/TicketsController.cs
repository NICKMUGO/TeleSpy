// Tickets. Anyone can raise one for an issue another department has to
// handle — the customer service desk (a department with
// HandlesCustomerService) for customers' issues, anyone else for internal
// ones. It's about one of the quick categories (which picks the department)
// or a reason the raiser writes themselves (and then picks the department).
// It goes to the whole department by default, or straight to one person in
// it. That department claims it, and either resolves it with a note — a
// successful escalation for the agent who raised it — or returns it to the
// raiser to fix and send again. Calls never create tickets on their own.
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
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
    public string? Reason { get; set; }
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
    IAuditService audit,
    IMailService mail) : ControllerBase
{
    private const int MaxListed = 200;

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

    private bool CanSee(Access access, Ticket ticket) =>
        access.IsAdmin ||
        ticket.RaisedByUserId == access.Viewer.UserId ||
        ticket.DepartmentId == access.DepartmentId ||
        access.DeskManager;

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
        await audit.RecordAuditAsync("ticket_category_created", "ticket_category", category.CategoryId);
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
        await audit.RecordAuditAsync("ticket_category_updated", "ticket_category", category.CategoryId);
        return Ok(new { data = category.ToDict() });
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

    /// <summary>Escalation scores for ?month=YYYY-MM (default this month):
    /// per desk agent, tickets raised, resolved (successful escalations),
    /// returned to them, and still open. An agent sees their own row; the
    /// desk Manager and Admin see every agent's.</summary>
    [HttpGet("/tickets/stats")]
    public async Task<IActionResult> Stats()
    {
        var access = await LoadAccessAsync();
        if (!access.OnDesk && !access.IsAdmin)
        {
            return Error("not_on_desk", "Escalation scores are for the customer service desk.", 403);
        }
        var month = Request.Query["month"].ToString();
        if (!DateTime.TryParseExact(month, "yyyy-MM", null, System.Globalization.DateTimeStyles.None, out var start))
        {
            var now = Clock.UtcNow();
            start = new DateTime(now.Year, now.Month, 1);
        }
        var end = start.AddMonths(1);

        List<string> agentIds = access.DeskManager || access.IsAdmin
            ? await DeskUserIds().ToListAsync()
            : [access.Viewer.UserId];

        // Raised in the month; resolved / returned counted by when it
        // happened, so a ticket raised last month and resolved this month
        // scores this month.
        var raised = await db.Tickets.Where(t => agentIds.Contains(t.RaisedByUserId) && t.CreatedAt >= start && t.CreatedAt < end)
            .GroupBy(t => t.RaisedByUserId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
        var resolved = await db.Tickets.Where(t => agentIds.Contains(t.RaisedByUserId) && t.ResolvedAt >= start && t.ResolvedAt < end)
            .GroupBy(t => t.RaisedByUserId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
        var returned = await db.TicketEvents.Where(e => e.Kind == "returned" && e.CreatedAt >= start && e.CreatedAt < end)
            .Join(db.Tickets, e => e.TicketId, t => t.TicketId, (e, t) => t.RaisedByUserId)
            .Where(id => agentIds.Contains(id))
            .GroupBy(id => id).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
        var open = await db.Tickets.Where(t => agentIds.Contains(t.RaisedByUserId) && t.Status != TicketStatus.Resolved)
            .GroupBy(t => t.RaisedByUserId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);

        var agents = await db.Users.Include(u => u.Employee)
            .Where(u => agentIds.Contains(u.UserId))
            .Select(u => new { u.UserId, Name = u.Employee != null ? u.Employee.FullName : u.Email })
            .ToListAsync();
        var rows = agents
            .Select(a => new
            {
                user_id = a.UserId,
                name = a.Name,
                raised = raised.GetValueOrDefault(a.UserId),
                resolved = resolved.GetValueOrDefault(a.UserId),
                returned = returned.GetValueOrDefault(a.UserId),
                open = open.GetValueOrDefault(a.UserId),
            })
            // Agents with no ticket activity at all only clutter the table.
            .Where(r => r.user_id == access.Viewer.UserId || r.raised + r.resolved + r.returned + r.open > 0)
            .OrderByDescending(r => r.resolved).ThenBy(r => r.name)
            .ToList();
        return Ok(new { data = new { month = start.ToString("yyyy-MM"), agents = rows } });
    }

    [HttpGet("/tickets/{ticketId}")]
    public async Task<IActionResult> Get(string ticketId)
    {
        var (ticket, _, problem) = await LoadVisibleTicketAsync(ticketId);
        if (problem is not null) return problem;
        return Ok(new { data = ticket!.ToDict(includeEvents: true) });
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
        await audit.RecordAuditAsync("ticket_raised", "ticket", ticket.TicketId,
            meta: new Dictionary<string, object?>
            {
                ["department_id"] = departmentId,
                ["category_id"] = category?.CategoryId,
                ["assigned_to_user_id"] = assignee?.UserId,
            });

        var saved = await TicketsWithIncludes().FirstAsync(t => t.TicketId == ticket.TicketId);
        var number = Ticket.FormatNumber(saved.Number);
        if (assignee is not null)
        {
            mail.SendMailSafe(assignee.Email, $"{number} assigned to you: {saved.Subject}",
                $"{saved.RaisedBy?.Employee?.FullName ?? saved.RaisedBy?.Email} sent you a ticket.\n\n" +
                $"About: {saved.Category?.Name ?? saved.CustomReason}\n\n{saved.Description}\n\n" +
                "Open it from Team tickets to work it.");
        }
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
        await audit.RecordAuditAsync("ticket_resolved", "ticket", ticket.TicketId);
        if (ticket.RaisedBy is not null)
        {
            mail.SendMailSafe(ticket.RaisedBy.Email, $"{Ticket.FormatNumber(ticket.Number)} resolved: {ticket.Subject}",
                $"{ticket.Department?.Name} resolved the ticket you raised{(ticket.CustomerName is null ? "" : $" for {ticket.CustomerName}")}.\n\nResolution:\n{note}");
        }
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
            return Error("ticket_not_active", "Only an open or in-progress ticket can be returned.", 409, "status");
        }
        var canReturn = ticket.Status == TicketStatus.Open ? OnHandlingTeam(access, ticket) : CanClose(access, ticket);
        if (!canReturn)
        {
            return Error("not_ticket_owner", "Only the person working this ticket, or their Manager, can return it.", 403);
        }
        var data = await RequestBody.ReadJsonSilentAsync<ReturnTicketRequest>(Request);
        var reason = Clean(data.Reason, 4000);
        if (reason is null)
        {
            return Error("validation_error", "Tell the desk why — wrong department, or what's missing.", 422, "reason");
        }
        ticket.Status = TicketStatus.Returned;
        ticket.ClaimedByUserId = null;
        ticket.ClaimedAt = null;
        ticket.ReturnCount++;
        AddEvent(ticket, access.Viewer, "returned", reason);
        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("ticket_returned", "ticket", ticket.TicketId);
        if (ticket.RaisedBy is not null)
        {
            mail.SendMailSafe(ticket.RaisedBy.Email, $"{Ticket.FormatNumber(ticket.Number)} returned: {ticket.Subject}",
                $"{ticket.Department?.Name} sent back the ticket you raised{(ticket.CustomerName is null ? "" : $" for {ticket.CustomerName}")}.\n\nReason:\n{reason}\n\n" +
                "Fix it and send it again from your tickets.");
        }
        var saved = await TicketsWithIncludes().FirstAsync(t => t.TicketId == ticketId);
        return Ok(new { data = saved.ToDict() });
    }

    /// <summary>The desk sends a returned ticket again — optionally to a
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
        ticket.Status = TicketStatus.Open;
        AddEvent(ticket, access.Viewer, "resent", Clean(data.Note, 4000));
        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("ticket_resent", "ticket", ticket.TicketId,
            meta: new Dictionary<string, object?> { ["department_id"] = ticket.DepartmentId });
        var saved = await TicketsWithIncludes().FirstAsync(t => t.TicketId == ticketId);
        return Ok(new { data = saved.ToDict() });
    }
}
