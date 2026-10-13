"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DepartmentOverviewRow } from "@/lib/api/types";
import { kes, monthLabel } from "@/lib/format";

// One colour per department, in a fixed order, so a department keeps its
// colour on every chart and in every month. Past five the order starts
// again with a dashed line, so two departments never share both.
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--popover-foreground)",
  fontSize: 12,
};
const LEGEND_STYLE = { fontSize: 12, color: "var(--muted-foreground)" };

function thousands(value: number) {
  return value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value);
}

/** Each department's monthly spend as its own line — who is rising, who is
 * falling, and who sits above the rest. */
export function DepartmentTrendChart({
  departments,
  months,
}: {
  departments: DepartmentOverviewRow[];
  months: string[];
}) {
  const data = months.map((month) => {
    const point: Record<string, string | number> = {
      month: monthLabel(month, true),
    };
    for (const dept of departments) {
      point[dept.id] = dept.trend.find((t) => t.month === month)?.cost_kes ?? 0;
    }
    return point;
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tick={AXIS_TICK}
          tickFormatter={thousands}
        />
        <Tooltip
          formatter={(value, name) => [
            typeof value === "number" ? kes(value) : value,
            name,
          ]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Legend iconType="plainline" wrapperStyle={LEGEND_STYLE} />
        {departments.map((dept, index) => (
          <Line
            key={dept.id}
            type="monotone"
            dataKey={dept.id}
            name={dept.name}
            stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
            strokeWidth={2}
            strokeDasharray={index >= SERIES_COLORS.length ? "5 4" : undefined}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** This month's spend beside last month's, department by department. */
export function DepartmentMonthComparisonChart({
  departments,
  month,
  previousMonth,
}: {
  departments: DepartmentOverviewRow[];
  month: string;
  previousMonth: string;
}) {
  const data = departments.map((dept) => ({
    name: dept.cost_centre_code ?? dept.name,
    fullName: dept.name,
    previous: dept.previous_cost_kes ?? 0,
    current: dept.cost_kes,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        barGap={2}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tick={AXIS_TICK}
          tickFormatter={thousands}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
          formatter={(value, name) => [
            typeof value === "number" ? kes(value) : value,
            name,
          ]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Legend iconType="square" wrapperStyle={LEGEND_STYLE} />
        <Bar
          dataKey="previous"
          name={monthLabel(previousMonth)}
          fill="var(--chart-5)"
          fillOpacity={0.45}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          isAnimationActive={false}
        />
        <Bar
          dataKey="current"
          name={monthLabel(month)}
          fill="var(--chart-1)"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

const CALL_TYPES = [
  { type: "External", label: "Local", color: "var(--chart-1)" },
  { type: "International", label: "International", color: "var(--chart-2)" },
  { type: "Internal", label: "Internal (free)", color: "var(--chart-5)" },
];

/** Minutes on the phone per department, split by call type. Minutes, not
 * shillings: an individual call carries no cost of its own. */
export function DepartmentCallMixChart({
  departments,
}: {
  departments: DepartmentOverviewRow[];
}) {
  const data = departments.map((dept) => {
    const point: Record<string, string | number> = {
      name: dept.cost_centre_code ?? dept.name,
      fullName: dept.name,
    };
    for (const { type } of CALL_TYPES) {
      point[type] = Math.round(
        dept.calls.find((c) => c.type === type)?.minutes ?? 0,
      );
    }
    return point;
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tick={AXIS_TICK}
          tickFormatter={thousands}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
          formatter={(value, name) => [
            typeof value === "number"
              ? `${value.toLocaleString("en-KE")} min`
              : value,
            name,
          ]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Legend iconType="square" wrapperStyle={LEGEND_STYLE} />
        {CALL_TYPES.map(({ type, label, color }) => (
          <Bar
            key={type}
            dataKey={type}
            name={label}
            stackId="minutes"
            fill={color}
            // The card surface between segments keeps them separable.
            stroke="var(--card)"
            strokeWidth={2}
            maxBarSize={40}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
