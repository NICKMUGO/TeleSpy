import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _list(name: str, default: str = "") -> list[str]:
    raw = os.getenv(name, default)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


class Config:
    ENV = os.getenv("FLASK_ENV", "production")
    DEBUG = ENV == "development"
    SECRET_KEY = os.getenv("SECRET_KEY", "")

    # --- Database (SQL) -----------------------------------------------------
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///telespy.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # --- Redis (JWT blocklist + MFA OTP cache) -------------------------------
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # --- JWT ---------------------------------------------------------------
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
    JWT_TOKEN_LOCATION = ["headers"]
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES_MINUTES", "15")))
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=int(os.getenv("JWT_REFRESH_TOKEN_EXPIRES_DAYS", "7")))
    JWT_MFA_TOKEN_EXPIRES_MINUTES = int(os.getenv("JWT_MFA_TOKEN_EXPIRES_MINUTES", "5"))

    # --- Field-level encryption --------------------------------------------
    FIELD_ENCRYPTION_KEY = os.getenv("FIELD_ENCRYPTION_KEY", "")
    BLIND_INDEX_KEY = os.getenv("BLIND_INDEX_KEY", "")

    # --- CORS ----------------------------------------------------------------
    FRONTEND_ORIGINS = _list("FRONTEND_ORIGINS", "http://localhost:3000")

    # --- Mail ------------------------------------------------------------------
    MAIL_SERVER = os.getenv("MAIL_SERVER", "localhost")
    MAIL_PORT = int(os.getenv("MAIL_PORT", "587"))
    MAIL_USE_TLS = _bool("MAIL_USE_TLS", "true")
    MAIL_USERNAME = os.getenv("MAIL_USERNAME")
    MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")
    MAIL_DEFAULT_SENDER = os.getenv("MAIL_DEFAULT_SENDER", "TeleSpy <no-reply@telespy.local>")
    MAIL_SUPPRESS_SEND = _bool("MAIL_SUPPRESS_SEND", "true")

    # --- Policy -----------------------------------------------------------------
    DPA_KE_POLICY_VERSION = os.getenv("DPA_KE_POLICY_VERSION", "2026-01")
    PASSWORD_RESET_TOKEN_EXPIRES_MINUTES = int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRES_MINUTES", "30"))
    MFA_OTP_EXPIRES_MINUTES = int(os.getenv("MFA_OTP_EXPIRES_MINUTES", "5"))

    @classmethod
    def validate(cls):
        """Fail fast on missing secrets instead of limping along insecurely."""
        missing = [
            name
            for name in ("SECRET_KEY", "JWT_SECRET_KEY", "FIELD_ENCRYPTION_KEY", "BLIND_INDEX_KEY")
            if not getattr(cls, name)
        ]
        if missing:
            raise RuntimeError(
                "Missing required environment variables: " + ", ".join(missing) + ". See .env.example."
            )
