"""
Incident Handler — Automated error capture and notification pipeline.

Dispatches error reports via SMTP when credentials are available, otherwise
persists them to a local log file. Ensures production exceptions are
recorded without requiring manual log tailing.

Environment variables:
    FEEDBACK_EMAIL: Destination address for incident emails.
    SMTP_HOST:      Mail server hostname (default: smtp.gmail.com).
    SMTP_PORT:      Mail server port (default: 587).
    SMTP_USER:      Authentication username for the SMTP server.
    SMTP_PASS:      Authentication password or app-specific token.
"""

import os
import logging
import traceback
from datetime import datetime

logger = logging.getLogger(__name__)

FEEDBACK_EMAIL = os.getenv("FEEDBACK_EMAIL", "")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")


def handle_incident(error: Exception, context: dict | None = None) -> None:
    """Capture an exception and route it to the configured notification channel.

    Parameters:
        error:   The caught exception instance.
        context: Optional mapping of request metadata (question, mode, etc.).
    """
    timestamp = datetime.utcnow().isoformat()
    tb = traceback.format_exception(type(error), error, error.__traceback__)
    tb_str = "".join(tb)

    context_str = ""
    if context:
        safe_ctx = {k: v for k, v in context.items() if k not in ("token", "password")}
        context_str = "\n".join("  {}: {}".format(k, v) for k, v in safe_ctx.items())

    report = (
        "YourAnalyst Error Report\n"
        "{}\n"
        "Time: {}\n"
        "Error: {}\n\n"
        "Context:\n{}\n\n"
        "Traceback:\n{}\n"
    ).format('=' * 50, timestamp, error, context_str or '  (none)', tb_str)

    if FEEDBACK_EMAIL and SMTP_USER and SMTP_PASS:
        try:
            _dispatch_email(report, timestamp)
            logger.info("Incident report mailed to %s", FEEDBACK_EMAIL)
            return
        except Exception as mail_err:
            logger.warning("Email dispatch failed (%s), falling back to file.", mail_err)

    _persist_log(report)


def _dispatch_email(report: str, timestamp: str) -> None:
    """Transmit the incident report over SMTP."""
    import smtplib
    from email.mime.text import MIMEText

    msg = MIMEText(report)
    msg["Subject"] = "[YourAnalyst] Error at {}".format(timestamp)
    msg["From"] = SMTP_USER
    msg["To"] = FEEDBACK_EMAIL

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)


def _persist_log(report: str) -> None:
    """Append the incident report to the local errors.log file."""
    log_path = os.path.join(os.path.dirname(__file__), "..", "errors.log")
    try:
        with open(log_path, "a") as f:
            f.write(report)
            f.write("\n\n")
        logger.info("Incident written to %s", log_path)
    except Exception as file_err:
        logger.error("Could not persist incident log: %s", file_err)
