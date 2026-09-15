#!/usr/bin/env python3
"""Anomaly detection (Isolation Forest) — standalone batch job.

Fits over every eligible historical usage_events row (attributed, not
carved out via excluded_from_anomaly_detection) and inserts an
anomaly_flags row for anything the model scores as anomalous that isn't
already flagged. Safe to run frequently: already-flagged events are
skipped, so re-running only picks up newly ingested events — meant to run
often (e.g. every 4 hours via cron/systemd timer), unlike usage_profiling
and forecasting which change slowly.

Run standalone:
    python anomaly_detection.py

Extensions 256 and 400 (ANOMALY_EXCLUDED_EXTENSIONS in both backends'
constants.py/Constants.cs) are permanently excluded from anomaly detection:
call-ingestion already sets usage_events.excluded_from_anomaly_detection
once, at ingest time — this scorer simply respects that flag rather than
re-deriving it.
"""
import json

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from common import Backend, CALL_CLASS_EXTERNAL, CALL_CLASS_INTERNATIONAL, new_id, now_str, open_backend_connections

CONTAMINATION = 0.05  # expected fraction of eligible events that are anomalous
MIN_EVENTS = 20  # below this, Isolation Forest has too little data to be meaningful
RANDOM_STATE = 20260912

_EVENTS_SQL = """
    SELECT event_id, duration_minutes, computed_cost, occured_at, call_classification
    FROM usage_events
    WHERE attribution_state = 'attributed'
      AND excluded_from_anomaly_detection = FALSE
"""


def _event_features(row: pd.Series) -> list[float]:
    occured_at = pd.to_datetime(row["occured_at"], errors="coerce")
    return [
        float(row["duration_minutes"] or 0.0),
        float(row["computed_cost"] or 0.0),
        float(occured_at.hour) if pd.notnull(occured_at) else 0.0,
        1.0 if row["call_classification"] == CALL_CLASS_INTERNATIONAL else 0.0,
        1.0 if row["call_classification"] == CALL_CLASS_EXTERNAL else 0.0,
    ]


def run(backend: Backend) -> int:
    """Returns the number of new anomaly_flags rows created."""
    events = backend.read_sql(_EVENTS_SQL)
    if len(events) < MIN_EVENTS:
        return 0

    already_flagged = {
        row[0] for row in backend.execute("SELECT event_id FROM anomaly_flags").fetchall()
    }
    features = np.array([_event_features(row) for _, row in events.iterrows()])

    model = IsolationForest(n_estimators=200, contamination=CONTAMINATION, random_state=RANDOM_STATE)
    model.fit(features)
    raw_scores = model.decision_function(features)  # higher = more normal
    predictions = model.predict(features)  # -1 = anomaly, 1 = normal

    created = 0
    for (_, event), raw_score, prediction in zip(events.iterrows(), raw_scores, predictions):
        if prediction != -1 or event["event_id"] in already_flagged:
            continue
        # decision_function is roughly bounded in [-0.5, 0.5]; fold into a
        # 0-1 "how anomalous" score for storage/display consistency with
        # the rule-based scorer both backends already run at ingest time.
        anomaly_score = round(min(1.0, max(0.0, 0.5 - float(raw_score))), 4)
        contributing_features = json.dumps({
            "reason": "isolation_forest",
            "duration_minutes": event["duration_minutes"],
            "computed_cost": event["computed_cost"],
            "call_classification": event["call_classification"],
            "model_score": round(float(raw_score), 4),
        })
        backend.execute(
            """INSERT INTO anomaly_flags (flag_id, event_id, anomaly_score, contributing_features, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (new_id(), event["event_id"], anomaly_score, contributing_features, now_str()),
        )
        created += 1
    backend.commit()
    return created


def main() -> None:
    for backend in open_backend_connections():
        created = run(backend)
        print(f"[{backend.name}] Isolation Forest: {created} new anomaly flag(s) created.")


if __name__ == "__main__":
    main()
