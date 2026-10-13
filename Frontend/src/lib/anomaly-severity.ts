/**
 * Severity banding for an anomaly_flags.anomaly_score.
 *
 * The score is produced by ML/training/anomaly_detection.py as
 * `clamp(0.5 - decision_function, 0, 1)`. Only paid calls are scored, only
 * the most unusual 0.5% of them are candidates, and a flag is stored only
 * at or above that script's MIN_ANOMALY_SCORE (0.52) — so every stored
 * score sits in a narrow band from 0.52 up to about 0.65, and nothing
 * borderline is stored at all. The bands below are cut against that real
 * range, NOT against a notional 0-1. "low" is kept for flags written by an
 * older run of the job, which stored scores down to 0.5.
 */
export type Severity = "high" | "medium" | "low";

export const HIGH_SEVERITY_THRESHOLD = 0.55;
export const MEDIUM_SEVERITY_THRESHOLD = 0.52;

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
