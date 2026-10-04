/** Shared money/number formatting, so KES never renders three ways on one screen. */

export function kes(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

/** Compact form for dashboard tiles, where the exact shilling isn't the point. */
export function kesCompact(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 1_000_000) return `KES ${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `KES ${(value / 1_000).toFixed(1)}k`;
  return `KES ${value.toFixed(0)}`;
}

export function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-08" -> "August 2026"; "2026-08" -> "Aug" with short=true. */
export function monthLabel(key: string, short = false) {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString("en-KE", {
    month: short ? "short" : "long",
    year: short ? undefined : "numeric",
  });
}

export function percentDelta(current: number, previous: number) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * The most recent month that has at least one usage_summaries row for the
 * given rows, falling back to the calendar month when there are none.
 *
 * usage_summaries is written by ML/training/billing.py on its own
 * schedule (not live at ingest), so for most of a month the newest
 * complete figures are last month's — pinning a screen to the calendar
 * month instead renders KES 0 everywhere and reads as broken rather than
 * as "the billing job hasn't run yet". Shared by the dashboard and the
 * anomalies page so both pick the same period.
 */
export function activePeriod(rows: { month: string }[]) {
  const latest = rows.reduce<string | null>(
    (max, row) => (max === null || row.month > max ? row.month : max),
    null,
  );
  const month = latest ?? monthKey(new Date());
  const [year, index] = month.split("-").map(Number);
  const previous = monthKey(new Date(year, index - 2, 1));
  return { month, previous };
}
