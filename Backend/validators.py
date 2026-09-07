import re

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
EXTENSION_RE = re.compile(r"^\d{3}$")

PASSWORD_MIN_LENGTH = 8
_UPPER = re.compile(r"[A-Z]")
_LOWER = re.compile(r"[a-z]")
_DIGIT = re.compile(r"\d")
_SYMBOL = re.compile(r"[^A-Za-z0-9]")


class ValidationFailed(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def require_valid_email(email: str) -> str:
    if not email or not EMAIL_RE.match(email):
        raise ValidationFailed("Enter a valid email address.")
    return email.strip().lower()


def require_strong_password(password: str) -> str:
    if not password or len(password) < PASSWORD_MIN_LENGTH:
        raise ValidationFailed(f"Password must be at least {PASSWORD_MIN_LENGTH} characters.")
    if not (_UPPER.search(password) and _LOWER.search(password) and _DIGIT.search(password) and _SYMBOL.search(password)):
        raise ValidationFailed(
            "Password must include an uppercase letter, a lowercase letter, a digit, and a symbol."
        )
    return password


def require_valid_extension(extension: str) -> str:
    if not EXTENSION_RE.match(extension):
        raise ValidationFailed("Extension must be exactly 3 digits.")
    return extension
