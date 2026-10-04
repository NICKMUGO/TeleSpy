/**
 * Severity banding for an anomaly_flags.anomaly_score.
 *
 * The score is produced by ML/training/anomaly_detection.py as
 * `clamp(0.5 - decision_function, 0, 1)`, and a row is only written when
 * IsolationForest.predict() returned -1 — so decision_function is already
 * negative and every stored score lands in roughly [0.5, 1.0]. The bands
 * below are cut against that real range, NOT against a notional 0-1: a
 * naive "0.8 = high, 0.3 = low" split would grade every flag in the table
 * as high and make the column useless.
 */
export type Severity = "high" | "medium" | "low";

export const HIGH_SEVERITY_THRESHOLD = 0.65;
export const MEDIUM_SEVERITY_THRESHOLD = 0.55;

export function severityOf(score: number): Severity {
  if (score >= HIGH_SEVERITY_THRESHOLD) return "high";
  if (score >= MEDIUM_SEVERITY_THRESHOLD) return "medium";
  return "low";
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};
