#!/usr/bin/env python3
"""Anomaly detection (Isolation Forest) — standalone batch job.

Fits over every eligible historical usage_events row and inserts an
anomaly_flags row for the few the model scores as clearly anomalous.

What is scored: paid calls only — local (External) and International —
that are attributed to an employee and not carved out via
excluded_from_anomaly_detection. Internal extension-to-extension calls are
free, so however long one runs it is never an anomaly worth reviewing, and
they outnumber paid calls about five to one: scoring them only buries the
calls that cost money.

What a call is judged on: how long it lasted and what it costs at list
price (billing.py's own pricing, so a long call to an expensive country
stands out further than a long local one). Only calls that are unusually
long or unusually expensive are flagged — never one that is merely short.

How many are flagged: the model is asked for the most unusual
CONTAMINATION share of paid calls (0.5%, a couple of dozen in a typical
two months of traffic — a list a person can actually review), and a flag
is only stored when its score clears MIN_ANOMALY_SCORE, so borderline
calls are dropped rather than shown as low-severity noise. Of those, only
the MAX_FLAGS (15) highest-scoring are kept.

Safe to run frequently (e.g. every 4 hours via cron/systemd timer, unlike
usage_profiling and forecasting which change slowly). Each run refits on
everything and brings the open flags in line with the new fit: new
anomalies are added, an open flag the model no longer supports is removed,
and a flag someone has already resolved is kept as review history.

Run standalone:
    python anomaly_detection.py

Extensions 256 and 400 (ANOMALY_EXCLUDED_EXTENSIONS in both backends'
constants.py/Constants.cs) are permanently excluded from anomaly detection:
call-ingestion already sets usage_events.excluded_from_anomaly_detection
once, at ingest time — this scorer simply respects that flag rather than
re-deriving it.

Model selection: IsolationForest is unsupervised (no ground-truth "this
event really was anomalous" label exists anywhere in the schema), so
there's nothing to compute accuracy/precision/recall against — doing so
would mean scoring the model against its own output, which is circular
and would just report near-perfect numbers that mean nothing. Instead,
evaluate() below grid-searches max_samples (contamination is a policy
choice — how many calls are worth a reviewer's time — not something the
data can pick: mean decision_function always rises as contamination
falls, so a search over it just returns the smallest value offered)
using repeated K-Fold CV (plain, not stratified — stratification needs a
class label, which doesn't exist here) and reports the metrics that are
actually meaningful for an unsupervised detector: mean decision_function
separation and predicted anomaly rate, each on the training fold vs a
held-out fold, so a train/held-out gap still surfaces over/underfitting
the same way a train/test error gap would for a supervised model.
scikit-learn's IsolationForest has no native early_stopping parameter;
_fit_with_early_stopping below reproduces the idea with warm_start=True,
growing the forest in small increments and stopping once the held-out
score stops improving for EARLY_STOPPING_PATIENCE steps in a row.
"""
# json: used to serialize the per-flag "contributing_features" debug blob.
import json

# numpy: array math (the feature matrix, score averaging, etc).
import numpy as np
# pandas: DataFrame handling of the SQL query result + timestamp parsing.
import pandas as pd
# IsolationForest: the anomaly-detection model itself.
from sklearn.ensemble import IsolationForest
# ParameterGrid: expands PARAM_GRID into every combination to try;
# RepeatedKFold: the cross-validation splitter used during grid search.
from sklearn.model_selection import ParameterGrid, RepeatedKFold

# billing: the one place a call is priced — used here for each call's list
# price, the model's second feature.
import billing
# Shared DB wrapper type/helpers, plus the two paid-call classification
# labels (the only calls that are scored).
from common import Backend, CALL_CLASS_EXTERNAL, CALL_CLASS_INTERNATIONAL, new_id, now_str, open_backend_connections

CONTAMINATION = 0.005  # share of paid calls treated as anomalous: the most unusual 0.5%
# A flag is stored only at or above this 0-1 anomaly score. 0.5 is the
# model's own anomaly boundary, and the calls sitting right on it are the
# borderline ones — indistinguishable from the next few hundred the model
# left alone — so they are dropped rather than shown as low-severity
# noise. The UI grades what is stored as medium (0.52+) or high (0.55+);
# see Frontend/src/lib/anomaly-severity.ts.
MIN_ANOMALY_SCORE = 0.52
# The most flags a run leaves standing: the highest-scoring calls that
# clear every test above. A review list is only useful if someone can get
# through it, so past this the weaker flags are dropped however much
# traffic there is.
MAX_FLAGS = 15
MIN_EVENTS = 20  # below this, Isolation Forest has too little data to be meaningful
RANDOM_STATE = 20260912  # fixed seed so grid search / model fits are reproducible run to run

# --- Hyperparameter search space ------------------------------------------
# Every combination of these three params is tried during grid_search().
PARAM_GRID = {
    "max_samples": [0.5, 0.75, 1.0],
    # Both features, always: with only two, a tree built on a subset would
    # be looking at duration alone or price alone.
    "max_features": [1.0],
    "contamination": [CONTAMINATION],
}
CV_SPLITS = 5  # k in k-fold
CV_REPEATS = 2  # how many times the k-fold split is repeated with different shuffles
MIN_CV_FOLD_SIZE = 30  # skip CV/grid search below this many eligible events

# --- Early stopping (via warm_start; IsolationForest has no built-in early
# stopping) ------------------------------------------------------------
EARLY_STOPPING_STEP = 20  # trees added per increment
EARLY_STOPPING_MAX_ESTIMATORS = 300  # hard ceiling on forest size
EARLY_STOPPING_PATIENCE = 3  # consecutive non-improving increments before stopping
EARLY_STOPPING_TOLERANCE = 1e-3  # minimum improvement to count as "still improving"

# SQL pulling every usage_event eligible for anomaly scoring: a paid call
# (local or international — internal calls are free and never scored),
# successfully attributed to an employee, and not carved out via the
# excluded flag.
_EVENTS_SQL = f"""
    SELECT event_id, duration_minutes, destination, occured_at, call_classification
    FROM usage_events
    WHERE attribution_state = 'attributed'
      AND excluded_from_anomaly_detection = FALSE
      AND call_classification IN ('{CALL_CLASS_EXTERNAL}', '{CALL_CLASS_INTERNATIONAL}')
"""


def _list_price(row: pd.Series, billing_settings: dict, intl_rates: dict[str, float]) -> float:
    """What the call costs at list price, in KES, priced by billing.py from
    its duration, destination and the time it started. usage_events carries
    no per-call cost of its own (computed_cost is always 0)."""
    occured_at = pd.to_datetime(row["occured_at"], errors="coerce")
    orig_time = occured_at.strftime("%H:%M:%S") if pd.notnull(occured_at) else None
    list_cost, _ = billing.compute_call_costs(
        row["call_classification"], float(row["duration_minutes"] or 0.0), row["destination"], orig_time,
        billing_settings, intl_rates,
    )
    return list_cost


def _event_features(row: pd.Series) -> list[float]:
    # This event's feature vector: how long the call lasted, and what it
    # costs at list price.
    return [float(row["duration_minutes"] or 0.0), float(row["list_cost_kes"])]


def _fit_with_early_stopping(train: np.ndarray, val: np.ndarray, params: dict, random_state: int):
    """Grow an IsolationForest EARLY_STOPPING_STEP trees at a time (warm_start),
    tracking mean decision_function on the held-out `val` split, and stop once
    it hasn't improved by more than EARLY_STOPPING_TOLERANCE for
    EARLY_STOPPING_PATIENCE increments in a row. Returns
    (best_n_estimators, best_val_score, fitted_model_at_best_n_estimators)."""
    # Start an IsolationForest with 0 trees; warm_start=True means calling
    # .fit() again later ADDS trees rather than refitting from scratch.
    model = IsolationForest(n_estimators=0, warm_start=True, random_state=random_state, **params)
    # Track the best held-out score seen so far, and the tree-count/model
    # state that produced it.
    best_score = -np.inf
    best_n = EARLY_STOPPING_STEP
    best_state = None
    # How many consecutive increments in a row failed to improve on best_score.
    no_improve = 0
    # Current tree count, grown by EARLY_STOPPING_STEP each loop iteration.
    n = EARLY_STOPPING_STEP
    while n <= EARLY_STOPPING_MAX_ESTIMATORS:
        # Grow the forest to `n` trees (warm_start makes this additive).
        model.n_estimators = n
        model.fit(train)
        # Score this forest on the held-out validation split; higher =
        # better inlier/outlier separation.
        val_score = float(np.mean(model.decision_function(val)))
        if val_score > best_score + EARLY_STOPPING_TOLERANCE:
            # Meaningful improvement — remember it, and reset the patience
            # counter.
            best_score, best_n, no_improve = val_score, n, 0
            # Re-fit a standalone (non-warm-start) model at this exact size
            # so `best_state` is a clean, independent model to return.
            best_state = IsolationForest(n_estimators=n, random_state=random_state, **params).fit(train)
        else:
            # No improvement this round.
            no_improve += 1
            # Enough consecutive non-improving rounds -> stop growing early.
            if no_improve >= EARLY_STOPPING_PATIENCE:
                break
        # Grow by another EARLY_STOPPING_STEP trees next iteration.
        n += EARLY_STOPPING_STEP
    return best_n, best_score, best_state


def _cv_evaluate(features: np.ndarray, params: dict) -> dict | None:
    """Repeated K-Fold CV for one hyperparameter combination. For each fold,
    early-stop-fits on the training split and scores both that training
    split and the held-out split, so the train-vs-held-out gap in mean
    decision_function (and in predicted anomaly rate) is this model's
    equivalent of a training-error/testing-error gap."""
    # Build the repeated K-Fold splitter: CV_SPLITS folds, repeated
    # CV_REPEATS times with different shuffles.
    rkf = RepeatedKFold(n_splits=CV_SPLITS, n_repeats=CV_REPEATS, random_state=RANDOM_STATE)
    # Accumulators for each fold's metrics, averaged together at the end.
    train_scores, val_scores, train_rates, val_rates, n_estimators_used = [], [], [], [], []
    # rkf.split() yields (train_indices, val_indices) for each of the
    # CV_SPLITS * CV_REPEATS folds.
    for train_idx, val_idx in rkf.split(features):
        # Slice the feature matrix into this fold's train/validation rows.
        train, val = features[train_idx], features[val_idx]
        # Fit (with early stopping) on the training split, scoring against
        # the validation split as we grow the forest.
        best_n, _, model = _fit_with_early_stopping(train, val, params, RANDOM_STATE)
        # Early stopping never found an improving model — skip this fold.
        if model is None:
            continue
        # Mean decision_function on the training split (how well the model
        # separates inliers/outliers on data it was fit on).
        train_scores.append(float(np.mean(model.decision_function(train))))
        # Same, but on the held-out validation split.
        val_scores.append(float(np.mean(model.decision_function(val))))
        # Fraction of training rows predicted as anomalies (predict()
        # returns -1 for anomaly, 1 for normal).
        train_rates.append(float(np.mean(model.predict(train) == -1)))
        # Same, on the validation split.
        val_rates.append(float(np.mean(model.predict(val) == -1)))
        # Remember how many trees this fold's best model ended up with.
        n_estimators_used.append(best_n)
    # No fold produced a usable model — nothing to report.
    if not val_scores:
        return None
    # Average every metric across folds and package them into one result
    # dict for this hyperparameter combination.
    return {
        "params": params,
        "train_score_mean": float(np.mean(train_scores)),
        "val_score_mean": float(np.mean(val_scores)),
        "val_score_std": float(np.std(val_scores)),
        "score_gap": float(np.mean(train_scores) - np.mean(val_scores)),
        "train_anomaly_rate_mean": float(np.mean(train_rates)),
        "val_anomaly_rate_mean": float(np.mean(val_rates)),
        "anomaly_rate_gap": float(np.mean(train_rates) - np.mean(val_rates)),
        "n_estimators": int(round(float(np.mean(n_estimators_used)))),
    }


def grid_search(features: np.ndarray) -> list[dict]:
    """Grid-searches PARAM_GRID via repeated K-Fold CV, ranked by held-out
    decision_function score (higher = more confident inlier/outlier
    separation on unseen data) with ties broken toward the smaller
    train/held-out gap (less overfitting)."""
    # Evaluate every hyperparameter combination in PARAM_GRID, dropping any
    # that returned None (too little data for that combination's folds).
    results = [r for r in (_cv_evaluate(features, p) for p in ParameterGrid(PARAM_GRID)) if r is not None]
    # Sort best-first: primarily by validation score (descending, via
    # reverse=True), with ties broken by the smallest train/val gap
    # (negated so "smaller gap" sorts as "larger" under reverse=True).
    results.sort(key=lambda r: (r["val_score_mean"], -abs(r["score_gap"])), reverse=True)
    return results


def _diagnose(result: dict) -> str:
    # Negative held-out score -> the model can barely separate inliers from
    # outliers even on data it wasn't fit on.
    if result["val_score_mean"] < 0:
        return "underfitting (poor inlier/outlier separation even on held-out data)"
    # Large train/held-out gap in either score or anomaly rate -> the model
    # looks good on training data but doesn't generalise.
    if result["score_gap"] > 0.05 or abs(result["anomaly_rate_gap"]) > 0.03:
        return "overfitting (training separation/anomaly-rate doesn't hold up on held-out data)"
    # Otherwise, training and held-out metrics track each other closely.
    return "good fit (training and held-out metrics are close)"


def evaluate(features: np.ndarray) -> dict | None:
    """Full grid-search + repeated-K-Fold-CV evaluation report. Returns None
    (with a printed note) when there's too little data for CV to be
    meaningful."""
    # Too few events for cross-validation folds to be meaningful — skip
    # grid search entirely and let the caller fall back to defaults.
    if len(features) < MIN_CV_FOLD_SIZE:
        print(f"  [skip CV] only {len(features)} eligible events (< {MIN_CV_FOLD_SIZE}); "
              f"using default params with no grid search.")
        return None
    # Run the full grid search (every param combo x every CV fold).
    results = grid_search(features)
    if not results:
        return None
    # Best-ranked result is first (grid_search already sorted best-first).
    best = results[0]
    print(f"  Grid search: {len(results)} config(s) x {CV_REPEATS}x{CV_SPLITS}-fold repeated CV")
    # Print every combination's metrics, one line each.
    for r in results:
        print(f"    {r['params']} -> val_score={r['val_score_mean']:.4f} (+/-{r['val_score_std']:.4f}) "
              f"train_score={r['train_score_mean']:.4f} gap={r['score_gap']:.4f} "
              f"anomaly_rate train={r['train_anomaly_rate_mean']:.3f} val={r['val_anomaly_rate_mean']:.3f} "
              f"n_estimators(early-stopped)={r['n_estimators']}")
    # Print the winning combination plus a plain-English fit diagnosis.
    print(f"  Best: {best['params']} n_estimators={best['n_estimators']} -> {_diagnose(best)}")
    return best


def run(backend: Backend) -> int:
    """Returns the number of new anomaly_flags rows created."""
    # Run _EVENTS_SQL against this backend, returning a DataFrame.
    events = backend.read_sql(_EVENTS_SQL)
    # Not enough eligible events for the model to be meaningful — bail out.
    if len(events) < MIN_EVENTS:
        return 0

    # Price every call at list, from the same rate tables billing.py uses.
    billing_settings = billing._load_billing_settings(backend)
    intl_rates = billing._load_international_rates(backend)
    events["list_cost_kes"] = [_list_price(row, billing_settings, intl_rates) for _, row in events.iterrows()]

    # Build the full feature matrix, one row per event.
    features = np.array([_event_features(row) for _, row in events.iterrows()])

    # Try to find the best hyperparameters via grid search + CV.
    best = evaluate(features)
    if best is not None:
        # Use the winning combination's params/tree count.
        params = best["params"]
        n_estimators = best["n_estimators"]
    else:
        # Too little data for CV — fall back to fixed defaults.
        params = {"max_samples": 1.0, "max_features": 1.0, "contamination": CONTAMINATION}
        n_estimators = 200

    # Fit the final model on ALL eligible events (not just a CV fold) using
    # the chosen hyperparameters.
    model = IsolationForest(n_estimators=n_estimators, random_state=RANDOM_STATE, **params)
    model.fit(features)
    raw_scores = model.decision_function(features)  # higher = more normal
    predictions = model.predict(features)  # -1 = anomaly, 1 = normal

    # An isolation forest isolates anything rare, at either end. A flag is
    # for a call that ran long or cost a lot, so one has to sit above the
    # typical paid call on at least one of the two.
    typical_duration = float(np.median(features[:, 0]))
    typical_price = float(np.median(features[:, 1]))

    # event_id -> (anomaly_score, contributing_features) for every call
    # this fit flags.
    flagged: dict[str, tuple[float, str]] = {}
    # Walk every event alongside its model score/prediction in lockstep.
    for (_, event), raw_score, prediction in zip(events.iterrows(), raw_scores, predictions):
        if prediction != -1:
            continue
        duration, price = float(event["duration_minutes"] or 0.0), float(event["list_cost_kes"])
        if duration <= typical_duration and price <= typical_price:
            continue
        # decision_function is roughly bounded in [-0.5, 0.5]; fold into a
        # 0-1 "how anomalous" score (0.5 - raw_score flips "higher = more
        # normal" into "higher = more anomalous", then clamp to [0, 1]).
        anomaly_score = round(min(1.0, max(0.0, 0.5 - float(raw_score))), 4)
        # Borderline: the model put it just over its boundary. Not worth a
        # reviewer's time.
        if anomaly_score < MIN_ANOMALY_SCORE:
            continue
        # Small JSON blob recording why this event was flagged, stored
        # alongside the flag for later inspection.
        flagged[event["event_id"]] = (anomaly_score, json.dumps({
            "reason": "isolation_forest",
            "duration_minutes": round(duration, 2),
            "list_cost_kes": price,
            "typical_duration_minutes": round(typical_duration, 2),
            "typical_list_cost_kes": round(typical_price, 2),
            "call_classification": event["call_classification"],
            "model_score": round(float(raw_score), 4),
        }))

    # Keep only the strongest MAX_FLAGS, so the review list stays short.
    if len(flagged) > MAX_FLAGS:
        strongest = sorted(flagged.items(), key=lambda item: item[1][0], reverse=True)[:MAX_FLAGS]
        print(f"  {len(flagged)} calls cleared the score threshold; keeping the {MAX_FLAGS} strongest.")
        flagged = dict(strongest)

    # Bring the stored flags in line with this fit. An open flag the model
    # no longer supports (including every flag an earlier version raised on
    # an internal call) is removed; a resolved one stays as review history.
    existing = backend.execute("SELECT event_id, resolved_at FROM anomaly_flags").fetchall()
    stale = [event_id for event_id, resolved_at in existing if resolved_at is None and event_id not in flagged]
    for event_id in stale:
        backend.execute("DELETE FROM anomaly_flags WHERE event_id = ? AND resolved_at IS NULL", (event_id,))
    if stale:
        print(f"  Removed {len(stale)} open flag(s) the model no longer supports.")

    already_flagged = {event_id for event_id, _ in existing} - set(stale)
    created = 0
    for event_id, (anomaly_score, contributing_features) in flagged.items():
        # Never double-flag an event that still has a flag.
        if event_id in already_flagged:
            continue
        backend.execute(
            """INSERT INTO anomaly_flags (flag_id, event_id, anomaly_score, contributing_features, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (new_id(), event_id, anomaly_score, contributing_features, now_str()),
        )
        created += 1
    # Persist the removals and the newly inserted flags.
    backend.commit()
    return created


def main() -> None:
    # Run anomaly detection against every currently-reachable backend,
    # printing a one-line summary each.
    for backend in open_backend_connections():
        print(f"[{backend.name}] Isolation Forest:")
        created = run(backend)
        print(f"[{backend.name}] Isolation Forest: {created} new anomaly flag(s) created.")


# Only run main() when this file is executed directly, not when imported.
if __name__ == "__main__":
    main()
