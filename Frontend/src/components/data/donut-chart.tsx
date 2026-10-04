"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export interface DonutSlice {
  label: string;
  value: number;
}

// Fixed slot order — a slice keeps its colour when a filter changes the
// number of slices, so "teal" always means the same category.
const SLICE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/**
 * Parts-of-a-whole for a small, fixed set of categories. Capped at five
 * slots: past that, arcs stop being comparable and the data belongs in a
 * BarList instead.
 *
 * Every slice is named and numbered in the legend beneath the ring, so
 * colour is never the only thing carrying identity or magnitude.
 */
export function DonutChart({
  data,
  formatValue,
}: {
  data: DonutSlice[];
  formatValue?: (value: number) => string;
}) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const format = formatValue ?? ((value: number) => value.toLocaleString("en-KE"));

  if (total <= 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-xs">
        No usage recorded for this period.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={2}
              // 2px of the card surface between segments, so adjacent
              // arcs stay separable without an extra outline colour.
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((slice, index) => (
                <Cell
                  key={slice.label}
                  fill={SLICE_COLORS[index % SLICE_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => [
                typeof value === "number" ? format(value) : value,
              ]}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                color: "var(--popover-foreground)",
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-col gap-1.5">
        {data.map((slice, index) => (
          <li
            key={slice.label}
            className="flex items-baseline justify-between gap-2 text-xs"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-[2px]"
                style={{
                  background: SLICE_COLORS[index % SLICE_COLORS.length],
                }}
              />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="font-tabular text-muted-foreground shrink-0">
              {Math.round((slice.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
