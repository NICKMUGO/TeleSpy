"""Authentication + account lifecycle: register, two-step (password + email
OTP) login, token refresh, logout, and the password reset / change /
bank-enforcement flow.
"""
from datetime import datetime, timedelta
from datetime import timezone as tz

from flask import current_app, jsonify, make_response, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)
from flask_restful import Resource

from constants import (
    ACCOUNT_LOCKOUT_MINUTES,
    MAX_FAILED_LOGIN_ATTEMPTS,
    PASSWORD_HISTORY_LIMIT,
    ROLE_SLUGS,
    SELF_REGISTERABLE_ROLES,
)
from core.legal import TERMS_AND_CONDITIONS_TEXT, dpa_notice_text
from core.time import utcnow
from models.models import (
    Consent,
    Employee,
    PasswordHistory,
    PasswordResetToken,
    User,
    bcrypt as models_bcrypt,
    db,
)
from security import generate_otp, generate_reset_token, hash_token
from services.audit import record_audit
from services.cache import consume_otp, get_otp_hash, revoke_token, set_otp
from services.mail import send_mail_safe
from validators import ValidationFailed, require_strong_password, require_valid_email

from api.common import loaded_user, viewer_department_id


class LegalNotice(Resource):
    def get(self):
        return make_response(jsonify({"data": {
            "terms_and_conditions": TERMS_AND_CONDITIONS_TEXT,
            "dpa_notice": dpa_notice_text(),
            "dpa_policy_version": current_app.config["DPA_KE_POLICY_VERSION"],
        }}), 200)


class Register(Resource):
    def post(self):
        data = request.get_json(silent=True) or {}
        try:
            email = require_valid_email(data.get("email", ""))
        except ValidationFailed as exc:
            return make_response(jsonify({
                "error_type": "validation_error",
                "message": exc.message,
                "field": "email",
                "hint": "Provide a valid email address, e.g. name@example.com.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 422)
        try:
            password = require_strong_password(data.get("password", ""))
        except ValidationFailed as exc:
            return make_response(jsonify({
                "error_type": "validation_error",
                "message": exc.message,
                "field": "password",
                "hint": "Use at least 8 characters with an uppercase letter, a lowercase letter, a digit, and a symbol.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 422)

        full_name = (data.get("full_name") or "").strip()
        if not full_name:
            return make_response(jsonify({
                "error_type": "validation_error",
                "message": "Full name is required.",
                "field": "full_name",
                "hint": "Include your full name in the registration request.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 422)

        # Terms & Conditions / Kenya Data Protection Act (2019) consent
        # checkboxes — required, not implied.
        if not data.get("accept_terms"):
            return make_response(jsonify({
                "error_type": "consent_required",
                "message": "You must accept the Terms and Conditions to register.",
                "field": "accept_terms",
                "hint": "Set accept_terms to true after the user has reviewed the Terms and Conditions.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 422)
        if not data.get("accept_dpa_notice"):
            return make_response(jsonify({
                "error_type": "consent_required",
                "message": "You must acknowledge the Data Protection notice (Kenya DPA, 2019) to register.",
                "field": "accept_dpa_notice",
                "hint": "Set accept_dpa_notice to true after the user has reviewed the DPA notice.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 422)

        if db.session.query(User).filter_by(email=email).first():
            return make_response(jsonify({
                "error_type": "email_taken",
                "message": "An account with that email already exists.",
                "field": "email",
                "hint": "Sign in instead, or use a different email address.",
                "status": 409,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 409)

        # Self-registration creates a bare Employee record (no
        # department/staff_number yet — HR assigns those later) plus the
        # User login, since every login must map 1:1 to an Employee.
        employee = Employee(full_name=full_name)
        db.session.add(employee)
        db.session.flush()

        role = SELF_REGISTERABLE_ROLES[0]
        user = User(
            employee_id=employee.employee_id,
            email=email,
            role_id=ROLE_SLUGS[role],
            is_active=True,
            must_change_password=False,
        )
        user.password = password
        db.session.add(user)
        db.session.flush()

        db.session.add(PasswordHistory(user_id=user.user_id, password_hash=user._password, created_at=utcnow()))
        # Kenya Data Protection Act (2019) + Terms & Conditions consent
        # record — captured explicitly, with the policy version in force
        # at the time.
        db.session.add(Consent(
            user_id=user.user_id,
            accepted_terms=True,
            accepted_dpa_notice=True,
            dpa_policy_version=current_app.config["DPA_KE_POLICY_VERSION"],
            created_at=utcnow(),
        ))
        db.session.commit()

        record_audit("register", "user", user.user_id, actor_id=user.user_id, actor_role=role)
        return make_response(jsonify({
            "data": user.to_dict(),
            "message": "Account created. You can now sign in.",
        }), 201)


class Login(Resource):
    def post(self):
        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""

        user = db.session.query(User).filter_by(email=email).first()

        if not user:
            return make_response(jsonify({
                "error_type": "invalid_credentials",
                "message": "Invalid email or password.",
                "field": "password",
                "hint": "Check the email and password and try again.",
                "status": 401,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 401)
        if not user.is_active:
            return make_response(jsonify({
                "error_type": "account_deactivated",
                "message": "This account has been deactivated.",
                "hint": "Contact your administrator to reactivate this account.",
                "status": 403,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 403)
        if user.locked_until and user.locked_until > utcnow():
            return make_response(jsonify({
                "error_type": "account_locked",
                "message": "Account temporarily locked due to repeated failed sign-ins. Try again later.",
                "hint": f"The account unlocks automatically at {user.locked_until.isoformat()}.",
                "status": 423,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 423)

        if not user.check_password(password):
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
            if user.failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS:
                user.locked_until = utcnow() + timedelta(minutes=ACCOUNT_LOCKOUT_MINUTES)
                user.failed_login_attempts = 0
            db.session.commit()
            record_audit("login_failed", "user", user.user_id, actor_id=user.user_id, actor_role=user.role.role_name if user.role else None)
            return make_response(jsonify({
                "error_type": "invalid_credentials",
                "message": "Invalid email or password.",
                "field": "password",
                "hint": "Check the email and password and try again.",
                "status": 401,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 401)

        user.failed_login_attempts = 0
        user.locked_until = None
        db.session.commit()

        otp = generate_otp()
        expires_minutes = current_app.config["MFA_OTP_EXPIRES_MINUTES"]
        set_otp(user.user_id, hash_token(otp), expires_minutes * 60)
        send_mail_safe(user.email, "Your TeleSpy verification code",
                       f"Your TeleSpy sign-in code is: {otp}\n\nIt expires in {expires_minutes} minutes.")

        mfa_token = create_access_token(
            identity=user.user_id,
            additional_claims={"purpose": "mfa"},
            expires_delta=timedelta(minutes=current_app.config["JWT_MFA_TOKEN_EXPIRES_MINUTES"]),
        )
        return make_response(jsonify({
            "data": {"mfa_token": mfa_token, "expires_in_minutes": expires_minutes},
            "message": "Verification code sent to your email.",
        }), 200)


def _user_from_mfa_token(mfa_token: str) -> User:
    try:
        decoded = decode_token(mfa_token)
    except Exception as exc:  # noqa: BLE001
        raise ValidationFailed("MFA session expired or invalid. Please sign in again.") from exc
    if decoded.get("purpose") != "mfa":
        raise ValidationFailed("Invalid MFA session.")
    user = db.session.get(User, decoded["sub"])
    if not user:
        raise ValidationFailed("Invalid MFA session.")
    return user


class ResendOtp(Resource):
    def post(self):
        data = request.get_json(silent=True) or {}
        try:
            user = _user_from_mfa_token(data.get("mfa_token", ""))
        except ValidationFailed as exc:
            return make_response(jsonify({
                "error_type": "invalid_mfa_token",
                "message": exc.message,
                "field": "mfa_token",
                "hint": "Sign in again to obtain a fresh MFA session token.",
                "status": 401,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 401)

        otp = generate_otp()
        expires_minutes = current_app.config["MFA_OTP_EXPIRES_MINUTES"]
        set_otp(user.user_id, hash_token(otp), expires_minutes * 60)
        send_mail_safe(user.email, "Your TeleSpy verification code",
                       f"Your TeleSpy sign-in code is: {otp}\n\nIt expires in {expires_minutes} minutes.")
        return make_response(jsonify({
            "data": {"expires_in_minutes": expires_minutes},
            "message": "A new verification code has been sent.",
        }), 200)


class VerifyOtp(Resource):
    def post(self):
        data = request.get_json(silent=True) or {}
        try:
            user = _user_from_mfa_token(data.get("mfa_token", ""))
        except ValidationFailed as exc:
            return make_response(jsonify({
                "error_type": "invalid_mfa_token",
                "message": exc.message,
                "field": "mfa_token",
                "hint": "Sign in again to obtain a fresh MFA session token.",
                "status": 401,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 401)

        otp = data.get("otp") or ""
        stored_hash = get_otp_hash(user.user_id)
        if not stored_hash or hash_token(otp) != stored_hash:
            return make_response(jsonify({
                "error_type": "invalid_otp",
                "message": "Incorrect or expired code.",
                "field": "otp",
                "hint": "Request a new code with /auth/resend-otp and enter it before it expires.",
                "status": 401,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 401)

        consume_otp(user.user_id)

        claims = {"role": user.role.role_name if user.role else None, "role_id": user.role_id, "department_id": viewer_department_id(user)}
        access_token = create_access_token(identity=user.user_id, additional_claims=claims)
        refresh_token = create_refresh_token(identity=user.user_id, additional_claims=claims)
        record_audit("login_success", "user", user.user_id, actor_id=user.user_id, actor_role=claims["role"])

        return make_response(jsonify({
            "data": {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "user": user.to_dict(),
                "must_change_password": user.must_change_password,
            },
            "message": "Signed in.",
        }), 200)


class Refresh(Resource):
    @jwt_required(refresh=True)
    def post(self):
        claims = get_jwt()
        access_token = create_access_token(
            identity=get_jwt_identity(),
            additional_claims={"role": claims.get("role"), "role_id": claims.get("role_id"), "department_id": claims.get("department_id")},
        )
        return make_response(jsonify({"data": {"access_token": access_token}}), 200)


class ForgotPassword(Resource):
    def post(self):
        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        user = db.session.query(User).filter_by(email=email).first()
        if user:
            issue_password_reset(user)
        # Always the same response, whether or not the account exists, so
        # this can't be used to enumerate registered emails.
        return make_response(jsonify({
            "message": "If an account exists for that email, a password reset link has been sent.",
        }), 200)


def issue_password_reset(user: User) -> str:
    token = generate_reset_token()
    expires_minutes = current_app.config["PASSWORD_RESET_TOKEN_EXPIRES_MINUTES"]
    db.session.query(PasswordResetToken).filter_by(user_id=user.user_id).delete()
    db.session.add(PasswordResetToken(user_id=user.user_id, token_hash=hash_token(token), expires_at=utcnow() + timedelta(minutes=expires_minutes)))
    db.session.commit()
    origins = current_app.config["FRONTEND_ORIGINS"]
    frontend_origin = origins[0] if origins else ""
    reset_link = f"{frontend_origin}/reset-password?token={token}"
    send_mail_safe(user.email, "Reset your TeleSpy password",
                   f"We received a request to reset your TeleSpy password.\n\n{reset_link}\n\n"
                   f"This link expires in {expires_minutes} minutes and can only be used once.")
    return token


def rotate_password(user: User, new_password: str):
    """Password Bank: reject a password matching the current one or any of
    the last PASSWORD_HISTORY_LIMIT."""
    history = (
        db.session.query(PasswordHistory)
        .filter_by(user_id=user.user_id)
        .order_by(PasswordHistory.created_at.desc())
        .limit(PASSWORD_HISTORY_LIMIT)
        .all()
    )
    for record in history:
        if models_bcrypt.check_password_hash(record.password_hash, new_password):
            raise ValidationFailed(f"You can't reuse any of your last {PASSWORD_HISTORY_LIMIT} passwords.")

    user.password = new_password
    user.must_change_password = False
    db.session.add(PasswordHistory(user_id=user.user_id, password_hash=user._password, created_at=utcnow()))
    db.session.commit()


class ResetPassword(Resource):
    def post(self):
        data = request.get_json(silent=True) or {}
        token = data.get("token") or ""
        try:
            new_password = require_strong_password(data.get("new_password", ""))
        except ValidationFailed as exc:
            return make_response(jsonify({
                "error_type": "validation_error",
                "message": exc.message,
                "field": "new_password",
                "hint": "Use at least 8 characters with an uppercase letter, a lowercase letter, a digit, and a symbol.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 422)

        record = db.session.query(PasswordResetToken).filter_by(token_hash=hash_token(token), consumed=False).first()

        if not record or record.expires_at < utcnow():
            return make_response(jsonify({
                "error_type": "invalid_reset_token",
                "message": "This reset link is invalid or has expired.",
                "field": "token",
                "hint": "Request a new password reset link via /auth/forgot-password.",
                "status": 400,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 400)

        user = db.session.get(User, record.user_id)
        if not user:
            return make_response(jsonify({
                "error_type": "invalid_reset_token",
                "message": "This reset link is invalid or has expired.",
                "field": "token",
                "hint": "Request a new password reset link via /auth/forgot-password.",
                "status": 400,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 400)

        try:
            rotate_password(user, new_password)
        except ValidationFailed as exc:
            return make_response(jsonify({
                "error_type": "password_reused",
                "message": exc.message,
                "field": "new_password",
                "hint": "Choose a password you haven't used recently.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 422)

        record.consumed = True
        db.session.commit()
        record_audit("password_reset", "user", user.user_id, actor_id=user.user_id, actor_role=user.role.role_name if user.role else None)
        return make_response(jsonify({
            "message": "Password reset. You can now sign in with your new password.",
        }), 200)


class ChangePassword(Resource):
    @jwt_required()
    def post(self):
        user = loaded_user()
        data = request.get_json(silent=True) or {}
        if not user or not user.check_password(data.get("current_password") or ""):
            return make_response(jsonify({
                "error_type": "invalid_credentials",
                "message": "Current password is incorrect.",
                "field": "current_password",
                "hint": "Enter your current password correctly before choosing a new one.",
                "status": 401,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 401)
        try:
            new_password = require_strong_password(data.get("new_password", ""))
            rotate_password(user, new_password)
        except ValidationFailed as exc:
            is_reused = "reuse" in exc.message
            return make_response(jsonify({
                "error_type": "password_reused" if is_reused else "validation_error",
                "message": exc.message,
                "field": "new_password",
                "hint": "Choose a password you haven't used recently." if is_reused
                        else "Use at least 8 characters with an uppercase letter, a lowercase letter, a digit, and a symbol.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(tz.utc).isoformat(),
            }), 422)

        record_audit("password_changed", "user", user.user_id)
        return make_response(jsonify({"message": "Password changed."}), 200)


class Logout(Resource):
    @jwt_required()
    def post(self):
        claims = get_jwt()
        ttl_seconds = max(1, int(claims["exp"] - datetime.now(tz.utc).timestamp()))
        revoke_token(claims["jti"], ttl_seconds)
        return make_response(jsonify({"message": "Signed out."}), 200)


RESOURCES = [
    (LegalNotice, "/auth/legal-notice"),
    (Register, "/auth/register"),
    (Login, "/auth/login"),
    (ResendOtp, "/auth/resend-otp"),
    (VerifyOtp, "/auth/verify-otp"),
    (Refresh, "/auth/refresh"),
    (ForgotPassword, "/auth/forgot-password"),
    (ResetPassword, "/auth/reset-password"),
    (ChangePassword, "/auth/change-password"),
    (Logout, "/auth/logout"),
]
