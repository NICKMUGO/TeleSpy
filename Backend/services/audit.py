"""AuditLog writer - one helper so every Resource records the trail the
same way (actor resolved from the current JWT unless overridden).
""" 
from core.decorators import current_user
from core.time import utcnow
from models.models import AuditLog, db


def record_audit(action, resource, resource_id=None, meta=None, actor_id=None, actor_role=None):
    cu = current_user()
    resolved_actor_id = actor_id if actor_id is not None else cu.get("id")
    resolved_actor_role = actor_role if actor_role is not None else cu.get("role")
    db.session.add(
        AuditLog(
            actor_user_id=resolved_actor_id,
            actor_role=resolved_actor_role,
            action=action,
            resource=resource,
            resource_id=str(resource_id) if resource_id is not None else None,
            meta=meta or {},
            occured_at=utcnow(),
        )
    )
    db.session.commit()
