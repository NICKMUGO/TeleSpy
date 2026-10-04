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
        month: p.month,
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

  return (
    <>
      <PageHeader
        title="Spend forecasts"
        description="Historical monthly spend plus Prophet's next-month projection, per department."
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="Next month forecast"
                value={kes(forecast.data.data.forecast?.forecasted_cost)}
              />
              <StatCard
                label="Confidence range"
                value={`${kes(forecast.data.data.forecast?.confidence_low)} – ${kes(forecast.data.data.forecast?.confidence_high)}`}
              />
              <StatCard
                label="Budget ceiling"
                value={kes(forecast.data.data.budget_ceiling)}
              />
            </div>
            <div className="border-border h-80 w-full rounded-lg border p-4">
              <SpendChart
                data={chartData}
                budgetCeiling={forecast.data.data.budget_ceiling}
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}
