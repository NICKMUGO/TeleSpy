"""Flask extension singletons + their wiring.

Each extension is instantiated once at import time and bound to the app
inside create_app() via init_app(), the standard application-factory
pattern. The JWT error/blocklist callbacks are registered here too so
app.py stays a thin assembly point.
"""
from flask import jsonify
from flask_jwt_extended import JWTManager
from flask_mail import Mail

from services.cache import is_token_revoked

jwt = JWTManager()
mail = Mail()


def init_extensions(app):
    """Bind the extensions that need nothing beyond the app object."""
    jwt.init_app(app)
    mail.init_app(app)


# --------------------------- JWT loaders ----------------------------------

@jwt.token_in_blocklist_loader
def _is_token_revoked(jwt_header, jwt_payload):  # noqa: ANN001, ARG001
    return is_token_revoked(jwt_payload["jti"])


@jwt.expired_token_loader
def _expired_token(jwt_header, jwt_payload):  # noqa: ANN001, ARG001
    return jsonify({"error": "token_expired", "message": "Your session has expired. Please sign in again."}), 401


@jwt.invalid_token_loader
def _invalid_token(reason):  # noqa: ARG001
    return jsonify({"error": "invalid_token", "message": "Invalid authentication token."}), 401


@jwt.unauthorized_loader
def _missing_token(reason):  # noqa: ARG001
    return jsonify({"error": "unauthenticated", "message": "Authentication required."}), 401


@jwt.revoked_token_loader
def _revoked_token(jwt_header, jwt_payload):  # noqa: ANN001, ARG001
    return jsonify({"error": "token_revoked", "message": "This session has been signed out."}), 401
