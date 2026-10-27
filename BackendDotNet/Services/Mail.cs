// Outbound email helper — mirrors Backend/services/mail.py. SendMailSafe is
// the only way controller code sends mail: it honours MailSuppressSend (log
// instead of send) so local dev needs no SMTP creds. Uses the built-in
// System.Net.Mail.SmtpClient rather than an extra NuGet package, mirroring
// the "prefer the framework's own tool" choice made for Backend/api's error
// responses.
//
// Mail is queued, not sent inline: an SMTP round trip (TLS handshake, auth,
// send) takes seconds, and a sign-in code or a removal notice to several
// people shouldn't hold the request up for that. MailSender delivers the
// queue in the background and logs any message it couldn't send.
using System.Net.Mail;
using System.Threading.Channels;
using TeleSpy.Core;

namespace TeleSpy.Services;

public record OutgoingMail(string To, string Subject, string Body);

public interface IMailService
{
    void SendMailSafe(string to, string subject, string body);
}

/// <summary>The in-memory queue between requests and MailSender.</summary>
public class MailQueue
{
    private readonly Channel<OutgoingMail> _channel = Channel.CreateUnbounded<OutgoingMail>(
        new UnboundedChannelOptions { SingleReader = true });

    public void Enqueue(OutgoingMail mail) => _channel.Writer.TryWrite(mail);

    public IAsyncEnumerable<OutgoingMail> ReadAllAsync(CancellationToken token) => _channel.Reader.ReadAllAsync(token);
}

public class MailService(MailQueue queue, ILogger<MailService> logger) : IMailService
{
    public void SendMailSafe(string to, string subject, string body)
    {
        if (Config.MailSuppressSend)
        {
            logger.LogInformation("[email suppressed] to={To} subject={Subject}\n{Body}", to, subject, body);
            return;
        }
        queue.Enqueue(new OutgoingMail(to, subject, body));
    }
}

/// <summary>Sends queued mail one message at a time, off the request path.</summary>
public class MailSender(MailQueue queue, ILogger<MailSender> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var mail in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var client = new SmtpClient(Config.MailServer, Config.MailPort) { EnableSsl = Config.MailUseTls };
                if (Config.MailUsername is not null)
                {
                    client.Credentials = new System.Net.NetworkCredential(Config.MailUsername, Config.MailPassword);
                }
                using var message = new MailMessage(Config.MailDefaultSender, mail.To, mail.Subject, mail.Body);
                await client.SendMailAsync(message, stoppingToken);
            }
            catch (Exception exc) when (exc is not OperationCanceledException)
            {
                logger.LogError(exc, "Couldn't send email to {To} ({Subject})", mail.To, mail.Subject);
            }
        }
    }
}
