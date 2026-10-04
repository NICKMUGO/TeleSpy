// Outbound email helper — mirrors Backend/services/mail.py. SendMailSafe is
// the only way controller code sends mail: it honours MailSuppressSend (log
// instead of send) so local dev needs no SMTP creds. Uses the built-in
// System.Net.Mail.SmtpClient rather than an extra NuGet package, mirroring
// the "prefer the framework's own tool" choice made for Backend/api's error
// responses.
using System.Net.Mail;
using TeleSpy.Core;

namespace TeleSpy.Services;

public interface IMailService
{
    void SendMailSafe(string to, string subject, string body);
}

public class MailService(ILogger<MailService> logger) : IMailService
{
    public void SendMailSafe(string to, string subject, string body)
    {
        if (Config.MailSuppressSend)
        {
            logger.LogInformation("[email suppressed] to={To} subject={Subject}\n{Body}", to, subject, body);
            return;
        }

        using var client = new SmtpClient(Config.MailServer, Config.MailPort) { EnableSsl = Config.MailUseTls };
        if (Config.MailUsername is not null)
        {
            client.Credentials = new System.Net.NetworkCredential(Config.MailUsername, Config.MailPassword);
        }
        using var message = new MailMessage(Config.MailDefaultSender, to, subject, body);
        client.Send(message);
    }
}
