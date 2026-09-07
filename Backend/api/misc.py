"""Unauthenticated service endpoints: index + health check."""
from flask_restful import Resource

from core.responses import ok


class Index(Resource):
    def get(self):
        return ok(data={"service": "TeleSpy API"}, message="WELCOME TO TELESPY")


class Health(Resource):
    def get(self):
        return {"status": "ok"}, 200


RESOURCES = [
    (Index, "/"),
    (Health, "/health"),
]
