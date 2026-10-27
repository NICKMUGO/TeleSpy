// Turns a refused rule into the usual api/ error shape the frontend can
// show: a failed step-up check (StepUpFailed) is a 403; a broken line rule
// is a 409 — from AllocationService (LineRuleViolation) or, as the last
// word when two requests race for the same person or line, from the
// database's one-line-per-person indexes (UX_sim_allocations_open_employee
// / _open_sim, see TeleSpyDbContext), which would otherwise be a bare 500.
using Microsoft.EntityFrameworkCore;
using TeleSpy.Services;

namespace TeleSpy.Core;

public class RuleViolationMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (StepUpFailed exc) when (!context.Response.HasStarted)
        {
            await WriteErrorAsync(context, 403, exc.ErrorType, exc.Message, exc.Field, exc.Hint);
        }
        catch (LineRuleViolation exc) when (!context.Response.HasStarted)
        {
            await WriteErrorAsync(context, 409, exc.ErrorType, exc.Message, exc.Field, exc.Hint);
        }
        catch (DbUpdateException exc) when (ConflictKind(exc) is { } kind && !context.Response.HasStarted)
        {
            await WriteErrorAsync(context, 409,
                kind == "employee" ? "employee_already_has_line" : "sim_already_held",
                kind == "employee"
                    ? "This employee already holds a line."
                    : "This SIM card is already held by someone.",
                kind == "employee" ? "employee_id" : "sim_id",
                "A person can hold only one extension and company number, and a SIM only one holder. " +
                "Someone else probably changed this line at the same time — refresh and try again.");
        }
    }

    private static async Task WriteErrorAsync(HttpContext context, int status, string errorType, string message, string field, string hint)
    {
        context.Response.Clear();
        context.Response.StatusCode = status;
        await context.Response.WriteAsJsonAsync(new
        {
            error_type = errorType,
            message,
            field,
            hint,
            status,
            path = context.Request.Path.Value,
            method = context.Request.Method,
            timestamp = DateTime.UtcNow.ToString("o"),
        });
    }

    /// <summary>"employee" or "sim" when the failure is one of the
    /// open-allocation unique indexes, else null. Postgres names the
    /// index; SQLite names the columns instead.</summary>
    private static string? ConflictKind(DbUpdateException exc)
    {
        var message = exc.InnerException?.Message ?? exc.Message;
        if (message.Contains("UX_sim_allocations_open_employee") ||
            message.Contains("sim_allocations.employee_id")) return "employee";
        if (message.Contains("UX_sim_allocations_open_sim") ||
            message.Contains("sim_allocations.sim_id")) return "sim";
        return null;
    }
}
