// Employees (HR records + their login): admin CRUD, manager read scoped to
// their own department, employee read limited to themselves. Mirrors
// Backend/api/employees.py 1:1.
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
}

[ApiController]
public class EmployeesController(
    TeleSpyDbContext db,
    IViewerContext viewerContext,
    IAuditService audit,
    IAllocationService allocationService,
    IPasswordResetService passwordReset) : ControllerBase
{
    private string NowIso() => DateTime.UtcNow.ToString("o");

    private IQueryable<Employee> EmployeesWithIncludes() => db.Employees
        .Include(e => e.User).ThenInclude(u => u!.Role)
        .Include(e => e.Allocations).ThenInclude(a => a.Sim)
        .Include(e => e.UsageSummaries);

    [HttpGet("/employees")]
    [RoleIdRequired("admin", "manager")]
    public async Task<IActionResult> Get()
    {
        var viewer = await viewerContext.LoadedUserAsync();
        var (page, limit) = Pagination.PaginateArgs(Request);
        var query = EmployeesWithIncludes();

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
        var rows = await db.Employees.Where(e => e.ExtensionCode != null)
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

        var employee = new Employee { DepartmentId = departmentId, StaffNumber = staffNumber, FullName = fullName };
        db.Employees.Add(employee);
        await db.SaveChangesAsync();

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

        if (!string.IsNullOrEmpty(extension))
        {
            try
            {
                Validators.RequireValidExtension(extension);
            }
            catch (ValidationFailed exc)
            {
                return StatusCode(422, new
                {
                    error_type = "validation_error",
                    message = exc.Message,
                    field = "extension",
                    hint = "Extension must be exactly 3 digits.",
                    status = 422,
                    path = Request.Path.Value,
                    method = Request.Method,
                    timestamp = NowIso(),
                });
            }
            var extHash = Security.BlindIndex(extension);
            var sim = await db.SimCards.Include(s => s.Allocations).FirstOrDefaultAsync(s => s.MsisdnPbxHash == extHash);
            if (sim is null)
            {
                return StatusCode(404, new
                {
                    error_type = "extension_not_found",
                    message = "No SIM found with that extension to allocate.",
                    field = "extension",
                    hint = "Register a SIM with this extension before assigning it to an employee.",
                    status = 404,
                    path = Request.Path.Value,
                    method = Request.Method,
                    timestamp = NowIso(),
                });
            }
            await allocationService.AllocateSimAsync(sim, employee, actor!);
            await db.Entry(employee).Collection(e => e.Allocations).LoadAsync();
            foreach (var a in employee.Allocations) await db.Entry(a).Reference(x => x.Sim).LoadAsync();
        }

        await passwordReset.IssuePasswordResetAsync(user);
        await audit.RecordAuditAsync("employee_created", "employee", employee.EmployeeId, actorId: actor!.UserId, actorRole: actor.Role?.RoleName);
        return StatusCode(201, new { data = employee.ToDict(actor), message = "Created." });
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

        var data = await RequestBody.ReadJsonSilentAsync<Dictionary<string, JsonElement>>(Request);

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
                employee.User.RoleId = Constants.RoleSlugs[roleVal];
            }
            if (data.TryGetValue("is_active", out var isActiveEl))
            {
                employee.User.IsActive = isActiveEl.ValueKind == JsonValueKind.True ||
                    (isActiveEl.ValueKind == JsonValueKind.Number && isActiveEl.GetDouble() != 0) ||
                    (isActiveEl.ValueKind == JsonValueKind.String && isActiveEl.GetString() is { Length: > 0 });
            }
        }

        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("employee_updated", "employee", employee.EmployeeId,
            meta: new Dictionary<string, object?> { ["fields"] = data.Keys.ToList() });
        return Ok(new { data = employee.ToDict(actor) });
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
        employee.User.IsActive = false;
        await db.SaveChangesAsync();
        await audit.RecordAuditAsync("employee_deactivated", "employee", employee.EmployeeId);
        return NoContent();
    }
}
