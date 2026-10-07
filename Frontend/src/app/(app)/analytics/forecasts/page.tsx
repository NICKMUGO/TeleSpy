"use client";

import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { ErrorBanner } from "@/components/data/error-banner";
import {
  SpendChart,
  type SpendChartPoint,
} from "@/components/data/spend-chart";
import { StatCard } from "@/components/data/stat-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDepartmentForecast, useDepartments } from "@/lib/api/hooks";
import { monthLabel } from "@/lib/format";

function kes(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

export default function ForecastsPage() {
  const departments = useDepartments();
  // No explicit selection yet -> default to the first department once
  // it's loaded. Derived directly during render rather than synced via
  // an effect (which would cost an extra render pass for what's really
  // just "pick a fallback value").
  const [explicitDepartmentId, setDepartmentId] = useState<string | null>(null);
  const departmentId =
    explicitDepartmentId ?? departments.data?.data[0]?.id ?? null;

  const forecast = useDepartmentForecast(departmentId ?? "");
  const selectedDept = departments.data?.data.find(
    (d) => d.id === departmentId,
  );

  const chartData = useMemo<SpendChartPoint[]>(() => {
    if (!forecast.data) return [];
    const points: SpendChartPoint[] =
      forecast.data.data.historical_monthly_spend.map((p) => ({
        // A month the call data only partly covers is labelled as such, so
        // its smaller total doesn't read as a drop in spend.
        month:
          p.days_covered < p.days_in_month ? `${p.month} (partial)` : p.month,
        historical: p.total_cost,
      }));
    const f = forecast.data.data.forecast;
    if (f && points.length > 0) {
      const last = points[points.length - 1];
      points.push({
        month: f.period,
        forecast: f.forecasted_cost ?? undefined,
      });
      // Connect the dashed forecast line to the last actual point.
      last.forecast = last.historical;
    }
    return points;
  }, [forecast.data]);

  const detail = forecast.data?.data;
  const employeeCount = detail?.employee_count ?? 0;
  const forecastedCost = detail?.forecast?.forecasted_cost;
  const partialMonths = (detail?.historical_monthly_spend ?? []).filter(
    (p) => p.days_covered < p.days_in_month,
  );
  const staffLabel = `${employeeCount.toLocaleString("en-KE")} ${employeeCount === 1 ? "employee" : "employees"}`;

  return (
    <>
      <PageHeader
        title="Spend forecasts"
        description="Each department's total monthly call spend — every employee in it added together — and the projection for next month."
      />
      <div className="flex flex-col gap-4 p-6">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="w-fit">
              {selectedDept?.name ?? "Select department"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(departments.data?.data ?? []).map((dept) => (
              <DropdownMenuItem
                key={dept.id}
                onSelect={() => setDepartmentId(dept.id)}
              >
                {dept.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {forecast.error ? (
          <ErrorBanner
            error={forecast.error}
            onRetry={() => forecast.refetch()}
          />
        ) : forecast.isLoading || !forecast.data ? (
          <Skeleton className="h-80 w-full" />
        ) : chartData.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="Not enough history yet"
            description="Forecasts need at least two months of usage_summaries — run the ML billing job first."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={
                  detail?.forecast
                    ? `Department forecast · ${monthLabel(detail.forecast.period)}`
                    : "Department forecast"
                }
                value={kes(forecastedCost)}
                hint={`Whole department · ${staffLabel} combined`}
              />
              <StatCard
                label="Likely range"
                value={`${kes(detail?.forecast?.confidence_low)} – ${kes(detail?.forecast?.confidence_high)}`}
                hint="Whole department, full month"
              />
              <StatCard
                label="Average per employee"
                value={kes(
                  forecastedCost !== null &&
                    forecastedCost !== undefined &&
                    employeeCount > 0
                    ? forecastedCost / employeeCount
                    : null,
                )}
                hint={`Department forecast ÷ ${staffLabel}`}
              />
              <StatCard
                label="Department budget"
                value={kes(detail?.budget_ceiling)}
                hint="Monthly ceiling for the whole department"
              />
            </div>
            <div className="border-border h-80 w-full rounded-lg border p-4">
              <SpendChart
                data={chartData}
                budgetCeiling={forecast.data.data.budget_ceiling}
              />
            </div>
            <p className="text-muted-foreground text-sm">
              Every figure is the {detail?.department_name ?? "department"}{" "}
              department&rsquo;s total: the call costs of all {staffLabel} in it
              added together, not one person&rsquo;s spend.
              {partialMonths.length > 0
                ? ` ${partialMonths
                    .map(
                      (p) =>
                        `${monthLabel(p.month)} has call data for ${p.days_covered} of ${p.days_in_month} days`,
                    )
                    .join(
                      "; ",
                    )}, so those totals are lower than a full month. The forecast is for a full month.`
                : ""}
            </p>
          </>
        )}
      </div>
    </>
  );
}
