import type { ReactNode } from "react";

// The report is a printed document: always light, whatever theme the app is
// in. --report-1…5 (globals.css) are the app's light-mode categorical chart
// colours, defined once and never switched for dark mode, so paper never
// inherits a dark palette. Slot order is fixed — a category keeps its
// colour on every page.
export const REPORT_COLORS = [
  "var(--report-1)",
  "var(--report-2)",
  "var(--report-3)",
  "var(--report-4)",
  "var(--report-5)",
];

export interface ChartSlice {
  label: string;
  value: number;
  /** The value as it should read in the legend, e.g. "KES 4,210". */
  display: string;
}

/** Parts of a whole for up to five categories. Every slice is named and
 * numbered in the legend beside the ring, so colour never carries identity
 * or size alone — it still reads in a black-and-white printout. */
export function ReportDonut({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: ChartSlice[];
  centerLabel: string;
  centerValue: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return <NoData />;

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 2 : 0;
  const lengths = slices.map((slice) => (slice.value / total) * circumference);
  // Where each segment starts: the lengths of all the ones before it.
  const offsets = lengths.map((_, index) =>
    lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  );

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <svg
        viewBox="0 0 140 140"
        className="size-36 shrink-0"
        role="img"
        aria-label={`${centerLabel}: ${slices.map((s) => `${s.label} ${s.display}`).join(", ")}`}
      >
        <g transform="rotate(-90 70 70)">
          {slices.map((slice, index) => {
            const dash = Math.max(0, lengths[index] - gap);
            return (
              <circle
                key={slice.label}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={REPORT_COLORS[index % REPORT_COLORS.length]}
                strokeWidth="20"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offsets[index]}
              >
                <title>{`${slice.label}: ${slice.display}`}</title>
              </circle>
            );
          })}
        </g>
        <text
          x="70"
          y="66"
          textAnchor="middle"
          className="fill-neutral-500 text-[9px]"
        >
          {centerLabel}
        </text>
        <text
          x="70"
          y="82"
          textAnchor="middle"
          className="fill-neutral-900 text-[13px] font-semibold"
        >
          {centerValue}
        </text>
      </svg>
      <ul className="flex min-w-48 flex-1 flex-col gap-1.5 text-sm">
        {slices.map((slice, index) => (
          <li key={slice.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{
                background: REPORT_COLORS[index % REPORT_COLORS.length],
              }}
            />
            <span className="min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="font-tabular text-neutral-600">
              {total > 0 ? `${((slice.value / total) * 100).toFixed(0)}%` : ""}
            </span>
            <span className="font-tabular min-w-28 text-right font-medium whitespace-nowrap">
              {slice.display}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Magnitude across categories: one hue, bars from a shared zero, the
 * value written at the end of every bar. An optional marker draws a
 * reference point on the same scale (a budget ceiling). */
export function ReportBars({
  rows,
}: {
  rows: {
    label: string;
    value: number;
    display: string;
    marker?: { value: number; label: string } | null;
    note?: ReactNode;
  }[];
}) {
  const max = Math.max(
    0,
    ...rows.map((row) => Math.max(row.value, row.marker?.value ?? 0)),
  );
  if (max <= 0) return <NoData />;

  return (
    <ul className="flex flex-col gap-2.5 text-sm">
      {rows.map((row) => (
        <li
          key={row.label}
          className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-x-3"
          title={`${row.label}: ${row.display}`}
        >
          <span className="truncate">{row.label}</span>
          <span className="relative h-4">
            <span
              className="absolute inset-y-0 left-0 rounded-r"
              style={{
                width: `${(row.value / max) * 100}%`,
                minWidth: row.value > 0 ? 2 : 0,
                background: REPORT_COLORS[0],
              }}
            />
            {row.marker ? (
              <span
                className="absolute -inset-y-1 w-0.5 bg-neutral-900"
                style={{ left: `${(row.marker.value / max) * 100}%` }}
                title={row.marker.label}
              />
            ) : null}
          </span>
          <span className="font-tabular text-right">
            <span className="font-medium">{row.display}</span>
            {row.note ? (
              <span className="ml-2 text-xs text-neutral-600">{row.note}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Change over a handful of months: one column per month from a zero
 * baseline, every column labelled with its value. A month the call data
 * only partly covers is drawn hatched and marked, so it isn't read as a
 * drop. */
export function ReportColumns({
  points,
}: {
  points: { label: string; value: number; display: string; partial: boolean }[];
}) {
  const max = Math.max(0, ...points.map((p) => p.value));
  if (max <= 0) return <NoData />;

  const width = 640;
  const height = 210;
  const top = 22;
  const bottom = 34;
  const plot = height - top - bottom;
  const slot = width / points.length;
  const bar = Math.min(64, slot * 0.5);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={`Spend by month: ${points.map((p) => `${p.label} ${p.display}`).join(", ")}`}
    >
      <defs>
        <pattern
          id="report-partial"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="white" />
          <rect width="3" height="6" fill={REPORT_COLORS[0]} />
        </pattern>
      </defs>
      {points.map((point, index) => {
        const h = Math.max(2, (point.value / max) * plot);
        const x = index * slot + (slot - bar) / 2;
        const y = top + plot - h;
        return (
          <g key={point.label}>
            <path
              d={`M${x},${top + plot} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + bar - 4} Q${x + bar},${y} ${x + bar},${y + 4} V${top + plot} Z`}
              fill={point.partial ? "url(#report-partial)" : REPORT_COLORS[0]}
              stroke={point.partial ? REPORT_COLORS[0] : "none"}
            >
              <title>{`${point.label}: ${point.display}${point.partial ? " (part month)" : ""}`}</title>
            </path>
            <text
              x={x + bar / 2}
              y={y - 6}
              textAnchor="middle"
              className="fill-neutral-900 text-[11px] font-medium"
            >
              {point.display}
            </text>
            <text
              x={x + bar / 2}
              y={top + plot + 16}
              textAnchor="middle"
              className="fill-neutral-700 text-[11px]"
            >
              {point.label}
            </text>
            {point.partial ? (
              <text
                x={x + bar / 2}
                y={top + plot + 29}
                textAnchor="middle"
                className="fill-neutral-500 text-[9px]"
              >
                part month
              </text>
            ) : null}
          </g>
        );
      })}
      <line
        x1="0"
        x2={width}
        y1={top + plot}
        y2={top + plot}
        className="stroke-neutral-400"
      />
    </svg>
  );
}

function NoData() {
  return (
    <p className="py-6 text-center text-xs text-neutral-500">
      Nothing recorded for this month.
    </p>
  );
}
