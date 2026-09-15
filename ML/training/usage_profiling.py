#!/usr/bin/env python3
"""Usage profiling (KMeans) — standalone batch job.

Clusters employees by calling behavior and writes each employee's cluster
to usage_profiles.cluster_label. Calling patterns shift slowly, so this is
meant to run infrequently (e.g. every 3 months via cron/systemd timer),
unlike anomaly_detection which should run often.

Run standalone:
    python usage_profiling.py
"""
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans

from common import Backend, CALL_CLASS_EXTERNAL, CALL_CLASS_INTERNATIONAL, new_id, now_str, open_backend_connections

CLUSTERS = 3
CLUSTER_LABELS = ["low_usage", "moderate_usage", "high_usage"]  # ranked by centroid cost after fit
RANDOM_STATE = 20260912

_EMPLOYEE_EVENTS_SQL = """
    SELECT e.employee_id, ev.duration_minutes, ev.computed_cost, ev.call_classification
    FROM employees e
    JOIN sim_allocations sa ON sa.employee_id = e.employee_id
    JOIN usage_events ev ON ev.allocation_id = sa.allocation_id
"""


def _employee_usage_vectors(backend: Backend) -> dict[str, list[float]]:
    events = backend.read_sql(_EMPLOYEE_EVENTS_SQL)
    vectors: dict[str, list[float]] = {}
    for employee_id, group in events.groupby("employee_id"):
        total_calls = len(group)
        total_duration = group["duration_minutes"].fillna(0).sum()
        total_cost = group["computed_cost"].fillna(0).sum()
        intl_share = (group["call_classification"] == CALL_CLASS_INTERNATIONAL).sum() / total_calls
        ext_share = (group["call_classification"] == CALL_CLASS_EXTERNAL).sum() / total_calls
        vectors[employee_id] = [float(total_calls), total_duration / total_calls, float(total_cost), intl_share, ext_share]
    return vectors


def run(backend: Backend) -> int:
    """Returns the number of usage_profiles rows written/updated."""
    vectors_by_employee = _employee_usage_vectors(backend)
    employee_ids = list(vectors_by_employee)
    if len(employee_ids) < CLUSTERS:
        return 0

    vectors = [vectors_by_employee[eid] for eid in employee_ids]
    features = np.array(vectors)
    # Standardize so cost (large KES figures) doesn't drown out the
    # call-count/share features.
    mean, std = features.mean(axis=0), features.std(axis=0)
    std[std == 0] = 1.0
    scaled = (features - mean) / std

    model = KMeans(n_clusters=CLUSTERS, n_init=10, random_state=RANDOM_STATE)
    labels = model.fit_predict(scaled)

    # Rank clusters by centroid total_cost (index 2 of the unscaled feature
    # vector) so labels read low->high regardless of KMeans' arbitrary
    # cluster numbering.
    centroid_cost = {}
    for cluster_id in range(CLUSTERS):
        members = [vectors[i][2] for i in range(len(vectors)) if labels[i] == cluster_id]
        centroid_cost[cluster_id] = sum(members) / len(members) if members else 0.0
    ranked = sorted(centroid_cost, key=lambda c: centroid_cost[c])
    label_for_cluster = {cluster_id: CLUSTER_LABELS[rank] for rank, cluster_id in enumerate(ranked)}

    updated = 0
    for employee_id, label_idx in zip(employee_ids, labels):
        cluster_label = label_for_cluster[label_idx]
        existing = backend.execute(
            "SELECT profile_id FROM usage_profiles WHERE employee_id = ?", (employee_id,)
        ).fetchone()
        if existing:
            backend.execute(
                "UPDATE usage_profiles SET cluster_label = ?, updated_at = ? WHERE employee_id = ?",
                (cluster_label, now_str(), employee_id),
            )
        else:
            backend.execute(
                """INSERT INTO usage_profiles (profile_id, employee_id, cluster_label, updated_at)
                   VALUES (?, ?, ?, ?)""",
                (new_id(), employee_id, cluster_label, now_str()),
            )
        updated += 1
    backend.commit()
    return updated


def main() -> None:
    for backend in open_backend_connections():
        updated = run(backend)
        print(f"[{backend.name}] KMeans: {updated} employee usage profile(s) updated.")


if __name__ == "__main__":
    main()
