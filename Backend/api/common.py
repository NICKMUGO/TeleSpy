"""Small helpers every resource module reaches for: resolving the caller
to a full User row, their department scope, and the current month key.
"""
from core.decorators import current_user
from core.time import utcnow
from models.models import User, db


def loaded_user() -> User | None:
    """The full User row for the caller, or None if unauthenticated."""
    cu = current_user()
    if not cu.get("id"):
        return None
    return db.session.get(User, cu["id"])


def viewer_department_id(viewer: User) -> str | None:
    return viewer.employee.department_id if viewer.employee else None


def current_month() -> str:
    return utcnow().strftime("%Y-%m")
