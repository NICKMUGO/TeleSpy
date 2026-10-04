// Unauthenticated service endpoints: index + health check — mirrors
// Backend/api/misc.py.
using Microsoft.AspNetCore.Mvc;

namespace TeleSpy.Api;

[ApiController]
public class MiscController : ControllerBase
{
    [HttpGet("/")]
    public IActionResult Index() => Ok(new
    {
        data = new { service = "TeleSpy API" },
        message = "WELCOME TO TELESPY",
    });

    [HttpGet("/health")]
    public IActionResult Health() => Ok(new { status = "ok" });
}
