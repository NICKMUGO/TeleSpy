"""Redis-backed store for the JWT blocklist and MFA OTPs.

Both are short-lived, single-purpose lookups: the JWT blocklist is checked
on essentially every authenticated request
(``@jwt.token_in_blocklist_loader`` in app.py), and the MFA OTP is
written/read/deleted within a five-minute sign-in window. Redis's native
per-key TTL (`setex`) is a better fit for that than a SQL table needing its
own row and a cleanup job for expired entries — this replaces the earlier
SQL-backed ``MfaOtp``/``RevokedToken`` models (removed from
models/models.py). PasswordHistory, PasswordResetToken, Consent, and
TutorialProgress stay in SQL: they're not high-frequency, per-request
lookups, and (except PasswordResetToken, which is also TTL-bounded but far
lower-traffic) some of them are permanent records, not caches.
"""
import redis
from flask import current_app

_JTI_PREFIX = "telespy:revoked_jti:"
_OTP_PREFIX = "telespy:mfa_otp:"

_clients: dict[str, "redis.Redis"] = {}


def _redis() -> "redis.Redis":
    url = current_app.config["REDIS_URL"]
    client = _clients.get(url)
    if client is None:
        client = redis.from_url(url, decode_responses=True)
        _clients[url] = client
    return client


def revoke_token(jti: str, ttl_seconds: int) -> None:
    """Blocklist a JWT's jti for (at most) the remaining lifetime of the
    token itself — once it would have expired anyway, it's not worth
    remembering."""
    if ttl_seconds > 0:
        _redis().setex(f"{_JTI_PREFIX}{jti}", ttl_seconds, "1")


def is_token_revoked(jti: str) -> bool:
    return _redis().exists(f"{_JTI_PREFIX}{jti}") == 1


def set_otp(user_id: str, otp_hash: str, ttl_seconds: int) -> None:
    """Overwrites any previous OTP for this user — only the latest one
    (per the resend/login flow) is ever valid, matching the old
    delete-then-insert SQL behavior."""
    _redis().setex(f"{_OTP_PREFIX}{user_id}", ttl_seconds, otp_hash)


def get_otp_hash(user_id: str) -> str | None:
    return _redis().get(f"{_OTP_PREFIX}{user_id}")


def consume_otp(user_id: str) -> None:
    _redis().delete(f"{_OTP_PREFIX}{user_id}")
