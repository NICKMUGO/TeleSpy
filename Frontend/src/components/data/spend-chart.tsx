"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface SpendChartPoint {
  month: string;
  historical?: number;
  forecast?: number;
  low?: number;
  high?: number;
}

function formatKes(value: number) {
  return `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

/** Historical monthly spend plus one forward-looking forecast point with a
 * confidence band — chart tokens only (--chart-1/--chart-2), never a raw
 * hex literal (the repo's ESLint rule bans that in .tsx anyway). Height is
 * fixed via the parent's className, not hardcoded here, so it composes at
 * any width down to phone. */
export function SpendChart({
  data,
  budgetCeiling,
}: {
  data: SpendChartPoint[];
  budgetCeiling?: number | null;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={64}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickFormatter={(value: number) => `${Math.round(value / 1000)}k`}
        />
        <Tooltip
          formatter={(value, name) => [
            typeof value === "number" ? formatKes(value) : value,
            name,
          ]}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            color: "var(--popover-foreground)",
            fontSize: 12,
          }}
        />
        {budgetCeiling ? (
          <ReferenceLine
            y={budgetCeiling}
            stroke="var(--destructive)"
            strokeDasharray="4 4"
            label={{
              value: "Budget ceiling",
              fill: "var(--destructive)",
              fontSize: 11,
              position: "insideTopRight",
            }}
          />
        ) : null}
        <Area
          type="monotone"
          dataKey="historical"
          name="Actual"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#spend-fill)"
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="forecast"
          name="Forecast"
          stroke="var(--chart-2)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ r: 3 }}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
