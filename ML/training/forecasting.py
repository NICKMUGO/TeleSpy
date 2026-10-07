#!/usr/bin/env python3
"""Spend forecasting (Prophet, falling back to a log-linear trend) —
standalone batch job.

Forecasts next-period spend per department from its usage_summaries
history and upserts a forecast_results row keyed by (department_id,
period). Monthly totals only change once a month, so this is meant to run
monthly via cron/systemd timer — running it more often than the
usage_summaries data actually changes just repeats the same forecast.

Run standalone:
    python forecasting.py

Partial months: the call data rarely starts on the 1st or ends on the
last day of a month (the first month of data, and the month still in
progress whenever this runs). A partial month's total is that much
smaller than a full month's, so left as-is it reads as a collapse in
spend and drags the forecast down with it. _full_month_series() scales
each partial month up to its full-month equivalent (same daily rate, all
the month's days) before any model sees it, so every forecast is for a
whole month of the whole department.

Model selection: this is regression on a time series, so accuracy/
precision/recall don't apply (those are classification metrics) — MAE,
RMSE and MAPE are used instead. CV can't be a random/stratified K-Fold
either: shuffling a monthly series would let future months leak into the
training set for predicting the past. evaluate() below instead does
walk-forward (expanding-window) CV — train on the first i months, predict
month i+1, slide forward — across every department with enough history,
which is the time-series equivalent of repeated CV (each department/step
is one fold). changepoint_prior_scale and seasonality_prior_scale are
Prophet's actual regularization knobs (they penalize trend-changepoint and
seasonality flexibility the same way an L2 penalty shrinks coefficients);
grid_search() searches over both and evaluate() reports in-sample
(training) MAE against walk-forward (held-out) MAE/RMSE/MAPE so a
train/test gap surfaces over/underfitting the same way it would for any
other regressor.
"""
# calendar: number of days in a month, for partial-month scaling.
import calendar

# numpy: array math + the naive fallback's log-linear regression.
import numpy as np
# pandas: builds the (ds, y) DataFrame Prophet expects.
import pandas as pd

# Shared DB wrapper/helpers.
from common import Backend, new_id, now_str, open_backend_connections

MIN_MONTHS = 2  # minimum history to attempt any forecast at all (incl. naive fallback)
MIN_CV_MONTHS = 4  # minimum history for a department to contribute to walk-forward CV
MIN_TRAIN_MONTHS_FOR_CV = 3  # each walk-forward fold needs >=3 training months: with only 2,
# any model (Prophet included) fits a perfect line through them and reports ~0 training
# error by construction, not because it generalizes well — that's a degenerate fit, not a
# real training-error reading, so folds below this are skipped.

# A month with less than this share of its days covered by call data is
# dropped rather than scaled up: a day or two extrapolated to a whole month
# is noise, not a reading.
MIN_MONTH_COVERAGE = 0.1

# --- Regularization search space (Prophet's changepoint/seasonality priors)
CHANGEPOINT_PRIOR_GRID = [0.01, 0.05, 0.5]  # lower = stiffer trend = more regularized
SEASONALITY_PRIOR_GRID = [0.1, 1.0, 10.0]  # lower = dampened seasonality = more regularized
DEFAULT_PROPHET_PARAMS = {"changepoint_prior_scale": 0.05, "seasonality_prior_scale": 10.0}  # Prophet's own defaults

# SQL: one row per (month, total cost across the department) for a given
# department_id, summed across every employee in it.
_DEPARTMENT_MONTHLY_SQL = """
    SELECT us.month AS month, SUM(us.total_cost) AS total_cost
    FROM usage_summaries us
    JOIN employees e ON e.employee_id = us.employee_id
    WHERE e.department_id = ?
    GROUP BY us.month
"""


# SQL: the first and last moment any call was recorded — the span of days
# the cost data actually covers.
_DATA_COVERAGE_SQL = "SELECT MIN(occured_at), MAX(occured_at) FROM usage_events"


def _data_coverage(backend: Backend):
    """(first day, last day) the call data covers, as dates — or None if
    there are no usage events to tell from."""
    first, last = backend.execute(_DATA_COVERAGE_SQL).fetchone()
    if first is None or last is None:
        return None
    # psycopg2 hands back datetimes, sqlite3 strings; pandas reads both.
    return pd.to_datetime(first).date(), pd.to_datetime(last).date()


def _month_coverage(month: str, coverage) -> tuple[int, int]:
    """(days of `month` the data covers, days in `month`). With no
    coverage information every month counts as fully covered."""
    year, mo = (int(part) for part in month.split("-"))
    days_in_month = calendar.monthrange(year, mo)[1]
    if coverage is None:
        return days_in_month, days_in_month
    first_day, last_day = coverage
    # Clamp the data's span to this month: day-of-month it starts and ends
    # on within the month.
    start = first_day.day if (first_day.year, first_day.month) == (year, mo) else 1
    end = last_day.day if (last_day.year, last_day.month) == (year, mo) else days_in_month
    return max(0, end - start + 1), days_in_month


def _full_month_series(months: list[str], values: list[float], coverage) -> tuple[list[str], list[float]]:
    """Scales each partially-covered month's total up to its full-month
    equivalent (total / days covered * days in month), and drops a month
    covered too thinly to scale (see MIN_MONTH_COVERAGE). Fully-covered
    months pass through unchanged."""
    full_months, full_values = [], []
    for month, value in zip(months, values):
        covered, days_in_month = _month_coverage(month, coverage)
        if covered < days_in_month * MIN_MONTH_COVERAGE:
            continue
        full_months.append(month)
        full_values.append(value * days_in_month / covered)
    return full_months, full_values


def _next_month_key(month: str) -> str:
    # Split "YYYY-MM" into integer year and month parts.
    year, mo = (int(part) for part in month.split("-"))
    # Advance one month.
    mo += 1
    # Roll over into January of the next year if we passed December.
    if mo > 12:
        mo = 1
        year += 1
    # Reformat back into zero-padded "YYYY-MM".
    return f"{year:04d}-{mo:02d}"


def _forecast_naive(values: list[float]) -> dict:
    """Log-linear trend forecast: fit a line in log-space, so the
    projected month-over-month change is multiplicative (this month is
    roughly last month times a constant factor) rather than a flat
    additive step — the same "seasonality mode: multiplicative" idea the
    design notes call for, without needing Prophet/cmdstan. Used whenever
    those aren't available, or there's only one data point (too little for
    a regression). 80% interval from the regression residuals' spread,
    matching Prophet's interval_width=0.80 below."""
    n = len(values)
    # Only one data point — can't fit a line, so just project it flat with
    # a +/-20% band as a rough confidence interval.
    if n == 1:
        point = values[0]
        return {"point": round(point, 2), "low": round(point * 0.8, 2), "high": round(point * 1.2, 2)}

    eps = 0.01  # avoid log(0) for a month with zero spend
    # Take the natural log of every value (floored at eps) — fitting a
    # straight line in log-space produces a multiplicative/exponential
    # trend once exponentiated back.
    log_values = [float(np.log(max(v, eps))) for v in values]
    # Time index: 0, 1, 2, ... one per month of history.
    t = list(range(n))
    # Means of t and log_values, needed for the least-squares slope formula.
    t_mean, y_mean = sum(t) / n, sum(log_values) / n
    # Least-squares slope numerator: sum of (t deviation * y deviation).
    numerator = sum((t[i] - t_mean) * (log_values[i] - y_mean) for i in range(n))
    # Least-squares slope denominator: sum of squared t deviations (guard
    # against 0 if all t were somehow identical).
    denominator = sum((t[i] - t_mean) ** 2 for i in range(n)) or 1.0
    # slope/intercept of the best-fit line through (t, log_values).
    slope = numerator / denominator
    intercept = y_mean - slope * t_mean

    # The line's fitted (predicted) log-value at each historical month.
    fitted = [intercept + slope * ti for ti in t]
    # Residuals: actual - fitted, one per historical month.
    residuals = [log_values[i] - fitted[i] for i in range(n)]
    # Degrees of freedom for the residual variance estimate (n - 2
    # parameters fit: slope and intercept), floored at 1.
    dof = max(1, n - 2)
    # Standard deviation of the residuals — how much actual values scatter
    # around the fitted line, used for the confidence interval below.
    residual_std = (sum(r ** 2 for r in residuals) / dof) ** 0.5

    # Predicted log-value for the NEXT month (t = n, one step past the
    # last historical month).
    log_next = intercept + slope * n
    z = 1.2816  # ~80% interval
    # Exponentiate back out of log-space to get the actual point forecast
    # and its confidence band.
    point = float(np.exp(log_next))
    low = float(np.exp(log_next - z * residual_std))
    high = float(np.exp(log_next + z * residual_std))
    return {"point": round(point, 2), "low": round(low, 2), "high": round(high, 2)}


def _fit_prophet(months: list[str], values: list[float], params: dict):
    """Fits Prophet on (months, values) with the given regularization
    params. Returns (fitted_model, in_sample_absolute_errors) — the
    in-sample errors are this walk-forward CV's "training error"."""
    # Imported here (not at module level) so this file still loads even if
    # Prophet/cmdstan isn't installed — only this function needs it.
    from prophet import Prophet

    # Prophet requires a DataFrame with exactly two columns: "ds" (dates)
    # and "y" (values). Build "YYYY-MM-01" dates for each month string.
    frame = pd.DataFrame({"ds": pd.to_datetime([f"{m}-01" for m in months]), "y": values})
    # Construct the model: multiplicative seasonality (trend scales with
    # level, not a fixed additive amount), no weekly/daily seasonality
    # (monthly data has neither), an 80% confidence interval, and the
    # regularization params passed in.
    model = Prophet(
        seasonality_mode="multiplicative",
        weekly_seasonality=False,
        daily_seasonality=False,
        interval_width=0.80,
        changepoint_prior_scale=params["changepoint_prior_scale"],
        seasonality_prior_scale=params["seasonality_prior_scale"],
    )
    # Fit the model on the historical (ds, y) data.
    model.fit(frame)
    # Predict on the SAME historical dates used for training — this is the
    # "in-sample" / training-set prediction.
    in_sample = model.predict(frame)
    # Absolute error between predicted (yhat) and actual (y) for every
    # historical month — this run's "training error" values.
    in_sample_errors = (in_sample["yhat"] - frame["y"]).abs().tolist()
    return model, in_sample_errors


def _prophet_next_month_point(model) -> dict:
    # Extend the model's own date range by one more month ("MS" = month
    # start frequency).
    future = model.make_future_dataframe(periods=1, freq="MS")
    # Predict yhat (point forecast) and its confidence bounds for every
    # date in `future`, including the new extra month.
    forecast = model.predict(future)
    # The last row is that new extra (next) month's forecast.
    last = forecast.iloc[-1]
    # Package it up, clamping at 0 (spend can't be negative) and rounding
    # to 2 decimal places.
    return {
        "point": round(max(0.0, float(last["yhat"])), 2),
        "low": round(max(0.0, float(last["yhat_lower"])), 2),
        "high": round(max(0.0, float(last["yhat_upper"])), 2),
    }


def _forecast_with_prophet(months: list[str], values: list[float], params: dict) -> dict:
    # Fit Prophet (discarding the in-sample errors here — not needed for a
    # plain forecast) and read off next month's point forecast.
    model, _ = _fit_prophet(months, values, params)
    return _prophet_next_month_point(model)


def _forecast_next_month(months: list[str], values: list[float], params: dict) -> dict:
    try:
        # Prefer Prophet if it's available and fits successfully.
        return _forecast_with_prophet(months, values, params)
    except Exception:  # noqa: BLE001 - cmdstan missing, fit failure, etc. — degrade, don't crash the batch job
        # Prophet unavailable or failed for this series — fall back to the
        # hand-rolled log-linear trend instead.
        return _forecast_naive(values)


def _walk_forward_evaluate(months: list[str], values: list[float], params: dict) -> dict | None:
    """Expanding-window walk-forward CV for one department's series: train
    on the first i months, predict month i+1, slide forward. Each step is
    one fold; every department contributes its own folds to grid_search's
    aggregate below."""
    n = len(values)
    # Not enough months of history for this department to contribute any
    # walk-forward folds.
    if n < MIN_CV_MONTHS:
        return None
    train_errors, test_abs_errors, test_pct_errors = [], [], []
    # Slide the training window forward: first fold trains on months
    # [0:MIN_TRAIN_MONTHS_FOR_CV] and predicts month MIN_TRAIN_MONTHS_FOR_CV,
    # next fold trains on one more month and predicts the next, etc.
    for i in range(MIN_TRAIN_MONTHS_FOR_CV, n):
        try:
            # Fit on everything up to (not including) month i.
            model, in_sample_errors = _fit_prophet(months[:i], values[:i], params)
            # Predict month i (the next one after the training window).
            pred = _prophet_next_month_point(model)["point"]
        except Exception:  # noqa: BLE001 - Prophet/cmdstan unavailable or fit failed for this fold
            continue
        # The real value for month i, to compare the prediction against.
        actual = values[i]
        # Training errors from this fold's fit (in-sample, on months < i).
        train_errors.extend(in_sample_errors)
        # Absolute error of this fold's held-out prediction.
        test_abs_errors.append(abs(pred - actual))
        # Percent error too, but only when actual isn't 0 (avoids
        # divide-by-zero for a month with no spend).
        if actual:
            test_pct_errors.append(abs(pred - actual) / abs(actual))
    # No fold produced a usable prediction for this department.
    if not test_abs_errors:
        return None
    return {
        "folds": len(test_abs_errors),
        "train_errors": train_errors,
        "test_abs_errors": test_abs_errors,
        "test_pct_errors": test_pct_errors,
    }


def _cv_evaluate(all_series: dict[str, tuple[list[str], list[float]]], params: dict) -> dict | None:
    # Pooled accumulators across every department's folds.
    train_errors, test_abs_errors, test_pct_errors, folds = [], [], [], 0
    # Run walk-forward CV per department and merge all their results
    # together into one pooled set of errors for this hyperparameter combo.
    for months, values in all_series.values():
        result = _walk_forward_evaluate(months, values, params)
        if result is None:
            continue
        train_errors.extend(result["train_errors"])
        test_abs_errors.extend(result["test_abs_errors"])
        test_pct_errors.extend(result["test_pct_errors"])
        folds += result["folds"]
    # No department produced any usable fold for this combo.
    if folds == 0:
        return None
    # Compute pooled MAE (mean absolute error), RMSE (root mean squared
    # error), and MAPE (mean absolute percentage error) across every fold.
    return {
        "params": params,
        "folds": folds,
        "train_mae": float(np.mean(train_errors)) if train_errors else None,
        "test_mae": float(np.mean(test_abs_errors)),
        "test_rmse": float(np.sqrt(np.mean([e ** 2 for e in test_abs_errors]))),
        "test_mape": float(np.mean(test_pct_errors)) * 100 if test_pct_errors else None,
    }


def grid_search(all_series: dict[str, tuple[list[str], list[float]]]) -> list[dict]:
    """Grid-searches (changepoint_prior_scale, seasonality_prior_scale) via
    walk-forward CV pooled across every eligible department, ranked by
    held-out RMSE (lower = better)."""
    results = []
    # Try every (changepoint_prior_scale, seasonality_prior_scale)
    # combination — a full grid, not a random sample.
    for cps in CHANGEPOINT_PRIOR_GRID:
        for sps in SEASONALITY_PRIOR_GRID:
            r = _cv_evaluate(all_series, {"changepoint_prior_scale": cps, "seasonality_prior_scale": sps})
            if r is not None:
                results.append(r)
    # Sort ascending by test RMSE — lowest (best) first.
    results.sort(key=lambda r: r["test_rmse"])
    return results


def _diagnose(result: dict) -> str:
    # Training error too close to zero to divide by meaningfully (a
    # degenerate/perfect fit, not a real signal).
    if not result["train_mae"] or result["train_mae"] < 1e-6:
        return "insufficient signal to diagnose over/underfitting (training error too close to zero to compare)"
    # How many times larger the held-out error is than the training error.
    ratio = result["test_mae"] / result["train_mae"]
    if ratio > 2.0:
        return f"overfitting (held-out error is {ratio:.1f}x training error)"
    if ratio < 1.2:
        return "good fit (training and held-out error are close)"
    return f"mild overfitting (held-out error is {ratio:.1f}x training error)"


def evaluate(all_series: dict[str, tuple[list[str], list[float]]]) -> dict:
    """Full grid-search + walk-forward-CV report. Returns the best
    (changepoint_prior_scale, seasonality_prior_scale) params found, or
    DEFAULT_PROPHET_PARAMS when there's too little history for CV to be
    meaningful yet (each department currently has few months of
    usage_summaries — this widens automatically as more months accrue)."""
    # Only departments with enough months of history to form CV folds.
    eligible = {dept: series for dept, series in all_series.items() if len(series[1]) >= MIN_CV_MONTHS}
    # No department qualifies yet — skip CV entirely, use Prophet's own
    # published defaults.
    if not eligible:
        print(f"  [skip CV] no department has >= {MIN_CV_MONTHS} months of history yet; "
              f"using Prophet defaults {DEFAULT_PROPHET_PARAMS}.")
        return DEFAULT_PROPHET_PARAMS
    # Run the full grid search across eligible departments.
    results = grid_search(eligible)
    # Every combination failed (e.g. Prophet/cmdstan not installed) — fall
    # back to defaults too.
    if not results:
        print("  [skip CV] Prophet unavailable (e.g. cmdstan not installed) or all fits failed; "
              f"using Prophet defaults {DEFAULT_PROPHET_PARAMS} (naive fallback still applies per-department).")
        return DEFAULT_PROPHET_PARAMS
    print(f"  Grid search: {len(results)} config(s), walk-forward CV across {len(eligible)} "
          f"department(s) with >= {MIN_CV_MONTHS} months of history")
    # Print one summary line per hyperparameter combination tried.
    for r in results:
        mape_str = f"{r['test_mape']:.1f}%" if r["test_mape"] is not None else "n/a"
        train_str = f"{r['train_mae']:.2f}" if r["train_mae"] is not None else "n/a"
        print(f"    {r['params']}: train_MAE={train_str} test_MAE={r['test_mae']:.2f} "
              f"test_RMSE={r['test_rmse']:.2f} test_MAPE={mape_str} folds={r['folds']}")
    # Best (lowest test RMSE) combination is first, since grid_search
    # already sorted the results.
    best = results[0]
    print(f"  Best: {best['params']} (folds={best['folds']}) -> {_diagnose(best)}")
    # Flag when the result is based on very few folds, so it's read with
    # appropriate skepticism.
    if best["folds"] < 5:
        print(f"  Note: only {best['folds']} walk-forward fold(s) available — CV will get more reliable "
              f"as more monthly usage_summaries history accrues.")
    return best["params"]


def run(backend: Backend) -> int:
    """Returns the number of forecast_results rows written."""
    # Every department id in the system.
    departments = backend.execute("SELECT department_id FROM departments").fetchall()
    # The days the call data spans, to spot partial months below.
    coverage = _data_coverage(backend)
    # department_id -> (list of month strings, list of matching total costs).
    all_series: dict[str, tuple[list[str], list[float]]] = {}
    for (department_id,) in departments:
        # Pull this department's monthly cost totals.
        monthly_df = backend.read_sql(_DEPARTMENT_MONTHLY_SQL, params=(department_id,))
        # Drop any row with a missing month value.
        monthly_df = monthly_df.dropna(subset=["month"])
        # Not enough months of history to forecast anything for this dept.
        if len(monthly_df) < MIN_MONTHS:
            continue
        # Make sure months are in chronological order.
        monthly_df = monthly_df.sort_values("month")
        # Parallel lists (months, costs), missing costs filled with 0, with
        # partial months scaled up to full-month equivalents.
        months, values = _full_month_series(
            monthly_df["month"].tolist(), monthly_df["total_cost"].fillna(0.0).tolist(), coverage)
        # Dropping too-thin months may leave too little to forecast from.
        if len(months) < MIN_MONTHS:
            continue
        all_series[department_id] = (months, values)

    # No department had enough history at all — nothing to forecast.
    if not all_series:
        return 0

    if coverage is not None:
        every_month = sorted({month for months, _ in all_series.values() for month in months})
        partial = [(m, *_month_coverage(m, coverage)) for m in every_month]
        partial = [f"{m} ({covered} of {days} days)" for m, covered, days in partial if covered < days]
        if partial:
            print(f"  Call data covers {coverage[0]} to {coverage[1]}; partial month(s) scaled to a full month: "
                  + ", ".join(partial))

    # Find the best regularization params via grid search + CV (or fall
    # back to defaults).
    best_params = evaluate(all_series)

    written = 0
    # Forecast next month for every department that has enough history.
    for department_id, (months, values) in all_series.items():
        forecast = _forecast_next_month(months, values, best_params)
        # The month being forecast is one past this department's last
        # known month.
        period = _next_month_key(months[-1])

        # Check whether a forecast_results row already exists for this
        # department+period.
        existing = backend.execute(
            "SELECT forecast_id FROM forecast_results WHERE department_id = ? AND period = ?",
            (department_id, period),
        ).fetchone()
        if existing:
            # Update the existing row's forecast figures.
            backend.execute(
                """UPDATE forecast_results
                   SET forecasted_cost = ?, confidence_low = ?, confidence_high = ?, generated_at = ?
                   WHERE forecast_id = ?""",
                (forecast["point"], forecast["low"], forecast["high"], now_str(), existing[0]),
            )
        else:
            # Insert a brand new forecast row with a fresh UUID.
            backend.execute(
                """INSERT INTO forecast_results
                   (forecast_id, department_id, period, forecasted_cost, confidence_low, confidence_high, generated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (new_id(), department_id, period, forecast["point"], forecast["low"], forecast["high"], now_str()),
            )
        written += 1
    # Persist all inserts/updates.
    backend.commit()
    return written


def main() -> None:
    # Run forecasting against every currently-reachable backend, printing a
    # one-line summary each.
    for backend in open_backend_connections():
        print(f"[{backend.name}] Forecasting:")
        written = run(backend)
        print(f"[{backend.name}] Forecasting: {written} department forecast(s) written.")


# Only run main() when this file is executed directly, not when imported.
if __name__ == "__main__":
    main()
