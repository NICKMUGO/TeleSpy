"""Encryption, password hashing/bank, and secure random generation.

Field-level encryption (Encryption of SIM cards, extensions, and the
employee<->SIM/extension mapping): two parts, because a symmetric cipher's
output isn't searchable or indexable in SQL.

- ``encrypt_value`` / ``decrypt_value`` (Fernet, AES128-CBC + HMAC): the
  reversible, authenticated ciphertext actually stored in the column.
  Only decrypted for roles authorized to see it.
- ``blind_index``: a deterministic HMAC-SHA256 fingerprint of the same
  value, stored in a plain, indexed/unique column (e.g. ``extension_hash``)
  alongside the ciphertext. It's one-way — you can look up "does this
  value exist" by hashing the query and comparing, but can never recover
  the plaintext from it.

FIELD_ENCRYPTION_KEY and BLIND_INDEX_KEY must be two *different* secrets
(see .env.example) so compromising one doesn't help with the other.

Passwords are hashed (bcrypt, via the User.password hybrid_property in
models/models.py), never "encrypted" — a password hash must never be
reversible. Everything unpredictable here (OTPs, reset tokens) is built on
`secrets`, drawn from the OS CSPRNG — never `random`.
"""
import hashlib
import hmac
import secrets
import string

from cryptography.fernet import Fernet, InvalidToken
from flask import current_app


class DecryptionError(Exception):
    pass


def _fernet() -> Fernet:
    key = current_app.config["FIELD_ENCRYPTION_KEY"]
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_value(plaintext: str | None) -> str | None:
    if plaintext is None or plaintext == "":
        return None
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_value(ciphertext: str | None) -> str | None:
    if ciphertext is None or ciphertext == "":
        return None
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise DecryptionError("Could not decrypt stored value.") from exc


def blind_index(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    key = current_app.config["BLIND_INDEX_KEY"].encode("utf-8")
    normalized = value.strip().lower().encode("utf-8")
    return hmac.new(key, normalized, hashlib.sha256).hexdigest()


def generate_otp(length: int = 6) -> str:
    """Cryptographically secure numeric one-time code, e.g. for email MFA."""
    return "".join(secrets.choice(string.digits) for _ in range(length))


def generate_reset_token() -> str:
    """High-entropy URL-safe token for password reset links (48 raw bytes
    is comfortably more than enough to make guessing infeasible)."""
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """One-way digest used to store/compare reset tokens and OTPs without
    keeping the sensitive value itself in the database."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
