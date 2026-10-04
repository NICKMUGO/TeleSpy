// Pagination helpers shared by every controller — mirrors Backend/core/responses.py's
// current state (its ok()/err() envelope helpers were removed there; response
// bodies are built inline at each call site instead, and the same is true here).
namespace TeleSpy.Core;

public record PageArgs(int Page, int Limit);

public static class Pagination
{
    public const int MaxPageSize = 100;
    public const int DefaultPageSize = 25;

    /// <summary>`?page=&amp;limit=` off the query string, clamped to sane bounds.</summary>
    public static PageArgs PaginateArgs(HttpRequest request)
    {
        var page = 1;
        if (int.TryParse(request.Query["page"], out var parsedPage))
        {
            page = Math.Max(1, parsedPage);
        }

        var limit = DefaultPageSize;
        if (int.TryParse(request.Query["limit"], out var parsedLimit))
        {
            limit = Math.Min(MaxPageSize, Math.Max(1, parsedLimit));
        }

        return new PageArgs(page, limit);
    }

    public static object PaginateMeta(int page, int limit, int total) => new
    {
        page,
        limit,
        total,
        pages = limit > 0 ? (total + limit - 1) / limit : 0,
    };
}
