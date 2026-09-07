"""Outbound email helper.

`send_mail_safe` is the only way route code sends mail: it honours the
MAIL_SUPPRESS_SEND flag (log instead of send) so local dev needs no SMTP
creds.
"""
from flask import current_app
from flask_mail import Message as MailMessage

from core.extensions import mail


def send_mail_safe(to, subject, body):
    if current_app.config.get("MAIL_SUPPRESS_SEND"):
        current_app.logger.info("[email suppressed] to=%s subject=%s\n%s", to, subject, body)
        return
    mail.send(MailMessage(subject=subject, recipients=[to], body=body))
