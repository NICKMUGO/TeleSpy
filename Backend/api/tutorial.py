"""In-app tutorial progress: fetch steps for the caller's role, mark a
step done/undone, restart, or dismiss.
"""
from datetime import datetime, timezone

from flask import jsonify, make_response, request
from flask_jwt_extended import jwt_required
from flask_restful import Resource

from core.time import utcnow
from core.tutorial_content import steps_for_role
from models.models import TutorialProgress, db

from api.common import loaded_user


class TutorialProgressResource(Resource):
    @jwt_required()
    def get(self):
        viewer = loaded_user()
        steps = steps_for_role(viewer.role.role_name if viewer.role else None)
        record = db.session.query(TutorialProgress).filter_by(user_id=viewer.user_id).first()
        completed = record.completed_step_ids if record else []
        next_step = next((s["id"] for s in steps if s["id"] not in completed), None)
        return make_response(jsonify({"data": {
            "steps": steps,
            "completed_step_ids": completed,
            "next_step_id": next_step,
            "dismissed": record.dismissed if record else False,
        }}), 200)

    @jwt_required()
    def post(self):
        viewer = loaded_user()
        data = request.get_json(silent=True) or {}
        step_id, completed = data.get("step_id"), data.get("completed", True)
        if not step_id:
            return make_response(jsonify({
                "error_type": "validation_error",
                "message": "step_id is required.",
                "field": "step_id",
                "hint": "Include the id of the tutorial step being marked complete/incomplete.",
                "status": 422,
                "path": request.path,
                "method": request.method,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }), 422)

        record = db.session.query(TutorialProgress).filter_by(user_id=viewer.user_id).first()
        if not record:
            record = TutorialProgress(user_id=viewer.user_id, completed_step_ids=[], dismissed=False)
            db.session.add(record)

        ids = set(record.completed_step_ids or [])
        if completed:
            ids.add(step_id)
        else:
            ids.discard(step_id)
        record.completed_step_ids = sorted(ids)
        record.updated_at = utcnow()
        db.session.commit()
        return make_response(jsonify({"data": {"step_id": step_id, "completed": completed}}), 200)


class TutorialRestart(Resource):
    @jwt_required()
    def post(self):
        viewer = loaded_user()
        record = db.session.query(TutorialProgress).filter_by(user_id=viewer.user_id).first()
        if not record:
            record = TutorialProgress(user_id=viewer.user_id)
            db.session.add(record)
        record.completed_step_ids = []
        record.dismissed = False
        record.updated_at = utcnow()
        db.session.commit()
        return make_response(jsonify({"message": "Tutorial progress reset."}), 200)


class TutorialDismiss(Resource):
    @jwt_required()
    def post(self):
        viewer = loaded_user()
        record = db.session.query(TutorialProgress).filter_by(user_id=viewer.user_id).first()
        if not record:
            record = TutorialProgress(user_id=viewer.user_id, completed_step_ids=[])
            db.session.add(record)
        record.dismissed = True
        record.updated_at = utcnow()
        db.session.commit()
        return make_response(jsonify({"message": "Tutorial dismissed."}), 200)


RESOURCES = [
    (TutorialProgressResource, "/tutorial/progress"),
    (TutorialRestart, "/tutorial/restart"),
    (TutorialDismiss, "/tutorial/dismiss"),
]
