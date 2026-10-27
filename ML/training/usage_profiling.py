#!/usr/bin/env python3
"""Usage profiling (KMeans) — standalone batch job.

Clusters employees by calling behavior and writes each employee's cluster
to usage_profiles.cluster_label. Calling patterns shift slowly, so this is
meant to run infrequently (every 3 months via cron — deploy/ml.crontab),
unlike anomaly_detection which should run often.

Run standalone:
    python usage_profiling.py

Model selection: KMeans is unsupervised — there's no ground-truth "this
employee really belongs to cluster X" label anywhere in the schema, so
accuracy/precision/recall aren't computable (there's nothing to compare
predictions against; scoring the model against its own labels would be
circular). evaluate() below instead grid-searches CLUSTER_GRID (candidate
cluster counts) with repeated K-Fold CV (plain, not stratified — no class
label exists to stratify on): for each fold it fits on the training split
and scores clustering quality (silhouette / Davies-Bouldin /
Calinski-Harabasz / inertia) on both that training split and a held-out
split assigned to the trained centroids, so the train-vs-held-out gap
plays the same role a training-error/testing-error gap plays for a
supervised model. Note CLUSTERS stays fixed at 3 in production regardless
of what the grid search ranks best: CLUSTER_LABELS is a fixed 3-tier
low/moderate/high business scheme, not a free hyperparameter — the grid
search exists to show where k=3 sits against the alternatives, not to
silently change the number of output tiers.
"""
# numpy: array math throughout.
import numpy as np
# pandas: DataFrame handling for the SQL query result.
import pandas as pd
# KMeans: the clustering model itself.
from sklearn.cluster import KMeans
# Three unsupervised clustering-quality metrics used during evaluation.
from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score, silhouette_score
# Cross-validation splitter used during grid search.
from sklearn.model_selection import RepeatedKFold

# Shared DB wrapper/helpers, plus classification label constants used as
# feature inputs below.
from common import Backend, CALL_CLASS_EXTERNAL, CALL_CLASS_INTERNATIONAL, new_id, now_str, open_backend_connections

CLUSTERS = 3  # fixed production cluster count — see module docstring
CLUSTER_LABELS = ["low_usage", "moderate_usage", "high_usage"]  # ranked by centroid cost after fit
RANDOM_STATE = 20260912  # fixed seed for reproducible fits

# --- Hyperparameter search space (diagnostic only — see module docstring) -
CLUSTER_GRID = [2, 3, 4, 5]  # candidate k values tried during grid search
CV_SPLITS = 5  # k in k-fold
CV_REPEATS = 3  # how many times the k-fold split is repeated with different shuffles
MIN_CV_SAMPLES = 15  # below this, folds are too small for silhouette to mean anything

# SQL: every usage_event joined back to the employee who placed it (via
# their current SIM allocation) — one row per event, employee_id repeated.
_EMPLOYEE_EVENTS_SQL = """
    SELECT e.employee_id, ev.duration_minutes, ev.computed_cost, ev.call_classification
    FROM employees e
    JOIN sim_allocations sa ON sa.employee_id = e.employee_id
    JOIN usage_events ev ON ev.allocation_id = sa.allocation_id
"""


def _employee_usage_vectors(backend: Backend) -> dict[str, list[float]]:
    # Run the join query, returning one row per usage event.
    events = backend.read_sql(_EMPLOYEE_EVENTS_SQL)
    # Result: employee_id -> that employee's feature vector.
    vectors: dict[str, list[float]] = {}
    # Group all rows by employee_id, then compute one feature vector per
    # employee from their group of events.
    for employee_id, group in events.groupby("employee_id"):
        # How many calls this employee made in total.
        total_calls = len(group)
        # Sum of call durations (missing values treated as 0).
        total_duration = group["duration_minutes"].fillna(0).sum()
        # Sum of call costs (missing values treated as 0).
        total_cost = group["computed_cost"].fillna(0).sum()
        # Fraction of this employee's calls that were International.
        intl_share = (group["call_classification"] == CALL_CLASS_INTERNATIONAL).sum() / total_calls
        # Fraction that were External (local, off-PBX).
        ext_share = (group["call_classification"] == CALL_CLASS_EXTERNAL).sum() / total_calls
        # 5-number feature vector: call count, average call duration, total
        # cost, International share, External share.
        vectors[employee_id] = [float(total_calls), total_duration / total_calls, float(total_cost), intl_share, ext_share]
    return vectors


def _scale(train: np.ndarray, other: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Scale `other` using `train`'s own mean/std (never the reverse) so no
    information about a held-out split leaks into how features are scaled."""
    # Compute per-feature mean/std from the TRAINING split only.
    mean, std = train.mean(axis=0), train.std(axis=0)
    # Avoid divide-by-zero for any feature with zero variance.
    std[std == 0] = 1.0
    # Apply the same mean/std to both the training split and the other
    # (e.g. validation) split.
    return (train - mean) / std, (other - mean) / std


def _cluster_metrics(features: np.ndarray, labels: np.ndarray) -> dict | None:
    # These metrics need at least 2 distinct clusters, and more samples
    # than clusters — otherwise they're undefined/meaningless.
    if len(set(labels)) < 2 or len(features) <= len(set(labels)):
        return None
    # silhouette: how well-separated clusters are (higher = better, -1..1).
    # davies_bouldin: average cluster similarity (lower = better).
    # calinski_harabasz: between/within-cluster variance ratio (higher =
    # better).
    return {
        "silhouette": float(silhouette_score(features, labels)),
        "davies_bouldin": float(davies_bouldin_score(features, labels)),
        "calinski_harabasz": float(calinski_harabasz_score(features, labels)),
    }


def _cv_evaluate(features: np.ndarray, n_clusters: int) -> dict | None:
    # Repeated K-Fold splitter for this candidate k.
    rkf = RepeatedKFold(n_splits=CV_SPLITS, n_repeats=CV_REPEATS, random_state=RANDOM_STATE)
    # Per-fold metric accumulators, averaged at the end.
    train_sil, val_sil, train_db, val_db, train_ch, val_ch, inertias = [], [], [], [], [], [], []
    for train_idx, val_idx in rkf.split(features):
        # Skip folds too small to even form n_clusters groups.
        if len(train_idx) <= n_clusters or len(val_idx) <= n_clusters:
            continue
        # Scale both splits using only the training split's mean/std.
        train_scaled, val_scaled = _scale(features[train_idx], features[val_idx])
        # Fit KMeans on the training split (n_init=10 runs the algorithm 10
        # times with different centroid seeds, keeping the best result).
        model = KMeans(n_clusters=n_clusters, n_init=10, random_state=RANDOM_STATE)
        # fit_predict: fit the model AND return cluster labels for the
        # training data in one call.
        train_labels = model.fit_predict(train_scaled)
        # predict: assign the held-out validation rows to the nearest
        # already-fitted centroid (no re-fitting).
        val_labels = model.predict(val_scaled)

        # Compute clustering-quality metrics on each split.
        train_m = _cluster_metrics(train_scaled, train_labels)
        val_m = _cluster_metrics(val_scaled, val_labels)
        # Skip this fold if either split's metrics were undefined.
        if train_m is None or val_m is None:
            continue
        # Collect this fold's metrics into the running lists.
        train_sil.append(train_m["silhouette"])
        val_sil.append(val_m["silhouette"])
        train_db.append(train_m["davies_bouldin"])
        val_db.append(val_m["davies_bouldin"])
        train_ch.append(train_m["calinski_harabasz"])
        val_ch.append(val_m["calinski_harabasz"])
        # inertia_: KMeans' own sum-of-squared-distances-to-centroid metric
        # (lower = tighter clusters) on the training split.
        inertias.append(float(model.inertia_))
    # No fold produced usable metrics for this k.
    if not val_sil:
        return None
    # Average every metric across folds into one result dict for this k.
    return {
        "n_clusters": n_clusters,
        "train_silhouette_mean": float(np.mean(train_sil)),
        "val_silhouette_mean": float(np.mean(val_sil)),
        "val_silhouette_std": float(np.std(val_sil)),
        "silhouette_gap": float(np.mean(train_sil) - np.mean(val_sil)),
        "train_davies_bouldin_mean": float(np.mean(train_db)),
        "val_davies_bouldin_mean": float(np.mean(val_db)),
        "train_calinski_harabasz_mean": float(np.mean(train_ch)),
        "val_calinski_harabasz_mean": float(np.mean(val_ch)),
        "inertia_mean": float(np.mean(inertias)),
        "folds_used": len(val_sil),
    }


def grid_search(features: np.ndarray) -> list[dict]:
    """Grid-searches CLUSTER_GRID via repeated K-Fold CV, ranked by held-out
    silhouette (higher = better-separated clusters on unseen employees)."""
    # Evaluate every candidate k in CLUSTER_GRID, dropping any that
    # produced no usable folds.
    results = [r for r in (_cv_evaluate(features, k) for k in CLUSTER_GRID) if r is not None]
    # Sort best-first by held-out silhouette score.
    results.sort(key=lambda r: r["val_silhouette_mean"], reverse=True)
    return results


def _diagnose(result: dict) -> str:
    # Very low held-out silhouette -> clusters barely separate at all.
    if result["val_silhouette_mean"] < 0.15:
        return "underfitting (clusters barely separated even on held-out data)"
    # Large gap between training and held-out silhouette -> looks good on
    # training data but doesn't generalise to new employees.
    if result["silhouette_gap"] > 0.15:
        return "overfitting (cluster separation doesn't hold up on held-out employees)"
    # Otherwise, training and held-out silhouette are close together.
    return "good fit (training and held-out silhouette are close)"


def evaluate(features: np.ndarray) -> list[dict]:
    """Full grid-search + repeated-K-Fold-CV report across CLUSTER_GRID.
    Diagnostic only — production always uses CLUSTERS (see module
    docstring). Returns [] (with a printed note) when there's too little
    data for CV to be meaningful."""
    # Too few employees for CV folds to mean anything — skip grid search.
    if len(features) < MIN_CV_SAMPLES:
        print(f"  [skip CV] only {len(features)} employees (< {MIN_CV_SAMPLES}); "
              f"using fixed CLUSTERS={CLUSTERS} with no grid search.")
        return []
    # Run the grid search across every candidate k.
    results = grid_search(features)
    if not results:
        print("  [skip CV] no config produced valid folds (too few employees per fold).")
        return []
    print(f"  Grid search: {len(results)} k-value(s) x {CV_REPEATS}x{CV_SPLITS}-fold repeated CV")
    # Print one summary line per candidate k, flagging whichever one
    # matches the fixed CLUSTERS constant actually used in production.
    for r in results:
        marker = "  <- CLUSTERS in use" if r["n_clusters"] == CLUSTERS else ""
        print(f"    k={r['n_clusters']}: val_silhouette={r['val_silhouette_mean']:.4f} "
              f"(+/-{r['val_silhouette_std']:.4f}) train_silhouette={r['train_silhouette_mean']:.4f} "
              f"gap={r['silhouette_gap']:.4f} davies_bouldin(train/val)="
              f"{r['train_davies_bouldin_mean']:.3f}/{r['val_davies_bouldin_mean']:.3f} "
              f"calinski_harabasz(train/val)={r['train_calinski_harabasz_mean']:.1f}/"
              f"{r['val_calinski_harabasz_mean']:.1f} folds={r['folds_used']}{marker}")
    # Find the CLUSTERS=3 result specifically (may not be the top-ranked
    # one) and print its own fit diagnosis.
    in_use = next((r for r in results if r["n_clusters"] == CLUSTERS), None)
    if in_use is not None:
        print(f"  CLUSTERS={CLUSTERS} (in production use): {_diagnose(in_use)}")
    # Top-ranked result overall (may differ from CLUSTERS).
    best = results[0]
    if best["n_clusters"] != CLUSTERS:
        print(f"  Note: k={best['n_clusters']} scores higher on held-out silhouette than "
              f"CLUSTERS={CLUSTERS}, but CLUSTERS stays fixed for the 3-tier label scheme.")
    return results


def run(backend: Backend) -> int:
    """Returns the number of usage_profiles rows written/updated."""
    # Build each employee's feature vector from their usage events.
    vectors_by_employee = _employee_usage_vectors(backend)
    # Keep a stable, ordered list of employee_ids matching the vectors below.
    employee_ids = list(vectors_by_employee)
    # Not enough employees to even form CLUSTERS groups.
    if len(employee_ids) < CLUSTERS:
        return 0

    # Turn the dict of vectors into a plain list, then a numpy matrix, in
    # the same order as employee_ids.
    vectors = [vectors_by_employee[eid] for eid in employee_ids]
    features = np.array(vectors)

    # Print the diagnostic grid-search report (doesn't affect what follows).
    evaluate(features)

    # Standardize so cost (large KES figures) doesn't drown out the
    # call-count/share features.
    mean, std = features.mean(axis=0), features.std(axis=0)
    std[std == 0] = 1.0
    scaled = (features - mean) / std

    # Fit the production model with the fixed CLUSTERS=3, and get each
    # employee's cluster assignment.
    model = KMeans(n_clusters=CLUSTERS, n_init=10, random_state=RANDOM_STATE)
    labels = model.fit_predict(scaled)

    # Rank clusters by centroid total_cost (index 2 of the unscaled feature
    # vector) so labels read low->high regardless of KMeans' arbitrary
    # cluster numbering.
    centroid_cost = {}
    for cluster_id in range(CLUSTERS):
        # Every employee's total_cost (vectors[i][2]) whose assigned label
        # matches this cluster_id.
        members = [vectors[i][2] for i in range(len(vectors)) if labels[i] == cluster_id]
        # Average cost for this cluster (0 if somehow empty).
        centroid_cost[cluster_id] = sum(members) / len(members) if members else 0.0
    # Cluster ids sorted by ascending average cost.
    ranked = sorted(centroid_cost, key=lambda c: centroid_cost[c])
    # Map each cluster_id to a human label ("low_usage"/"moderate_usage"/
    # "high_usage") based on its rank in the sorted order.
    label_for_cluster = {cluster_id: CLUSTER_LABELS[rank] for rank, cluster_id in enumerate(ranked)}

    updated = 0
    # Walk every employee alongside their assigned cluster label index.
    for employee_id, label_idx in zip(employee_ids, labels):
        # Translate the numeric cluster id into its human-readable label.
        cluster_label = label_for_cluster[label_idx]
        # Check whether this employee already has a usage_profiles row.
        existing = backend.execute(
            "SELECT profile_id FROM usage_profiles WHERE employee_id = ?", (employee_id,)
        ).fetchone()
        if existing:
            # Update the existing row's label/timestamp.
            backend.execute(
                "UPDATE usage_profiles SET cluster_label = ?, updated_at = ? WHERE employee_id = ?",
                (cluster_label, now_str(), employee_id),
            )
        else:
            # Insert a brand new row with a fresh UUID.
            backend.execute(
                """INSERT INTO usage_profiles (profile_id, employee_id, cluster_label, updated_at)
                   VALUES (?, ?, ?, ?)""",
                (new_id(), employee_id, cluster_label, now_str()),
            )
        updated += 1
    # Persist all inserts/updates.
    backend.commit()
    return updated


def main() -> None:
    # Run usage profiling against every currently-reachable backend,
    # printing a one-line summary each.
    for backend in open_backend_connections():
        print(f"[{backend.name}] KMeans:")
        updated = run(backend)
        print(f"[{backend.name}] KMeans: {updated} employee usage profile(s) updated.")


# Only run main() when this file is executed directly, not when imported.
if __name__ == "__main__":
    main()
