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
"""
import numpy as np
import pandas as pd

from common import Backend, new_id, now_str, open_backend_connections

MIN_MONTHS = 2

_DEPARTMENT_MONTHLY_SQL = """
    SELECT us.month AS month, SUM(us.total_cost) AS total_cost
    FROM usage_summaries us
    JOIN employees e ON e.employee_id = us.employee_id
    WHERE e.department_id = ?
    GROUP BY us.month
"""


def _next_month_key(month: str) -> str:
    year, mo = (int(part) for part in month.split("-"))
    mo += 1
    if mo > 12:
        mo = 1
        year += 1
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
    if n == 1:
        point = values[0]
        return {"point": round(point, 2), "low": round(point * 0.8, 2), "high": round(point * 1.2, 2)}

    eps = 0.01  # avoid log(0) for a month with zero spend
    log_values = [float(np.log(max(v, eps))) for v in values]
    t = list(range(n))
    t_mean, y_mean = sum(t) / n, sum(log_values) / n
    numerator = sum((t[i] - t_mean) * (log_values[i] - y_mean) for i in range(n))
    denominator = sum((t[i] - t_mean) ** 2 for i in range(n)) or 1.0
    slope = numerator / denominator
    intercept = y_mean - slope * t_mean

    fitted = [intercept + slope * ti for ti in t]
    residuals = [log_values[i] - fitted[i] for i in range(n)]
    dof = max(1, n - 2)
    residual_std = (sum(r ** 2 for r in residuals) / dof) ** 0.5

    log_next = intercept + slope * n
    z = 1.2816  # ~80% interval
    point = float(np.exp(log_next))
    low = float(np.exp(log_next - z * residual_std))
    high = float(np.exp(log_next + z * residual_std))
    return {"point": round(point, 2), "low": round(low, 2), "high": round(high, 2)}


def _forecast_with_prophet(months: list[str], values: list[float]) -> dict:
    from prophet import Prophet

    frame = pd.DataFrame({"ds": pd.to_datetime([f"{m}-01" for m in months]), "y": values})
    model = Prophet(
        seasonality_mode="multiplicative",
        weekly_seasonality=False,
        daily_seasonality=False,
        interval_width=0.80,
    )
    model.fit(frame)
    future = model.make_future_dataframe(periods=1, freq="MS")
    forecast = model.predict(future)
    last = forecast.iloc[-1]
    return {
        "point": round(max(0.0, float(last["yhat"])), 2),
        "low": round(max(0.0, float(last["yhat_lower"])), 2),
        "high": round(max(0.0, float(last["yhat_upper"])), 2),
    }


def _forecast_next_month(months: list[str], values: list[float]) -> dict:
    try:
        return _forecast_with_prophet(months, values)
    except Exception:  # noqa: BLE001 - cmdstan missing, fit failure, etc. — degrade, don't crash the batch job
        return _forecast_naive(values)


def run(backend: Backend) -> int:
    """Returns the number of forecast_results rows written."""
    departments = backend.execute("SELECT department_id FROM departments").fetchall()
    written = 0
    for (department_id,) in departments:
        monthly_df = backend.read_sql(_DEPARTMENT_MONTHLY_SQL, params=(department_id,))
        monthly_df = monthly_df.dropna(subset=["month"])
        if len(monthly_df) < MIN_MONTHS:
            continue
        monthly_df = monthly_df.sort_values("month")
        months = monthly_df["month"].tolist()
        values = monthly_df["total_cost"].fillna(0.0).tolist()

        forecast = _forecast_next_month(months, values)
        period = _next_month_key(months[-1])

        existing = backend.execute(
            "SELECT forecast_id FROM forecast_results WHERE department_id = ? AND period = ?",
            (department_id, period),
        ).fetchone()
        if existing:
            backend.execute(
                """UPDATE forecast_results
                   SET forecasted_cost = ?, confidence_low = ?, confidence_high = ?, generated_at = ?
                   WHERE forecast_id = ?""",
                (forecast["point"], forecast["low"], forecast["high"], now_str(), existing[0]),
            )
        else:
            backend.execute(
                """INSERT INTO forecast_results
                   (forecast_id, department_id, period, forecasted_cost, confidence_low, confidence_high, generated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (new_id(), department_id, period, forecast["point"], forecast["low"], forecast["high"], now_str()),
            )
        written += 1
    backend.commit()
    return written


def main() -> None:
    for backend in open_backend_connections():
        written = run(backend)
        print(f"[{backend.name}] Forecasting: {written} department forecast(s) written.")


if __name__ == "__main__":
    main()
