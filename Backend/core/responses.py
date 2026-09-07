"""Uniform JSON envelope + pagination helpers shared by every Resource.

`ok()` / `err()` are the only two shapes the API ever returns, so they
live in one place rather than being re-implemented per blueprint.
"""
from flask import jsonify, make_response, request

# Hard ceiling on page size so a caller can't ask for the whole table.
MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 25


def err(message, status=400, code="error", details=None):
    body = {"error": code, "message": message}
    if details is not None:
        body["details"] = details
    return make_response(jsonify(body), status)


def ok(data=None, message=None, status=200, meta=None):
    body = {}
    if message is not None:
        body["message"] = message
    if data is not None:
        body["data"] = data
    if meta is not None:
        body["meta"] = meta
    return make_response(jsonify(body), status)


def paginate_args():
    """`?page=&limit=` off the query string, clamped to sane bounds."""
    try:
        page = max(1, int(request.args.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        limit = min(MAX_PAGE_SIZE, max(1, int(request.args.get("limit", DEFAULT_PAGE_SIZE))))
    except (TypeError, ValueError):
        limit = DEFAULT_PAGE_SIZE
    return page, limit


def paginate_meta(page, limit, total):
    return {
        "page": page,
        "limit": limit,
        "total": total,
        "pages": (total + limit - 1) // limit if limit else 0,
    }
