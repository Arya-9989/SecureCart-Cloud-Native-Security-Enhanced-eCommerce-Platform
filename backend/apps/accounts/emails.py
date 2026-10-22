"""Transactional email for account security: address verification and password reset.

Delivery runs off the request path (``EMAIL_DELIVERY=background``, the default): the
message is built in the request, then handed to a small thread pool after the transaction
commits. That keeps SMTP latency out of the response, which matters for the password-reset
endpoint: a response that waits for SMTP only when the account exists would reveal which
addresses have accounts.

Messages are not persisted in an outbox on purpose: the body carries the raw one-time secret,
and the database stores only its hash. A message that cannot be delivered after the retries
is logged (without the link) and the user simply asks for a new one.

The link puts the secret in the URL fragment (``#token=...``). Browsers never send the
fragment to a server, so it cannot leak through access logs, proxies or ``Referer``.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from smtplib import SMTPException

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.utils.html import escape

from apps.accounts.models import User

logger = logging.getLogger("securecart.email")

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="email")


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    text: str
    html: str
    kind: str


def _link(path: str, secret: str) -> str:
    return f"{settings.APP_BASE_URL.rstrip('/')}{path}#token={secret}"


def _html(heading: str, intro: str, link: str, button: str, footer: str) -> str:
    # Inline styles only: mail clients strip <style>. Every interpolated value is escaped.
    return (
        '<!doctype html><html><body style="margin:0;background:#f5f5f7;'
        "font-family:-apple-system,'Inter',Segoe UI,Roboto,sans-serif;color:#1d1d1f\">"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        '<tr><td align="center" style="padding:40px 16px">'
        '<table role="presentation" width="100%" style="max-width:480px;background:#fff;'
        'border-radius:18px;padding:40px 32px" cellpadding="0" cellspacing="0"><tr><td>'
        '<p style="margin:0 0 24px;font-size:15px;font-weight:600">SecureCart</p>'
        f'<h1 style="margin:0 0 12px;font-size:28px;line-height:1.15;font-weight:600">'
        f"{escape(heading)}</h1>"
        f'<p style="margin:0 0 28px;font-size:17px;line-height:1.45;color:#424245">'
        f"{escape(intro)}</p>"
        f'<a href="{escape(link)}" style="display:inline-block;background:#0b4fd1;color:#fff;'
        'text-decoration:none;font-size:17px;padding:12px 24px;border-radius:980px">'
        f"{escape(button)}</a>"
        f'<p style="margin:28px 0 0;font-size:13px;line-height:1.5;color:#6e6e73">'
        f"{escape(footer)}</p>"
        "</td></tr></table></td></tr></table></body></html>"
    )


def verification_email(user: User, secret: str) -> Email:
    link = _link("/verify-email", secret)
    hours = settings.EMAIL_VERIFICATION_TTL_HOURS
    footer = (
        f"This link works once and expires in {hours} hours. "
        "If you did not create a SecureCart account, you can ignore this email."
    )
    intro = f"Hi {user.full_name}, confirm this is your address so you can check out."
    return Email(
        to=user.email,
        subject="Confirm your email for SecureCart",
        text=f"{intro}\n\nConfirm your email: {link}\n\n{footer}\n",
        html=_html("Confirm your email.", intro, link, "Confirm email", footer),
        kind="verify_email",
    )


def password_reset_email(user: User, secret: str) -> Email:
    link = _link("/reset-password", secret)
    minutes = settings.PASSWORD_RESET_TTL_MINUTES
    footer = (
        f"This link works once and expires in {minutes} minutes. Choosing a new password "
        "signs you out everywhere. If you did not ask for this, ignore this email: your "
        "password stays the same."
    )
    intro = "Someone, hopefully you, asked to reset the password for this SecureCart account."
    return Email(
        to=user.email,
        subject="Reset your SecureCart password",
        text=f"{intro}\n\nChoose a new password: {link}\n\n{footer}\n",
        html=_html("Reset your password.", intro, link, "Choose a new password", footer),
        kind="reset_password",
    )


def password_changed_email(user: User) -> Email:
    """Notice carrying no secret: the owner learns of a reset they did not make."""
    link = f"{settings.APP_BASE_URL.rstrip('/')}/forgot-password"
    intro = (
        "The password for your SecureCart account was just changed, and every device "
        "signed in to it was signed out."
    )
    footer = (
        "If this was you, there is nothing else to do. If it was not, reset your password "
        "now from the sign-in page."
    )
    return Email(
        to=user.email,
        subject="Your SecureCart password was changed",
        text=f"{intro}\n\n{footer}\n{link}\n",
        html=_html("Your password was changed.", intro, link, "Reset password", footer),
        kind="password_changed",
    )


def _deliver(email: Email) -> bool:
    """Send with bounded retries. Returns True once the SMTP server accepted the message."""
    attempts = max(1, settings.EMAIL_SEND_ATTEMPTS)
    for attempt in range(1, attempts + 1):
        message = EmailMultiAlternatives(
            subject=email.subject,
            body=email.text,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[email.to],
        )
        message.attach_alternative(email.html, "text/html")
        try:
            message.send(fail_silently=False)
        except (SMTPException, OSError) as exc:
            logger.warning(
                "email send failed kind=%s attempt=%s/%s error=%s",
                email.kind,
                attempt,
                attempts,
                type(exc).__name__,
            )
            if attempt < attempts:
                time.sleep(settings.EMAIL_RETRY_BACKOFF_SECONDS * attempt)
            continue
        logger.info("email sent kind=%s", email.kind)
        return True
    logger.error("email dropped after %s attempts kind=%s", attempts, email.kind)
    return False


def send(email: Email) -> None:
    """Deliver ``email`` once the current transaction commits (never before)."""
    if settings.EMAIL_DELIVERY == "inline":
        transaction.on_commit(lambda: _deliver(email))
    else:
        transaction.on_commit(lambda: _executor.submit(_deliver, email))
