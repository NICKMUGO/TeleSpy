"""Audit log read (admin only)."""
from flask import jsonify, make_response, request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from constants import ROLE_SLUGS, Role
from core.decorators import role_id_required
from core.responses import paginate_args, paginate_meta
from models.models import AuditLog, db


class AuditLogResource(Resource):
    @jwt_required()
    @role_id_required(ROLE_SLUGS[Role.ADMIN])
    def get(self):
        page, limit = paginate_args()
        query = db.session.query(AuditLog)
        if request.args.get("action"):
            query = query.filter_by(action=request.args["action"])
        if request.args.get("actor_user_id"):
            query = query.filter_by(actor_user_id=request.args["actor_user_id"])

        total = query.count()
        rows = query.order_by(AuditLog.occured_at.desc()).offset((page - 1) * limit).limit(limit).all()
        return make_response(jsonify({
            "data": [a.to_dict() for a in rows],
            "meta": paginate_meta(page, limit, total),
        }), 200)


RESOURCES = [
    (AuditLogResource, "/audit"),
]
