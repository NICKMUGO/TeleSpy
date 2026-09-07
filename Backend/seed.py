"""Intentionally empty for now — per the brief, no seed data yet.

Run with `python seed.py` once real seed data is wanted (initial
departments, a first Admin account, etc.). Until then this exists
just so the file is present, matching the expected project layout.
"""
from app import app
from models.models import db

if __name__ == "__main__":
    with app.app_context():
        db.create_all()  # harmless if `flask db upgrade` already ran
        print("No seed data inserted (none requested yet). Tables are ready.")
