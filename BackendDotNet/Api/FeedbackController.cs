// Customer satisfaction (CSAT): the customer's side. When a customer ticket
// is resolved the customer gets one email (TicketsController.
// SendFeedbackRequestAsync) saying so, with five stars in it. Each star is a
// link to GET /feedback/r — a small page this API serves itself, so the
// customer never reaches the company's app: no menu, no sign-in, no link
// into it, and nothing about the ticket beyond its number.
//
// Office mail scanners (Outlook Safe Links and the like) open every link in
// an email to check it. If opening a star recorded it, a scanner would
// "click" all five. So opening the page records nothing; the page's own
// script records the star the customer tapped (scanners don't run scripts),
// and without scripts it shows one "Send rating" button instead. The same
// page takes an optional comment.
//
// A rating can be changed until the link expires (a mis-tap on 2 when they
// meant 5 shouldn't stick), and is stored with no customer details. The
// link's token is the only credential; only its hash is stored.
using System.Net;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Api;

public class FeedbackSubmitRequest
{
    public string? Token { get; set; }
    public int? Rating { get; set; }
    public string? Comment { get; set; }
}

[ApiController]
public class FeedbackController(TeleSpyDbContext db) : ControllerBase
{
    public const string PagePath = "/feedback/r";
    private const int CommentMax = 1000;

    public static readonly string[] Labels = ["Very poor", "Poor", "Okay", "Good", "Excellent"];

    private async Task<TicketFeedback?> FindAsync(string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 200) return null;
        var hash = Security.HashToken(token.Trim());
        return await db.TicketFeedback.Include(f => f.Ticket)
            .FirstOrDefaultAsync(f => f.TokenHash == hash);
    }

    private static string? CleanComment(string? comment)
    {
        var trimmed = comment?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return trimmed.Length > CommentMax ? trimmed[..CommentMax] : trimmed;
    }

    /// <summary>Saves a rating (and comment, if one was sent). A comment on
    /// its own keeps the rating already given. Null when the link isn't
    /// valid any more, or there's no rating yet.</summary>
    private async Task<TicketFeedback?> SaveAsync(string? token, int? rating, string? comment, bool keepComment)
    {
        var feedback = await FindAsync(token);
        if (feedback is null || feedback.ExpiresAt < Clock.UtcNow()) return null;
        rating = rating is >= 1 and <= 5 ? rating : feedback.Rating;
        if (rating is null) return null;
        feedback.Rating = rating;
        // Tapping a star again shouldn't wipe a comment sent earlier.
        if (!keepComment || CleanComment(comment) is not null) feedback.Comment = CleanComment(comment);
        feedback.RespondedAt = Clock.UtcNow();
        await db.SaveChangesAsync();
        return feedback;
    }

    /// <summary>The page a star in the email opens. Records nothing by
    /// itself (see the top of this file).</summary>
    [HttpGet(PagePath)]
    public async Task<IActionResult> Page([FromQuery(Name = "t")] string? token, [FromQuery(Name = "s")] int? rating)
    {
        var feedback = await FindAsync(token);
        if (feedback is null) return Html(Shell("Link not valid", "<p>This rating link isn't valid. Check it was copied in full.</p>"), 404);
        if (feedback.ExpiresAt < Clock.UtcNow()) return Html(Shell("Link expired", "<p>This rating link has expired. Thank you all the same.</p>"), 410);
        var chosen = rating is >= 1 and <= 5 ? rating : feedback.Rating;
        return Html(RatingPage(feedback, token!, chosen, autoSave: rating is >= 1 and <= 5, saved: false));
    }

    /// <summary>The page's form: a star, a comment, or both (works without
    /// scripts too).</summary>
    [HttpPost(PagePath)]
    [Consumes("application/x-www-form-urlencoded")]
    public async Task<IActionResult> PageSubmit([FromForm(Name = "t")] string? token, [FromForm(Name = "s")] int? chosen,
        [FromForm(Name = "star")] int? tapped, [FromForm(Name = "comment")] string? comment)
    {
        // A star button sends "star"; the comment button sends the star
        // already chosen ("s").
        var feedback = await SaveAsync(token, tapped ?? chosen, comment, keepComment: tapped is not null);
        if (feedback is null)
        {
            var existing = await FindAsync(token);
            if (existing is not null && existing.ExpiresAt >= Clock.UtcNow())
            {
                return Html(RatingPage(existing, token!, null, autoSave: false, saved: false));
            }
            return Html(Shell("Link not valid", "<p>This rating link isn't valid or has expired.</p>"), 410);
        }
        return Html(RatingPage(feedback, token!, feedback.Rating, autoSave: false, saved: true));
    }

    /// <summary>The page's script: records the tapped star straight away.</summary>
    [HttpPost("/feedback")]
    public async Task<IActionResult> Submit()
    {
        var data = await RequestBody.ReadJsonSilentAsync<FeedbackSubmitRequest>(Request);
        var feedback = await SaveAsync(data.Token, data.Rating, data.Comment, keepComment: true);
        if (feedback is null)
        {
            return StatusCode(410, new { error_type = "feedback_unavailable", message = "This rating link isn't valid or has expired.", status = 410 });
        }
        return Ok(new { data = new { rating = feedback.Rating }, message = "Thank you for your feedback." });
    }

    // --- The page --------------------------------------------------------------

    private ContentResult Html(string html, int status = 200)
    {
        // A page for one customer's link: never cached, never indexed, and
        // the token never sent on to another site.
        Response.Headers.CacheControl = "no-store";
        Response.Headers["X-Robots-Tag"] = "noindex";
        Response.Headers["Referrer-Policy"] = "no-referrer";
        return new ContentResult { Content = html, ContentType = "text/html; charset=utf-8", StatusCode = status };
    }

    private static string E(string? s) => WebUtility.HtmlEncode(s ?? "");

    private static string RatingPage(TicketFeedback f, string token, int? chosen, bool autoSave, bool saved)
    {
        var number = Ticket.FormatNumber(f.Ticket!.Number);
        var stars = new StringBuilder();
        for (var r = 1; r <= 5; r++)
        {
            stars.Append($"""<button type="submit" name="star" value="{r}" class="star{(chosen >= r ? " on" : "")}" aria-label="{r} — {Labels[r - 1]}" aria-pressed="{(chosen == r ? "true" : "false")}">★</button>""");
        }
        var heading = saved || autoSave ? "Thank you!" : "How did we do?";
        var status = chosen is null
            ? "Tap a star to rate us."
            : $"You rated us {chosen} of 5 — {Labels[chosen.Value - 1]}.";
        var body = $"""
            <p class="muted">Request {E(number)}</p>
            <form method="post" action="r" id="f" data-labels="{E(System.Text.Json.JsonSerializer.Serialize(Labels))}" data-autosave="{(autoSave ? chosen : null)}">
              <input type="hidden" name="t" value="{E(token)}">
              <div class="stars" role="group" aria-label="Your rating">{stars}</div>
              <p id="status" role="status">{(saved ? "Saved. " : "")}{E(status)}</p>
              <noscript>{(autoSave ? """<p><button type="submit" class="send">Send my rating</button></p>""" : "")}</noscript>
              <label for="comment">Anything you'd like to tell us? (optional)</label>
              <textarea id="comment" name="comment" maxlength="{CommentMax}" rows="4">{E(f.Comment)}</textarea>
              <input type="hidden" name="s" id="s" value="{chosen}">
              <button type="submit" class="send" id="send">Send comment</button>
            </form>
            <p class="muted small">You can change your rating any time before this link expires.</p>
            <script>{Script}</script>
            """;
        return Shell(heading, body);
    }

    /// <summary>Records a tapped star straight away (see the top of this
    /// file for why it's a script and not the link itself).</summary>
    private const string Script = """
        (function () {
          var form = document.getElementById("f"), status = document.getElementById("status");
          var s = document.getElementById("s"), token = form.t.value;
          var labels = JSON.parse(form.dataset.labels);
          function show(r) {
            var stars = form.querySelectorAll(".star");
            for (var i = 0; i < stars.length; i++) {
              stars[i].classList.toggle("on", i < r);
              stars[i].setAttribute("aria-pressed", i === r - 1 ? "true" : "false");
            }
          }
          function save(r) {
            s.value = r; show(r);
            fetch("../feedback", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: token, rating: r }) })
              .then(function (res) {
                status.textContent = res.ok
                  ? "Thank you! You rated us " + r + " of 5 — " + labels[r - 1] + "."
                  : "This link isn't valid any more.";
              })
              .catch(function () { status.textContent = "Couldn't save that — check your connection and tap again."; });
          }
          form.addEventListener("click", function (e) {
            var b = e.target.closest && e.target.closest(".star");
            if (!b) return;
            e.preventDefault(); save(Number(b.value));
          });
          if (form.dataset.autosave) save(Number(form.dataset.autosave));
        })();
        """;

    private static string Shell(string heading, string body) => $$"""
        <!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex">
        <title>{{E(heading)}}</title>
        <style>
          :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --ink:#1c2430; --muted:#5d6878; --line:#d9dee5; --star:#d5dae1; --gold:#f5a623; --accent:#0b5cad; }
          @media (prefers-color-scheme: dark) { :root { --bg:#0f1318; --card:#181e26; --ink:#e8ecf1; --muted:#9aa6b5; --line:#2b3440; --star:#3a4452; --accent:#6aa9ec; } }
          * { box-sizing: border-box; }
          body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
          main { max-width:28rem; margin:2.5rem auto; padding:0 16px; }
          .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:1.5rem; }
          h1 { font-size:1.5rem; margin:0 0 .25rem; }
          .muted { color:var(--muted); margin:0 0 1rem; }
          .small { font-size:.875rem; margin:1rem 0 0; }
          .stars { display:flex; gap:.25rem; justify-content:center; margin:.5rem 0; }
          .star { font-size:2.75rem; line-height:1; background:none; border:0; padding:.25rem; cursor:pointer; color:var(--star); }
          .star.on { color:var(--gold); }
          .star:focus-visible, .send:focus-visible, textarea:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
          #status { text-align:center; min-height:1.5em; }
          label { display:block; margin:1rem 0 .375rem; font-weight:600; }
          textarea { width:100%; font:inherit; color:inherit; background:transparent; border:1px solid var(--line); border-radius:10px; padding:.625rem; }
          .send { margin-top:.75rem; font:inherit; font-weight:600; color:#fff; background:var(--accent); border:0; border-radius:10px; padding:.625rem 1rem; cursor:pointer; }
        </style>
        </head>
        <body><main><div class="card"><h1>{{E(heading)}}</h1>{{body}}</div></main></body>
        </html>
        """;
}
