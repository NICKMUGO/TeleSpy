// `dotnet run -- --reencrypt`: moves every encrypted value in the database
// onto the current algorithm and key (FieldEncryption), so an old key can
// be retired after a rotation or an algorithm swapped out. Safe to run any
// time and to re-run: values already current are left alone, and each
// table is rewritten in one transaction.
using Microsoft.EntityFrameworkCore;

namespace TeleSpy.Core;

public static class ReEncrypt
{
    public static async Task RunAsync()
    {
        await using var db = DatabaseConfig.CreateStandaloneContext();
        var target = $"{FieldEncryption.CurrentCipher.AlgorithmId} / key {Config.FieldEncryptionKeyId}";
        Console.WriteLine($"Re-encrypting stored values to {target}…");

        // SIM cards hold their ciphertext in explicit *Enc columns.
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var changed = 0;
            foreach (var sim in await db.SimCards.ToListAsync())
            {
                changed += Rewrap(sim.IccidEnc, v => sim.IccidEnc = v);
                changed += Rewrap(sim.MsisdnEnc, v => sim.MsisdnEnc = v);
                changed += Rewrap(sim.MsisdnPbxEnc, v => sim.MsisdnPbxEnc = v);
            }
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            Console.WriteLine($"  SIM cards: {changed} value(s) re-encrypted.");
        }

        // Tickets encrypt through an EF value converter, so the entity holds
        // plaintext: marking the fields modified writes them out again with
        // the current algorithm and key. Every row is rewritten.
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var tickets = await db.Tickets.ToListAsync();
            foreach (var ticket in tickets)
            {
                var entry = db.Entry(ticket);
                entry.Property(t => t.CustomerName).IsModified = true;
                entry.Property(t => t.CustomerPhone).IsModified = ticket.CustomerPhone is not null;
                entry.Property(t => t.CustomerEmail).IsModified = ticket.CustomerEmail is not null;
                entry.Property(t => t.BookingReference).IsModified = ticket.BookingReference is not null;
            }
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            Console.WriteLine($"  Tickets: {tickets.Count} row(s) re-encrypted.");
        }
        Console.WriteLine("Done. Keys listed only in FIELD_ENCRYPTION_OLD_KEYS are no longer needed.");
    }

    private static int Rewrap(string? stored, Action<string> set)
    {
        if (string.IsNullOrEmpty(stored) || FieldEncryption.IsCurrent(stored)) return 0;
        set(FieldEncryption.Encrypt(FieldEncryption.Decrypt(stored)));
        return 1;
    }
}
