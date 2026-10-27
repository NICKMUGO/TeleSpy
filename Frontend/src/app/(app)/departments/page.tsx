"use client";

import { useMemo, useState } from "react";
import { Building2, CircleCheck, TriangleAlert } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { BarList } from "@/components/data/bar-list";
import { BudgetMeter } from "@/components/data/budget-meter";
import { DataTable } from "@/components/data/data-table";
import { EmptyState } from "@/components/data/empty-state";
import { ErrorBanner } from "@/components/data/error-banner";
import { SectionCard } from "@/components/data/section-card";
import { StatCard } from "@/components/data/stat-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SelectNative } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DepartmentCallMixChart,
  DepartmentMonthComparisonChart,
  DepartmentTrendChart,
} from "@/features/departments/department-charts";
import type { DepartmentOverviewRow } from "@/lib/api/types";
import { useDepartmentsOverview } from "@/lib/api/hooks";
import { kes, kesCompact, monthLabel, percentDelta } from "@/lib/format";

const STATUS_LABEL: Record<DepartmentOverviewRow["status"], string> = {
  over_budget: "Over ceiling",
  near_ceiling: "Near ceiling",
  within_budget: "Within ceiling",
  unmonitored: "No ceiling set",
};

function StatusBadge({ status }: { status: DepartmentOverviewRow["status"] }) {
  return (
    <Badge
      variant={
        status === "over_budget"
          ? "destructive"
          : status === "near_ceiling"
            ? "outline"
            : "secondary"
      }
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function signedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export default function DepartmentsPage() {
  const [chosenMonth, setChosenMonth] = useState<string | undefined>(undefined);
  const overview = useDepartmentsOverview(chosenMonth);
  const data = overview.data?.data;
  const departments = useMemo(() => data?.departments ?? [], [data]);

  const bySpend = useMemo(
    () => [...departments].sort((a, b) => b.cost_kes - a.cost_kes),
    [departments],
  );
  const overCeiling = useMemo(
    () =>
      departments
        .filter((d) => d.status === "over_budget")
        .sort((a, b) => b.over_budget_by_kes - a.over_budget_by_kes),
    [departments],
  );
  const nearCeiling = departments.filter((d) => d.status === "near_ceiling");
  const previousTotal = departments.reduce(
    (sum, d) => sum + (d.previous_cost_kes ?? 0),
    0,
  );
  const totalDelta = data
    ? percentDelta(data.total_cost_kes, previousTotal)
    : null;
  const costliestPerHead = [...departments]
    .filter((d) => d.cost_per_head_kes !== null)
    .sort((a, b) => (b.cost_per_head_kes ?? 0) - (a.cost_per_head_kes ?? 0))[0];
  const staffOverLimit = departments.reduce(
    (sum, d) => sum + d.staff_over_limit,
    0,
  );

  const columns = useMemo<ColumnDef<DepartmentOverviewRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Department",
        cell: (c) => (
          <span className="font-medium">
            {c.row.original.name}
            {c.row.original.cost_centre_code ? (
              <span className="text-muted-foreground font-tabular ml-2 text-xs font-normal">
                {c.row.original.cost_centre_code}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: "headcount",
        header: "Staff",
        cell: (c) => (
          <span className="font-tabular">{c.getValue<number>()}</span>
        ),
      },
      {
        accessorKey: "cost_kes",
        header: "Spend",
        cell: (c) => (
          <span className="font-tabular">{kes(c.getValue<number>())}</span>
        ),
      },
      {
        accessorKey: "budget_ceiling_kes",
        header: "Ceiling",
        cell: (c) => (
          <span className="font-tabular text-muted-foreground">
            {kes(c.getValue<number | null>())}
          </span>
        ),
      },
      {
        accessorKey: "budget_used_pct",
        header: "Used",
        cell: (c) => {
          const pct = c.getValue<number | null>();
          if (pct === null) return "—";
          return (
            <span
              className={
                pct > 100
                  ? "font-tabular text-destructive font-medium"
                  : "font-tabular"
              }
            >
              {Math.round(pct)}%
            </span>
          );
        },
      },
      {
        id: "change",
        header: "vs last month",
        accessorFn: (row) =>
          row.previous_cost_kes === null
            ? null
            : percentDelta(row.cost_kes, row.previous_cost_kes),
        cell: (c) => {
          const delta = c.getValue<number | null>();
          return (
            <span className="font-tabular">
              {delta === null ? "—" : signedPct(delta)}
            </span>
          );
        },
      },
      {
        accessorKey: "cost_per_head_kes",
        header: "Per employee",
        cell: (c) => (
          <span className="font-tabular">
            {kes(c.getValue<number | null>())}
          </span>
        ),
      },
      {
        accessorKey: "staff_over_limit",
        header: "Staff over limit",
        cell: (c) => (
          <span className="font-tabular">{c.getValue<number>()}</span>
        ),
      },
      {
        accessorKey: "open_anomalies",
        header: "Open anomalies",
        cell: (c) => (
          <span className="font-tabular">{c.getValue<number>()}</span>
        ),
      },
      {
        id: "forecast",
        header: "Forecast",
        accessorFn: (row) => row.forecast?.forecasted_cost_kes ?? null,
        cell: (c) => {
          const forecast = c.row.original.forecast;
          if (!forecast || forecast.forecasted_cost_kes === null) return "—";
          return (
            <span className="font-tabular">
              {kes(forecast.forecasted_cost_kes)}
              <span className="text-muted-foreground ml-1 text-xs">
                {monthLabel(forecast.period, true)}
              </span>
            </span>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: (c) => (
          <StatusBadge status={c.getValue<DepartmentOverviewRow["status"]>()} />
        ),
      },
    ],
    [],
  );

  if (overview.error) {
    return (
      <>
        <PageHeader title="Departments" />
        <ErrorBanner
          error={overview.error}
          onRetry={() => overview.refetch()}
        />
      </>
    );
  }

  const loading = overview.isLoading;
  const hasCosts = (data?.months.length ?? 0) > 0;
  const month = data?.month ?? "";

  return (
    <>
      <PageHeader
        title="Departments"
        actions={
          <SelectNative
            aria-label="Month"
            value={month}
            disabled={!hasCosts}
            onChange={(e) => setChosenMonth(e.target.value)}
          >
            {!hasCosts ? (
              <option value={month}>{month ? monthLabel(month) : "—"}</option>
            ) : null}
            {(data?.months ?? []).map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </SelectNative>
        }
      />

      {!loading && departments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No departments yet"
          description="Departments appear here once an Admin adds them."
        />
      ) : (
        <div className="flex flex-col gap-4 p-4 sm:p-6">
          {/* Who is over */}
          {loading ? (
            <Skeleton className="h-14 w-full rounded-md" />
          ) : overCeiling.length > 0 ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>
                {overCeiling.length === 1
                  ? "1 department is over its budget ceiling"
                  : `${overCeiling.length} departments are over their budget ceiling`}{" "}
                for {monthLabel(month)}
              </AlertTitle>
              <AlertDescription>
                <ul className="flex flex-col gap-0.5">
                  {overCeiling.map((d) => (
                    <li key={d.id}>
                      <span className="font-medium">{d.name}</span> — over by{" "}
                      <span className="font-tabular">
                        {kes(d.over_budget_by_kes)}
                      </span>{" "}
                      ({kes(d.cost_kes)} of {kes(d.budget_ceiling_kes)})
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : nearCeiling.length > 0 ? (
            <Alert variant="warning">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>
                No department is over its ceiling, but{" "}
                {nearCeiling.map((d) => d.name).join(", ")}{" "}
                {nearCeiling.length === 1 ? "is" : "are"} past 90% of it
              </AlertTitle>
            </Alert>
          ) : hasCosts ? (
            <Alert variant="success">
              <CircleCheck aria-hidden="true" />
              <AlertTitle>
                Every department is within its budget ceiling for{" "}
                {monthLabel(month)}
              </AlertTitle>
            </Alert>
          ) : (
            <Alert>
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>No monthly costs yet</AlertTitle>
              <AlertDescription>
                Run <code>ML/training/billing.py</code> to price the calls and
                fill in each department&apos;s spend.
              </AlertDescription>
            </Alert>
          )}

          {/* KPI row */}
          <div
            data-tour="departments-kpis"
            className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
          >
            {loading || !data ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))
            ) : (
              <>
                <StatCard
                  label="Department spend"
                  value={kesCompact(data.total_cost_kes)}
                  delta={
                    totalDelta === null
                      ? undefined
                      : {
                          label: `${signedPct(totalDelta)} vs ${monthLabel(data.previous_month, true)}`,
                          direction: totalDelta >= 0 ? "up" : "down",
                          sentiment: totalDelta >= 0 ? "bad" : "good",
                        }
                  }
                  hint={monthLabel(month)}
                />
                <StatCard
                  label="Budget used"
                  value={
                    data.total_budget_kes
                      ? `${Math.round((data.total_cost_kes / data.total_budget_kes) * 100)}%`
                      : "—"
                  }
                  hint={
                    data.total_budget_kes
                      ? `of ${kesCompact(data.total_budget_kes)} across ceilings`
                      : "No ceilings set"
                  }
                />
                <StatCard
                  label="Over ceiling"
                  value={`${overCeiling.length} of ${departments.length}`}
                  tone={overCeiling.length > 0 ? "destructive" : "success"}
                  hint={
                    overCeiling.length > 0
                      ? `${kes(overCeiling.reduce((sum, d) => sum + d.over_budget_by_kes, 0))} over in total`
                      : `${staffOverLimit} staff over their own limit`
                  }
                />
                <StatCard
                  label="Highest cost per employee"
                  value={kes(costliestPerHead?.cost_per_head_kes)}
                  hint={costliestPerHead?.name ?? "No spend recorded"}
                />
              </>
            )}
          </div>

          {/* Against the ceiling, against last month */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <SectionCard
              title="Spend against budget ceiling"
              tourId="departments-ceiling"
              description={`${month ? monthLabel(month) : ""} — highest share of ceiling first`}
            >
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : departments.some((d) => d.budget_ceiling_kes) ? (
                <BudgetMeter
                  items={departments
                    .filter((d) => d.budget_ceiling_kes)
                    .sort(
                      (a, b) =>
                        (b.budget_used_pct ?? 0) - (a.budget_used_pct ?? 0),
                    )
                    .map((d) => ({
                      label: d.name,
                      spend: d.cost_kes,
                      ceiling: d.budget_ceiling_kes as number,
                    }))}
                />
              ) : (
                <EmptyHint>No department has a budget ceiling set.</EmptyHint>
              )}
            </SectionCard>

            <SectionCard
              title="This month against last month"
              description="Spend per department"
            >
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : hasCosts ? (
                <div className="h-64 w-full">
                  <DepartmentMonthComparisonChart
                    departments={departments}
                    month={month}
                    previousMonth={data?.previous_month ?? ""}
                  />
                </div>
              ) : (
                <EmptyHint>No monthly totals yet.</EmptyHint>
              )}
            </SectionCard>
          </div>

          {/* Against each other */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <SectionCard
              title="Spend trend by department"
              description={`Last ${data?.trend_months.length ?? 0} months with costs`}
              className="xl:col-span-2"
            >
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : (data?.trend_months.length ?? 0) > 0 ? (
                <div className="h-64 w-full">
                  <DepartmentTrendChart
                    departments={departments}
                    months={data?.trend_months ?? []}
                  />
                </div>
              ) : (
                <EmptyHint>No monthly totals yet.</EmptyHint>
              )}
            </SectionCard>

            <SectionCard
              title="Cost per employee"
              description="Spend divided by headcount — compares departments of different sizes"
            >
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <BarList
                  items={[...departments]
                    .sort(
                      (a, b) =>
                        (b.cost_per_head_kes ?? 0) - (a.cost_per_head_kes ?? 0),
                    )
                    .map((d) => ({
                      label: d.name,
                      value: d.cost_per_head_kes ?? 0,
                      display: `${kes(d.cost_per_head_kes)} · ${d.headcount} staff`,
                    }))}
                />
              )}
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <SectionCard
              title="Call minutes by type"
              description="Where each department's time on the phone goes"
              className="xl:col-span-2"
            >
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <div className="h-64 w-full">
                  <DepartmentCallMixChart departments={departments} />
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Share of total spend"
              description={month ? monthLabel(month) : undefined}
            >
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <BarList
                  items={bySpend.map((d) => ({
                    label: d.name,
                    value: d.cost_kes,
                    display: `${kesCompact(d.cost_kes)} · ${d.share_pct}%`,
                    alert: d.status === "over_budget",
                  }))}
                />
              )}
            </SectionCard>
          </div>

          {/* The figures behind the charts */}
          <SectionCard
            title="Department breakdown"
            description="Every figure above, one row per department. Click a column to sort."
            bodyClassName="px-0 pb-0"
          >
            <DataTable
              columns={columns}
              data={data?.departments}
              isLoading={loading}
              searchable={false}
              emptyIcon={Building2}
              emptyTitle="No departments yet"
              getRowId={(row) => row.id}
            />
          </SectionCard>

          {/* Inside each department */}
          {loading ? null : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {bySpend.map((d) => (
                <DepartmentDetailCard key={d.id} department={d} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** One department on its own: who its biggest spenders are, what the
 * contract discount saved it, and where next month is forecast to land. */
function DepartmentDetailCard({
  department: d,
}: {
  department: DepartmentOverviewRow;
}) {
  const forecast = d.forecast?.forecasted_cost_kes ?? null;
  const forecastOver =
    forecast !== null &&
    d.budget_ceiling_kes !== null &&
    forecast > d.budget_ceiling_kes;

  return (
    <SectionCard
      title={d.name}
      description={`${d.headcount} staff · ${d.lines} lines · ${d.staff_with_spend} with spend`}
      action={<StatusBadge status={d.status} />}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Figure label="Spend" value={kes(d.cost_kes)} />
        <Figure label="Ceiling" value={kes(d.budget_ceiling_kes)} />
        <Figure label="Saved by discount" value={kes(d.discount_kes)} />
        <Figure
          label="Staff over their limit"
          value={
            d.staff_over_limit > 0
              ? `${d.staff_over_limit} (${kes(d.staff_over_limit_kes)} over)`
              : "None"
          }
        />
        <Figure label="Open anomalies" value={String(d.open_anomalies)} />
        <Figure
          label={
            d.forecast
              ? `Forecast, ${monthLabel(d.forecast.period, true)}`
              : "Forecast"
          }
          value={
            forecast === null
              ? "Not run yet"
              : `${kes(forecast)}${forecastOver ? " — over ceiling" : ""}`
          }
          alert={forecastOver}
        />
      </dl>

      <h3 className="text-muted-foreground mt-4 mb-2 text-[0.6875rem] font-medium tracking-wide uppercase">
        Biggest spenders
      </h3>
      {d.top_spenders.length > 0 ? (
        <BarList
          items={d.top_spenders.map((s) => ({
            label: s.over_limit ? `${s.full_name} (over limit)` : s.full_name,
            value: s.cost_kes,
            display: kes(s.cost_kes),
            alert: s.over_limit,
          }))}
        />
      ) : (
        <p className="text-muted-foreground text-xs">No spend this month.</p>
      )}
    </SectionCard>
  );
}

function Figure({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          alert
            ? "font-tabular text-destructive font-medium"
            : "font-tabular font-medium"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground py-6 text-center text-xs text-balance">
      {children}
    </p>
  );
}
