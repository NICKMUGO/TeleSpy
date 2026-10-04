// Mirrors Flask's `request.get_json(silent=True) or {}` (see
// Backend/api/auth.py:58 and every other controller): on a missing, empty,
// or malformed JSON body, callers get a default-valued instance instead of
// the request throwing or ASP.NET Core's automatic [ApiController]
// model-validation 400. Controllers read the body with this helper instead
// of `[FromBody]` parameter binding, exactly so a bad body degrades the same
// way it does in Flask (falls through to normal field-level validation,
// which then reports a properly descriptive error) rather than short-circuiting
// with a generic framework error.
using System.Text.Json;

namespace TeleSpy.Core;

public static class RequestBody
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    public static async Task<T> ReadJsonSilentAsync<T>(HttpRequest request) where T : new()
    {
        try
        {
            if (request.ContentLength is null or 0) return new T();
            var result = await JsonSerializer.DeserializeAsync<T>(request.Body, JsonOptions);
            return result ?? new T();
        }
        catch (JsonException)
        {
            return new T();
        }
    }
}
