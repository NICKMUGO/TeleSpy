// Employees (HR records + their login): admin CRUD — an Admin creating an
// employee here is the only way an account comes to exist — manager read
// scoped to their own department, employee read limited to themselves.
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;
using TeleSpy.Services;

namespace TeleSpy.Api;

public class CreateEmployeeRequest
{
    public string? Email { get; set; }
    public string? Role { get; set; }
    public string? FullName { get; set; }
    public string? DepartmentId { get; set; }
    public string? StaffNumber { get; set; }
    public string? Extension { get; set; }
    // A new hire taking over a line someone holds: that person left, so
    // this must be "remove", with the reason and the Admin's step-up.
    public string? DisplacedHolder { get; set; }
    public string? RemovalReason { get; set; }
    public string? Password { get; set; }
    public string? Code { get; set; }
}

public class RemoveEmployeeRequest
{
    public string? RemovalReason { get; set; }
    // The employee's full name, typed out, so nobody is removed by a
    // misclick.
    public string? ConfirmName { get; set; }
    public string? Password { get; set; }
    public string? Code { get; set; }
}

[ApiController]
public class EmployeesController(
    TeleSpyDbContext db,
    IViewerContext viewerContext,
    IAuditService audit,
    IAllocationService allocationService,
    IPasswordResetService passwordReset,
    IStepUpService stepUp,
    ICacheService cache,
    IMailService mail) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

    private IQueryable<Employee> EmployeesWithIncludes() => db.Employees
        .Include(e => e.User).ThenInclude(u => u!.Role)
        .Include(e => e.Allocations).ThenInclude(a => a.Sim)
        .Include(e => e.UsageSummaries);

    /// <summary>Checks an extension an Admin wants to give an employee and
    /// finds the SIM that carries it, if one does. Returns the error
    /// response instead when the code is malformed or its SIM is out of
    /// service.</summary>
    private async Task<(SimCard? Sim, IActionResult? Problem)> ResolveExtensionAsync(string extension)
    {
        try
        {
            Validators.RequireValidExtension(extension);
        }
        catch (ValidationFailed exc)
        {
            return (null, StatusCode(422, new
            {
                error_type = "validation_error",
                message = exc.Message,
                field = "extension_code",
                hint = "Extension must be exactly 3 digits.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            }));
        }
        var extHash = Security.BlindIndex(extension);
        var sim = await db.SimCards.Include(s => s.Allocations).FirstOrDefaultAsync(s => s.MsisdnPbxHash == extHash);
        if (sim is not null && sim.LifecycleState != "active")
        {
            return (null, StatusCode(409, new
            {
                error_type = "sim_not_active",
                message = $"The SIM on extension {extension} is not active.",
                field = "extension_code",
                hint = $"That SIM's lifecycle_state is '{sim.LifecycleState}'; only an active SIM can be given to someone.",
                status = 409,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            }));
        }
        return (sim, null);
    }

    [HttpGet("/employees")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> Get()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var (page, limit) = Pagination.PaginateArgs(Request);
        // Removed employees (replaced on their line) are kept only for
        // their history, never listed.
        var query = EmployeesWithIncludes().Where(e => e.RemovedAt == null);

        if (viewer!.Role!.RoleName == TeleSpy.Role.Manager)
        {
            var deptId = viewerContext.ViewerDepartmentId(viewer);
            query = query.Where(e => e.DepartmentId == deptId);
        }
        var departmentIdFilter = Request.Query["department_id"].ToString();
        if (!string.IsNullOrEmpty(departmentIdFilter))
        {
            query = query.Where(e => e.DepartmentId == departmentIdFilter);
        }

        var total = await query.CountAsync();
        var rows = await query.OrderBy(e => e.FullName).ThenBy(e => e.EmployeeId).Skip((page - 1) * limit).Take(limit).ToListAsync();
        return Ok(new
        {
            data = rows.Select(e => e.ToDict(viewer)).ToList(),
            meta = Pagination.PaginateMeta(page, limit, total),
        });
    }

    /// <summary>GET /directory — the company phone directory: every
    /// employee who has an extension, with just their name, extension code
    /// and department. Open to every signed-in role (Employee included),
    /// and company-wide even for a Manager, so anyone can look up who is
    /// on an extension — nothing beyond those three fields is exposed.</summary>
    [HttpGet("/directory")]
    public async Task<IActionResult> Directory()
    {
        var rows = await db.Employees.Where(e => e.ExtensionCode != null && e.RemovedAt == null)
            .OrderBy(e => e.FullName).ThenBy(e => e.EmployeeId)
            .Select(e => new
            {
                id = e.EmployeeId,
                full_name = e.FullName,
                extension_code = e.ExtensionCode,
                department = e.Department != null ? e.Department.Name : null,
            })
            .ToListAsync();
        return Ok(new { data = rows });
    }

    [HttpPost("/employees")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Post()
    {
        var actor = await viewerContext.LoadedUserAsync();
        var data = await RequestBody.ReadJsonSilentAsync<CreateEmployeeRequest>(Request);

        string email;
        try
        {
            email = Validators.RequireValidEmail(data.Email);
        }
        catch (ValidationFailed exc)
        {
            return StatusCode(422, new
            {
                error_type = "validation_error",
                message = exc.Message,
                field = "email",
                hint = "Provide a valid email address, e.g. name@example.com.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var roleName = data.Role;
        var fullName = (data.FullName ?? "").Trim();
        var departmentId = data.DepartmentId;
        var staffNumber = data.StaffNumber;
        var extension = data.Extension;
        var stepUpVerified = false;

        if (roleName is null || !Constants.RoleSlugs.ContainsKey(roleName))
        {
            return StatusCode(422, new
            {
                error_type = "invalid_role",
                message = "Unknown role.",
                field = "role",
                hint = $"role must be one of: {string.Join(", ", Constants.RoleSlugs.Keys.OrderBy(r => r, StringComparer.Ordinal))}.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (fullName.Length == 0)
        {
            return StatusCode(422, new
            {
                error_type = "validation_error",
                message = "full_name is required.",
                field = "full_name",
                hint = "Include the employee's full name in the request body.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (await EmployeeNames.IsTakenAsync(db, fullName))
        {
            return StatusCode(409, EmployeeNames.DuplicateError(Request));
        }
        if (!string.IsNullOrEmpty(departmentId) && await db.Departments.FindAsync(departmentId) is null)
        {
            return StatusCode(404, new
            {
                error_type = "department_not_found",
                message = "Department not found.",
                field = "department_id",
                hint = $"No department exists with id '{departmentId}'. Check /departments for valid ids.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (await db.Users.AnyAsync(u => u.Email == email))
        {
            return StatusCode(409, new
            {
                error_type = "email_taken",
                message = "An account with that email already exists.",
                field = "email",
                hint = "Use a different email address for this employee.",
                status = 409,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (!string.IsNullOrEmpty(staffNumber) && await db.Employees.AnyAsync(e => e.StaffNumber == staffNumber))
        {
            return StatusCode(409, new
            {
                error_type = "duplicate_staff_number",
                message = "That staff number is already assigned.",
                field = "staff_number",
                hint = "Choose a staff number that isn't already in use.",
                status = 409,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        // Checked before anything is created, so a bad extension can't
        // leave a half-made account behind.
        SimCard? extensionSim = null;
        Handover? handover = null;
        if (!string.IsNullOrEmpty(extension))
        {
            var (sim, problem) = await ResolveExtensionAsync(extension);
            if (problem is not null) return problem;
            extensionSim = sim;

            // A held line goes to a new hire only as its holder's
            // replacement — confirmed, with a reason, before anyone is
            // created or removed.
            var held = sim?.GetCurrentAllocation() is not null ||
                       await db.Employees.AnyAsync(e => e.ExtensionCode == extension);
            if (held)
            {
                handover = Handover.Parse(data.DisplacedHolder, data.RemovalReason);
                if (handover?.Choice != DisplacedHolder.Remove)
                {
                    throw new LineRuleViolation("displaced_holder_required",
                        $"Extension {extension} is already held by someone.", "displaced_holder",
                        "A new hire takes over a held line only when its holder has left: send displaced_holder \"remove\" with a removal_reason and your step-up confirmation.");
                }
                EmployeeRemoval.RequireValidReason(handover.RemovalReason);
                await stepUp.VerifyAsync(actor!, data.Password, data.Code);
                stepUpVerified = true;
            }
        }
        // Adding an Admin hands the role over — the current Admin becomes
        // an Employee — so it takes the same step-up (once per request).
        var makingAdmin = roleName == TeleSpy.Role.Admin;
        if (makingAdmin && !stepUpVerified)
        {
            await stepUp.VerifyAsync(actor!, data.Password, data.Code);
        }

        await using var transaction = await db.Database.BeginTransactionAsync();

        var employee = new Employee { DepartmentId = departmentId, StaffNumber = staffNumber, FullName = fullName };
        db.Employees.Add(employee);
        await db.SaveChangesAsync();

        // The current Admin steps down before the new one is written —
        // never two at once.
        var formerAdmins = makingAdmin ? await StepDownAdminsAsync(exceptUserId: null) : [];

        // Never revealed; account starts via forced reset.
        var placeholderPassword = Security.GenerateResetToken();
        var user = new User
        {
            EmployeeId = employee.EmployeeId,
            Email = email,
            RoleId = Constants.RoleSlugs[roleName],
            IsActive = true,
            MustChangePassword = true,
        };
        user.SetPassword(placeholderPassword);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        db.PasswordHistories.Add(new PasswordHistory { UserId = user.UserId, PasswordHashValue = user.PasswordHash, CreatedAt = Clock.UtcNow() });
        await db.SaveChangesAsync();
        employee.User = user;
        await db.Entry(user).Reference(u => u.Role).LoadAsync();

        if (extensionSim is not null)
        {
            await allocationService.AllocateSimAsync(extensionSim, employee, actor!, handover);
            await db.Entry(employee).Collection(e => e.Allocations).LoadAsync();
        }
        else if (!string.IsNullOrEmpty(extension))
        {
            await allocationService.AssignExtensionCodeAsync(extension, employee, actor!, handover);
        }
        var replacedManagers = roleName == TeleSpy.Role.Manager ? await ReplaceDepartmentManagerAsync(employee) : [];
        await transaction.CommitAsync();

        await passwordReset.IssuePasswordResetAsync(user, newAccount: true);
        await audit.RecordAuditAsync("employee_created", "employee", employee.EmployeeId, actorId: actor!.UserId, actorRole: actor.Role?.RoleName);
        await AuditManagerReplacementsAsync(employee, replacedManagers);
        foreach (var replaced in replacedManagers)
        {
            if (replaced.User is not null) await cache.ClearActiveSessionAsync(replaced.User.UserId);
        }
        if (makingAdmin)
        {
            await AnnounceAdminHandoverAsync(employee, formerAdmins, actor);
        }
        return StatusCode(201, new
        {
            data = employee.ToDict(actor),
            message = "Created.",
            replaced_managers = replacedManagers.Select(e => e.FullName),
            admin_handed_over = makingAdmin,
        });
    }

    [HttpGet("/employees/{employeeId}")]
    [RoleIdRequired("admin", "manager", "employee")]
    public async Task<IActionResult> GetById(string employeeId)
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var employee = await EmployeesWithIncludes().FirstOrDefaultAsync(e => e.EmployeeId == employeeId);
        if (employee is null)
        {
            return StatusCode(404, new
            {
                error_type = "employee_not_found",
                message = "Employee not found.",
                field = "employee_id",
                hint = $"No employee exists with id '{employeeId}'.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (viewer!.Role!.RoleName == TeleSpy.Role.Manager && viewerContext.ViewerDepartmentId(viewer) != employee.DepartmentId)
        {
            return StatusCode(404, new
            {
                error_type = "employee_not_found",
                message = "Employee not found.",
                field = "employee_id",
                hint = "Managers can only view employees in their own department.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (viewer.Role.RoleName == TeleSpy.Role.Employee && viewer.EmployeeId != employee.EmployeeId)
        {
            return StatusCode(404, new
            {
                error_type = "employee_not_found",
                message = "Employee not found.",
                field = "employee_id",
                hint = "Employees can only view their own record.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        return Ok(new { data = employee.ToDict(viewer) });
    }

    [HttpPatch("/employees/{employeeId}")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Patch(string employeeId)
    {
        var actor = await viewerContext.LoadedUserAsync();
        var employee = await EmployeesWithIncludes().FirstOrDefaultAsync(e => e.EmployeeId == employeeId);
        if (employee is null)
        {
            return StatusCode(404, new
            {
                error_type = "employee_not_found",
                message = "Employee not found.",
                field = "employee_id",
                hint = $"No employee exists with id '{employeeId}'.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        // A removed employee is history only — editing them (say, turning
        // their login back on) would bring back someone who was replaced.
        if (employee.RemovedAt is not null)
        {
            return StatusCode(409, new
            {
                error_type = "employee_removed",
                message = $"{employee.FullName} has been removed and can't be edited.",
                field = "employee_id",
                hint = "They were replaced on their line and are kept only for call and billing history. Add the person again as a new employee.",
                status = 409,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }

        var data = await RequestBody.ReadJsonSilentAsync<Dictionary<string, JsonElement>>(Request);
        // Only an edit to who manages what can unseat another Manager.
        var managementChanged = data.ContainsKey("role") || data.ContainsKey("department_id");

        if (data.TryGetValue("full_name", out var fullNameEl) && fullNameEl.ValueKind == JsonValueKind.String &&
            fullNameEl.GetString() is { Length: > 0 } fullNameVal)
        {
            if (await EmployeeNames.IsTakenAsync(db, fullNameVal, exceptEmployeeId: employee.EmployeeId))
            {
                return StatusCode(409, EmployeeNames.DuplicateError(Request));
            }
            employee.FullName = fullNameVal.Trim();
        }
        if (data.TryGetValue("staff_number", out var staffNumberEl) && staffNumberEl.ValueKind == JsonValueKind.String &&
            staffNumberEl.GetString() is { Length: > 0 } staffNumberVal)
        {
            var clash = await db.Employees.AnyAsync(e => e.StaffNumber == staffNumberVal && e.EmployeeId != employee.EmployeeId);
            if (clash)
            {
                return StatusCode(409, new
                {
                    error_type = "duplicate_staff_number",
                    message = "That staff number is already assigned.",
                    field = "staff_number",
                    hint = "Choose a staff number that isn't already in use.",
                    status = 409,
                    path = Request.Path.Value,
                    method = Request.Method,
                    timestamp = NowIso(),
                });
            }
            employee.StaffNumber = staffNumberVal;
        }
        if (data.TryGetValue("department_id", out var deptIdEl) && deptIdEl.ValueKind == JsonValueKind.String &&
            deptIdEl.GetString() is { Length: > 0 } deptIdVal)
        {
            if (await db.Departments.FindAsync(deptIdVal) is null)
            {
                return StatusCode(404, new
                {
                    error_type = "department_not_found",
                    message = "Department not found.",
                    field = "department_id",
                    hint = $"No department exists with id '{deptIdVal}'. Check /departments for valid ids.",
                    status = 404,
                    path = Request.Path.Value,
                    method = Request.Method,
                    timestamp = NowIso(),
                });
            }
            employee.DepartmentId = deptIdVal;
        }
        // Who answers on which extension. A code that a SIM carries moves
        // with that SIM (the line is handed over); null or "" gives the
        // employee's line up. Done last, after every other field has
        // validated.
        var changeExtension = data.TryGetValue("extension_code", out var extensionEl);
        var newExtension = changeExtension && extensionEl.ValueKind == JsonValueKind.String ? extensionEl.GetString()?.Trim() : null;
        SimCard? newExtensionSim = null;
        if (!string.IsNullOrEmpty(newExtension))
        {
            var (sim, problem) = await ResolveExtensionAsync(newExtension);
            if (problem is not null) return problem;
            newExtensionSim = sim;
        }

        // The sign-in email. Set aside here, acted on after the commit:
        // the old address is told, the person's current session ends, and
        // if they've never set a password (a seeded placeholder, or a link
        // that went to a mistyped address) the set-password link goes to
        // the new one.
        string? previousEmail = null;
        if (employee.User is not null &&
            data.TryGetValue("email", out var emailEl) && emailEl.ValueKind == JsonValueKind.String)
        {
            string newEmail;
            try
            {
                newEmail = Validators.RequireValidEmail(emailEl.GetString());
            }
            catch (ValidationFailed exc)
            {
                return StatusCode(422, new
                {
                    error_type = "validation_error",
                    message = exc.Message,
                    field = "email",
                    hint = "Provide a valid email address, e.g. name@example.com.",
                    status = 422,
                    path = Request.Path.Value,
                    method = Request.Method,
                    timestamp = NowIso(),
                });
            }
            if (newEmail != employee.User.Email)
            {
                if (await db.Users.AnyAsync(u => u.Email == newEmail && u.UserId != employee.User.UserId))
                {
                    return StatusCode(409, new
                    {
                        error_type = "email_taken",
                        message = "An account with that email already exists.",
                        field = "email",
                        hint = "Use a different email address for this employee.",
                        status = 409,
                        path = Request.Path.Value,
                        method = Request.Method,
                        timestamp = NowIso(),
                    });
                }
                previousEmail = employee.User.Email;
                employee.User.Email = newEmail;
            }
        }

        var promoteToAdmin = false;
        var roleChanged = false;
        if (employee.User is not null)
        {
            if (data.TryGetValue("role", out var roleEl) && roleEl.ValueKind == JsonValueKind.String &&
                roleEl.GetString() is { Length: > 0 } roleVal)
            {
                if (!Constants.RoleSlugs.ContainsKey(roleVal))
                {
                    return StatusCode(422, new
                    {
                        error_type = "invalid_role",
                        message = "Unknown role.",
                        field = "role",
                        hint = $"role must be one of: {string.Join(", ", Constants.RoleSlugs.Keys.OrderBy(r => r, StringComparer.Ordinal))}.",
                        status = 422,
                        path = Request.Path.Value,
                        method = Request.Method,
                        timestamp = NowIso(),
                    });
                }
                var newRoleId = Constants.RoleSlugs[roleVal];
                if (employee.User.RoleId == AdminRoleId && newRoleId != AdminRoleId)
                {
                    return StatusCode(409, AdminRequiredError());
                }
                if (newRoleId == AdminRoleId && employee.User.RoleId != AdminRoleId)
                {
                    // Applied inside the transaction below, after the
                    // current Admin steps down — never two at once.
                    promoteToAdmin = true;
                }
                else if (newRoleId != employee.User.RoleId)
                {
                    employee.User.RoleId = newRoleId;
                    roleChanged = true;
                }
            }
            if (data.TryGetValue("is_active", out var isActiveEl))
            {
                var active = isActiveEl.ValueKind == JsonValueKind.True ||
                    (isActiveEl.ValueKind == JsonValueKind.Number && isActiveEl.GetDouble() != 0) ||
                    (isActiveEl.ValueKind == JsonValueKind.String && isActiveEl.GetString() is { Length: > 0 });
                if (!active && employee.User.RoleId == AdminRoleId)
                {
                    return StatusCode(409, AdminRequiredError());
                }
                employee.User.IsActive = active;
            }
        }

        // Taking over a held line says what happens to its holder: "swap"
        // or "remove" (they left — needs a reason and the step-up).
        var handover = Handover.Parse(
            data.TryGetValue("displaced_holder", out var displacedEl) && displacedEl.ValueKind == JsonValueKind.String ? displacedEl.GetString() : null,
            data.TryGetValue("removal_reason", out var reasonEl) && reasonEl.ValueKind == JsonValueKind.String ? reasonEl.GetString() : null);
        // One step-up covers the request: handing over Admin and/or
        // removing a line's holder (the code works only once).
        if (promoteToAdmin || (changeExtension && handover?.Choice == DisplacedHolder.Remove))
        {
            await stepUp.VerifyAsync(actor!,
                data.TryGetValue("password", out var passwordEl) && passwordEl.ValueKind == JsonValueKind.String ? passwordEl.GetString() : null,
                data.TryGetValue("code", out var codeEl) && codeEl.ValueKind == JsonValueKind.String ? codeEl.GetString() : null);
        }

        // One transaction with the extension change below, so a handover
        // the line rules refuse (LineRuleViolation → 409) leaves the rest
        // of the edit unsaved too.
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.SaveChangesAsync();

        List<User> formerAdmins = [];
        if (promoteToAdmin)
        {
            formerAdmins = await StepDownAdminsAsync(exceptUserId: employee.User!.UserId);
            employee.User.RoleId = AdminRoleId;
            await db.SaveChangesAsync();
        }

        if (changeExtension)
        {
            if (newExtensionSim is not null)
            {
                await allocationService.AllocateSimAsync(newExtensionSim, employee, actor!, handover);
            }
            else if (!string.IsNullOrEmpty(newExtension))
            {
                await allocationService.AssignExtensionCodeAsync(newExtension, employee, actor!, handover);
            }
            else
            {
                foreach (var held in employee.Allocations.Where(a => a.EndAt == null && a.Sim is not null).ToList())
                {
                    await db.Entry(held.Sim!).Collection(s => s.Allocations).LoadAsync();
                    await allocationService.ReleaseSimAsync(held.Sim!, actor!);
                }
                employee.ExtensionCode = null;
                await db.SaveChangesAsync();
            }
        }
        var replacedManagers = managementChanged && employee.User?.RoleId == Constants.RoleSlugs[TeleSpy.Role.Manager]
            ? await ReplaceDepartmentManagerAsync(employee)
            : [];
        await transaction.CommitAsync();

        // Roles ride in the sign-in token, so anyone whose role just changed
        // is signed out to pick up the new one rather than keep the old.
        if ((roleChanged || promoteToAdmin) && employee.User is not null)
        {
            await cache.ClearActiveSessionAsync(employee.User.UserId);
        }
        foreach (var replaced in replacedManagers)
        {
            if (replaced.User is not null) await cache.ClearActiveSessionAsync(replaced.User.UserId);
        }
        if (promoteToAdmin)
        {
            await AnnounceAdminHandoverAsync(employee, formerAdmins, actor!);
        }

        if (previousEmail is not null && employee.User is not null)
        {
            await cache.ClearActiveSessionAsync(employee.User.UserId);
            mail.SendMailSafe(previousEmail, "Your TeleSpy sign-in email was changed",
                $"An administrator changed the email you sign in to TeleSpy with to {employee.User.Email}. " +
                "From now on, sign-in codes and password links go to that address.\n\n" +
                "If you didn't expect this, contact your TeleSpy administrator.");
            if (employee.User.MustChangePassword)
            {
                await passwordReset.IssuePasswordResetAsync(employee.User, newAccount: true);
            }
        }

        // Field names only — "email" in the list is the record of the change;
        // the addresses themselves stay out of the audit trail.
        await audit.RecordAuditAsync("employee_updated", "employee", employee.EmployeeId,
            meta: new Dictionary<string, object?> { ["fields"] = data.Keys.ToList() });
        await AuditManagerReplacementsAsync(employee, replacedManagers);
        return Ok(new
        {
            data = employee.ToDict(actor),
            replaced_managers = replacedManagers.Select(e => e.FullName),
            // The actor was the Admin and just handed it over: their
            // session is gone, so the client signs them out.
            admin_handed_over = promoteToAdmin,
        });
    }

    private static readonly string AdminRoleId = Constants.RoleSlugs[TeleSpy.Role.Admin];

    private object AdminRequiredError() => new
    {
        error_type = "admin_required",
        message = "TeleSpy always has exactly one Admin, so the Admin can't be demoted or deactivated.",
        field = "role",
        hint = "To hand over, edit the person who should take over and make them Admin. You then become an Employee.",
        status = 409,
        path = Request.Path.Value,
        method = Request.Method,
        timestamp = NowIso(),
    };

    /// <summary>One Admin at a time: makes every current Admin (normally
    /// just the one handing over) an Employee. Saves, but leaves committing
    /// to the caller's transaction; the caller then writes the new Admin.
    /// </summary>
    private async Task<List<User>> StepDownAdminsAsync(string? exceptUserId)
    {
        var admins = await db.Users.Include(u => u.Employee)
            .Where(u => u.RoleId == AdminRoleId && u.UserId != exceptUserId)
            .ToListAsync();
        foreach (var admin in admins) admin.RoleId = Constants.RoleSlugs[TeleSpy.Role.Employee];
        await db.SaveChangesAsync();
        return admins;
    }

    /// <summary>After a handover commits: signs the former Admin out (their
    /// token still says Admin), emails both people, and audits it.</summary>
    private async Task AnnounceAdminHandoverAsync(Employee newAdmin, List<User> formerAdmins, User actor)
    {
        foreach (var former in formerAdmins)
        {
            await cache.ClearActiveSessionAsync(former.UserId);
            mail.SendMailSafe(former.Email, "You are no longer the TeleSpy Admin",
                $"The Admin role was handed over to {newAdmin.FullName}. Your account is now an Employee account; " +
                "sign in again to continue.\n\nIf you didn't expect this, contact your HR manager.");
            await audit.RecordAuditAsync("admin_handed_over", "employee", newAdmin.EmployeeId,
                actorId: actor.UserId, actorRole: TeleSpy.Role.Admin,
                meta: new Dictionary<string, object?> { ["from_employee_id"] = former.EmployeeId, ["to_employee_id"] = newAdmin.EmployeeId });
        }
        if (newAdmin.User is not null)
        {
            mail.SendMailSafe(newAdmin.User.Email, "You are now the TeleSpy Admin",
                "You've been made the TeleSpy Admin. TeleSpy has one Admin at a time, so the previous Admin is now an Employee.\n\n" +
                "Sign in (or set your password from the link we sent, if this is a new account) to start.");
        }
    }

    /// <summary>One Manager per department: making someone a department's
    /// Manager makes whoever managed it before an Employee (so a seeded
    /// placeholder Manager steps aside for the real one). Returns the
    /// people who were stepped down; saves, but leaves committing to the
    /// caller's transaction.</summary>
    private async Task<List<Employee>> ReplaceDepartmentManagerAsync(Employee manager)
    {
        if (string.IsNullOrEmpty(manager.DepartmentId)) return [];
        var managerRoleId = Constants.RoleSlugs[TeleSpy.Role.Manager];
        var previous = await db.Employees.Include(e => e.User)
            .Where(e => e.DepartmentId == manager.DepartmentId && e.EmployeeId != manager.EmployeeId &&
                        e.RemovedAt == null && e.User != null && e.User.RoleId == managerRoleId)
            .ToListAsync();
        foreach (var e in previous) e.User!.RoleId = Constants.RoleSlugs[TeleSpy.Role.Employee];
        await db.SaveChangesAsync();
        return previous;
    }

    private async Task AuditManagerReplacementsAsync(Employee manager, List<Employee> replaced)
    {
        foreach (var e in replaced)
        {
            await audit.RecordAuditAsync("manager_replaced", "employee", e.EmployeeId,
                meta: new Dictionary<string, object?> { ["department_id"] = manager.DepartmentId, ["new_manager_id"] = manager.EmployeeId });
        }
    }

    /// <summary>Remove an employee who left the company. Their line goes back
    /// to the pool (calls on it are then reported to HR and the Admins
    /// until it's given to someone), their login is disabled and signed out, and they drop out
    /// of every list — their past calls and bills are kept. Needs a reason,
    /// their name typed out, and the Admin's step-up (password + the code
    /// from POST /auth/step-up). The HR manager and Admins are emailed.
    /// Admin only.</summary>
    [HttpPost("/employees/{employeeId}/remove")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Remove(string employeeId)
    {
        var actor = await viewerContext.LoadedUserAsync();
        var employee = await EmployeesWithIncludes().FirstOrDefaultAsync(e => e.EmployeeId == employeeId);
        if (employee is null)
        {
            return StatusCode(404, new
            {
                error_type = "employee_not_found",
                message = "Employee not found.",
                field = "employee_id",
                hint = $"No employee exists with id '{employeeId}'.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        var data = await RequestBody.ReadJsonSilentAsync<RemoveEmployeeRequest>(Request);
        if (!string.Equals((data.ConfirmName ?? "").Trim(), employee.FullName.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            return StatusCode(422, new
            {
                error_type = "confirm_name_mismatch",
                message = "The name you typed doesn't match this employee.",
                field = "confirm_name",
                hint = $"Type \"{employee.FullName}\" exactly to confirm.",
                status = 422,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        EmployeeRemoval.RequireValidReason(data.RemovalReason);
        await stepUp.VerifyAsync(actor!, data.Password, data.Code);

        await using var transaction = await db.Database.BeginTransactionAsync();
        await allocationService.RemoveEmployeeAsync(employee, data.RemovalReason, actor!);
        await transaction.CommitAsync();
        return Ok(new { data = employee.ToDict(actor), message = $"{employee.FullName} was removed." });
    }

    /// <summary>"Deactivate user account" (use-case diagram) — disables
    /// login, keeps the HR record and all history intact.</summary>
    [HttpDelete("/employees/{employeeId}")]
    [RoleIdRequired("admin")]
    public async Task<IActionResult> Delete(string employeeId)
    {
        var employee = await db.Employees.Include(e => e.User).FirstOrDefaultAsync(e => e.EmployeeId == employeeId);
        if (employee?.User is null)
        {
            return StatusCode(404, new
            {
                error_type = "employee_not_found",
                message = "Employee not found.",
                field = "employee_id",
                hint = $"No employee with a login exists for id '{employeeId}'.",
                status = 404,
                path = Request.Path.Value,
                method = Request.Method,
                timestamp = NowIso(),
            });
        }
        if (employee.User.RoleId == AdminRoleId)
        {
            return StatusCode(409, AdminRequiredError());
        }
        employee.User.IsActive = false;
        await db.SaveChangesAsync();
        await cache.ClearActiveSessionAsync(employee.User.UserId);
        await audit.RecordAuditAsync("employee_deactivated", "employee", employee.EmployeeId);
        return NoContent();
    }
}
