"""Pagination helpers shared by every Resource.

Response bodies (success and error) are built inline at each call site
in api/*.py rather than through a shared envelope helper.
"""
from flask import request

# Hard ceiling on page size so a caller can't ask for the whole table.
MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 25


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
