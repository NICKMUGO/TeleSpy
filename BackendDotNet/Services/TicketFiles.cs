// Ticket attachments on disk: one folder per ticket under
// Config.AttachmentsDir, each file named by its attachment id (never the
// uploader's file name). Only files that really are what they claim to be
// are kept — the type is read from the first bytes, not trusted from the
// browser.
//
// A ticket's conversation (messages, files, read ticks) only lives while
// the ticket does: once it's resolved, withdrawn or closed it's all deleted
// to save space, leaving what the ticket was about, its history and the
// resolution note. PurgeConversationAsync does that, right away from
// TicketsController and as a sweep from TicketDeadlines.
using Microsoft.EntityFrameworkCore;
using TeleSpy.Core;
using TeleSpy.Models;

namespace TeleSpy.Services;

public static class TicketFiles
{
    public const long MaxBytes = 20 * 1024 * 1024;
    public const int MaxPerTicket = 5;

    /// <summary>What the chooser offers (the extensions accepted).</summary>
    public static readonly string[] Extensions =
        [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"];

    public static string PathFor(string ticketId, string attachmentId) =>
        Path.Combine(Config.AttachmentsDir, ticketId, attachmentId);

    /// <summary>The content type for a file named <paramref name="fileName"/>
    /// whose first bytes are <paramref name="head"/> — or null when it isn't
    /// an allowed type, or its contents don't match its extension.</summary>
    public static string? ContentTypeFor(string fileName, byte[] head)
    {
        bool Starts(params byte[] magic) => head.Length >= magic.Length && head.AsSpan(0, magic.Length).SequenceEqual(magic);
        bool At(int offset, string ascii) =>
            head.Length >= offset + ascii.Length &&
            head.AsSpan(offset, ascii.Length).SequenceEqual(System.Text.Encoding.ASCII.GetBytes(ascii));
        var zip = Starts(0x50, 0x4B, 0x03, 0x04);
        var ole = Starts(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1);
        return Path.GetExtension(fileName).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" when Starts(0xFF, 0xD8, 0xFF) => "image/jpeg",
            ".png" when Starts(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) => "image/png",
            ".gif" when At(0, "GIF8") => "image/gif",
            ".webp" when At(0, "RIFF") && At(8, "WEBP") => "image/webp",
            ".heic" when At(4, "ftyp") && (At(8, "heic") || At(8, "heix") || At(8, "mif1") || At(8, "msf1")) => "image/heic",
            ".pdf" when At(0, "%PDF-") => "application/pdf",
            ".docx" when zip => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xlsx" when zip => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".doc" when ole => "application/msword",
            ".xls" when ole => "application/vnd.ms-excel",
            ".csv" when IsText(head) => "text/csv",
            ".txt" when IsText(head) => "text/plain",
            _ => null,
        };
    }

    /// <summary>Plain text: no NUL bytes, mostly printable.</summary>
    private static bool IsText(byte[] head)
    {
        if (Array.IndexOf(head, (byte)0) >= 0) return false;
        var odd = 0;
        foreach (var b in head)
        {
            if (b < 0x09 || (b > 0x0D && b < 0x20 && b != 0x1B)) odd++;
        }
        return odd <= head.Length / 50;
    }

    /// <summary>Keeps just a name: no folders, control characters or
    /// anything a header could choke on, at most 120 characters.</summary>
    public static string CleanName(string fileName)
    {
        var name = Path.GetFileName(fileName.Replace('\\', '/'));
        name = new string(name.Where(c => !char.IsControl(c) && c is not ('"' or '/' or '\\')).ToArray()).Trim();
        if (name.Length > 120)
        {
            var ext = Path.GetExtension(name);
            name = name[..(120 - ext.Length)] + ext;
        }
        return name.Length == 0 ? "file" : name;
    }

    /// <summary>Deletes these tickets' conversations — messages, attachments
    /// (files and rows) and read ticks. Everything else stays. Files go
    /// first: a row left without its file just can't be downloaded, but a
    /// file left without its row would never be found again.</summary>
    public static async Task PurgeConversationAsync(TeleSpyDbContext db, IReadOnlyCollection<string> ticketIds,
        ILogger logger, CancellationToken cancellationToken = default)
    {
        if (ticketIds.Count == 0) return;
        foreach (var ticketId in ticketIds)
        {
            var folder = Path.Combine(Config.AttachmentsDir, ticketId);
            try
            {
                if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
            }
            catch (Exception exc) when (exc is IOException or UnauthorizedAccessException)
            {
                logger.LogWarning(exc, "Couldn't delete the attachments of ticket {TicketId}", ticketId);
            }
        }
        // Attachments go with their conversation entries (cascade).
        await db.TicketEvents
            .Where(e => ticketIds.Contains(e.TicketId) && (e.Kind == "note" || e.Kind == "attachment"))
            .ExecuteDeleteAsync(cancellationToken);
        await db.TicketAttachments.Where(a => ticketIds.Contains(a.TicketId)).ExecuteDeleteAsync(cancellationToken);
        await db.TicketReads.Where(r => ticketIds.Contains(r.TicketId)).ExecuteDeleteAsync(cancellationToken);
    }
}
