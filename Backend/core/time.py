"""One shared clock for the app layer.

Kept separate from models.models._utcnow() (which stays where it is,
untouched) so route/service code has a single import for "now" instead of
re-deriving the naive-UTC dance in every module.
"""
from datetime import datetime
from datetime import timezone as tz


def utcnow() -> datetime:
    # Naive UTC, deliberately — see the long comment on
    # models.models._utcnow() for why (SQLite drops tzinfo on write, so
    # mixing naive/aware values blows up every expiry comparison).
    return datetime.now(tz.utc).replace(tzinfo=None)
