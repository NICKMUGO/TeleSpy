"""TeleSpy API — application factory.

Thin assembly point: build the Flask app, bind extensions, register the
per-domain resources from `api/`, and bootstrap the structural `roles`
rows. All request-handling logic lives under `api/`, `services/`, and
`core/`; the SQLAlchemy models are unchanged under `models/`.

Run:
    python app.py            # dev server on :5000
    gunicorn app:app         # production  (module-level `app` below)
"""
from flask import Flask
from flask_cors import CORS
from flask_migrate import Migrate
from flask_restful import Api
from sqlalchemy.exc import SQLAlchemyError

from api import register_resources
from constants import DEFAULT_CALL_LIMIT_KES, ROLE_SLUGS
from core.config import Config
from core.decorators import load_current_user
from core.extensions import init_extensions
from models.models import Role as RoleModel, bcrypt as models_bcrypt, db


def ensure_default_roles():
    """The `roles` table needs Admin/Manager/Employee to exist for
    users.role_id to be a satisfiable foreign key at all. This is
    structural reference data (like a fixed status enum), not the
    business/demo "seed data" the brief says to hold off on — no
    Department, Employee, User, or SimCard row is ever created here.
    Idempotent: upserts by the fixed slug, safe to run on every boot."""
    for role_name, slug in ROLE_SLUGS.items():
        role = db.session.get(RoleModel, slug)
        if role is None:
            db.session.add(RoleModel(
                role_id=slug,
                role_name=role_name,
                permissions=[],
                call_limit_kshs=DEFAULT_CALL_LIMIT_KES.get(role_name),
            ))
    db.session.commit()


def create_app(config_object=Config):
    app = Flask(__name__)
    app.config.from_object(config_object)
    config_object.validate()

    db.init_app(app)
    Migrate(app, db)
    models_bcrypt.init_app(app)  # backs User.password/check_password in models/models.py
    init_extensions(app)  # JWT + Mail
    CORS(app, resources={r"/*": {"origins": app.config["FRONTEND_ORIGINS"]}}, supports_credentials=True)

    app.before_request(load_current_user)

    api = Api(app)
    register_resources(api)

    with app.app_context():
        try:
            ensure_default_roles()
        except SQLAlchemyError:
            # The `roles` table doesn't exist yet — e.g. this import is
            # `flask db migrate`/`upgrade` introspecting models before the
            # schema exists, or a fresh checkout that hasn't migrated yet.
            # Roll back and move on; ensure_default_roles() runs again (and
            # succeeds) the next time the app boots after migrating.
            db.session.rollback()
            app.logger.warning("Skipped default-role bootstrap: `roles` table not present yet. Run `flask db upgrade`.")

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=app.config["DEBUG"], port=5000)
