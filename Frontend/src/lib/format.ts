/** Shared money/number formatting, so KES never renders three ways on one screen. */

export function kes(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

/** Compact form for dashboard tiles, where the exact shilling isn't the point. */
export function kesCompact(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 1_000_000)
    return `KES ${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `KES ${(value / 1_000).toFixed(1)}k`;
  return `KES ${value.toFixed(0)}`;
}

/** A call's length from its duration in minutes: "42 s", "3 min 05 s".
 * Seconds rather than decimal minutes, so a short call doesn't read as
 * "0.0 min". */
export function callDuration(minutes: number) {
  const totalSeconds = Math.round(minutes * 60);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${Math.floor(totalSeconds / 60)} min ${seconds} s`;
}

export function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** 75 -> "1 h 15 min"; 1500 -> "1 d 1 h". For time taken and time left. */
export function duration(minutes: number) {
  const m = Math.abs(Math.round(minutes));
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  if (hours < 24) return m % 60 ? `${hours} h ${m % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
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

/** "just now", "12 min ago", "3 h ago", "2 d ago", then the date. */
export function timeAgo(iso: string, now: number = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
  });
}

/** Full local date and time, e.g. "18 Oct 2026, 11:44". */
export function dateTime(iso: string) {
  return new Date(iso).toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
