"""
Redactor — Credential sanitisation utilities.

Strips sensitive values from dictionaries and connection URIs before
they are logged or returned in API responses.
"""
import re

REDACT_PATTERNS = {"password", "passwd", "secret", "api_key", "token", "key"}


def redact_dict(d: dict) -> dict:
    outcome = {}
    for k, v in d.items():
        if any(s in k.lower() for s in REDACT_PATTERNS):
            outcome[k] = "****"
        elif isinstance(v, dict):
            outcome[k] = redact_dict(v)
        else:
            outcome[k] = v
    return outcome


def redact_connection_uri(conn_str: str) -> str:
    return re.sub(r":([^@/]+)@", ":****@", conn_str)
