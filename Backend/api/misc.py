"""Unauthenticated service endpoints: index + health check."""
from flask import jsonify, make_response
from flask_restful import Resource


class Index(Resource):
    def get(self):
        return make_response(jsonify({
            "data": {"service": "TeleSpy API"},
            "message": "WELCOME TO TELESPY",
        }), 200)


class Health(Resource):
    def get(self):
        return {"status": "ok"}, 200


RESOURCES = [
    (Index, "/"),
    (Health, "/health"),
]
