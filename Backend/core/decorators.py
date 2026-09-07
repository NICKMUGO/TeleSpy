"""Authentication/authorization decorators used on every Resource method in
app.py, plus the global before_request hook that backs them.

Per the brief ("before request to check user role before granting access",
"APIs should check for role_id before granting access... before request in
Flask"): app.py registers one `@app.before_request` hook
(`load_current_user`) that authenticates the JWT for every request except
the public auth endpoints, and attaches role/role_id/department_id onto
`g.current_user`. `role_id_required(...)` then stacks on individual
Resource methods (alongside `@jwt_required()`, matching the style of the
example this was modeled on) for the "only these roles may call this"
check.
"""
from functools import wraps

from flask import g
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request

# Path prefixes that never require a signed-in user. Everything else goes
# through the JWT check in load_current_user().
PUBLIC_PATHS = (
    "/auth/register",
    "/auth/login",
    "/auth/verify-otp",
    "/auth/resend-otp",
    "/auth/refresh",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/auth/legal-notice",
    "/health",
)


def load_current_user():
    """Registered as app.before_request in app.py."""
    from flask import request

    if request.method == "OPTIONS" or request.path in PUBLIC_PATHS:
        return None
    verify_jwt_in_request()
    claims = get_jwt()
    g.current_user = {
        "id": get_jwt_identity(),
        "role": claims.get("role"),
        "role_id": claims.get("role_id"),
        "department_id": claims.get("department_id"),
    }
    return None


def current_user() -> dict:
    return g.get("current_user") or {}


def role_id_required(*allowed_role_ids: int):
    """Restrict a Resource method to specific numeric role_ids — the check
    the brief asks for explicitly ("APIs should check for role_id before
    granting access"). Stack this under @jwt_required() on the method."""

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if current_user().get("role_id") not in allowed_role_ids:
                return {"error": "forbidden", "message": "Your role does not have access to this resource."}, 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def role_required(*allowed_roles: str):
    """Same idea, keyed on the role *name* — handy where a name reads
    clearer than the numeric id at the call site."""

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if current_user().get("role") not in allowed_roles:
                return {"error": "forbidden", "message": "Your role does not have access to this resource."}, 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator
