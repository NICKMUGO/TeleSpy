// Mirrors Backend/core/decorators.py's role_id_required()/role_required():
// restrict a controller action to specific roles, stacked on top of the
// global CurrentUserMiddleware auth check. Same 403 body shape as the
// Python decorators (outside api/, not part of the descriptive-errors
// refactor).
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace TeleSpy.Core;

public class RoleIdRequiredAttribute(params string[] allowedRoleIds) : Attribute, IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var currentUser = context.HttpContext.RequestServices.GetRequiredService<ICurrentUserAccessor>();
        if (!allowedRoleIds.Contains(currentUser.Current.RoleId))
        {
            context.Result = Forbidden();
            return;
        }
        await next();
    }

    internal static ObjectResult Forbidden() => new(new
    {
        error = "forbidden",
        message = "Your role does not have access to this resource.",
    })
    { StatusCode = StatusCodes.Status403Forbidden };
}

public class RoleRequiredAttribute(params string[] allowedRoles) : Attribute, IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var currentUser = context.HttpContext.RequestServices.GetRequiredService<ICurrentUserAccessor>();
        if (!allowedRoles.Contains(currentUser.Current.Role))
        {
            context.Result = RoleIdRequiredAttribute.Forbidden();
            return;
        }
        await next();
    }
}
