"use client";

import { useMemo } from "react";
import { CalendarDays, Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/data/stat-card";
import { SectionCard } from "@/components/data/section-card";
import { BarList } from "@/components/data/bar-list";
import { BudgetMeter } from "@/components/data/budget-meter";
import { DonutChart } from "@/components/data/donut-chart";
import { SeverityBadge } from "@/components/data/severity-badge";
import { SpendChart } from "@/components/data/spend-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/data/error-banner";
import {
  useAnomalies,
  useAuditLog,
  useDepartments,
  useEmployees,
  useMyUsage,
  useOverLimit,
  useSims,
  useUsage,
  useUsageSummary,
} from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";
import { downloadCsv } from "@/lib/export-csv";
import {
  activePeriod,
  kes,
  kesCompact,
  monthLabel,
  percentDelta,
} from "@/lib/format";
import type { UsageSummary } from "@/lib/api/types";


export default function DashboardPage() {
  const user = useSession((state) => state.user);
  const isSelfService = user?.role === "Employee";

  return isSelfService ? <EmployeeDashboard /> : <OrgDashboard />;
}

// --- Org view (Admin / Manager) -----------------------------------------

function OrgDashboard() {
  const employees = useEmployees();
  const sims = useSims();
  const departments = useDepartments();
  const anomalies = useAnomalies(false);
  const overLimit = useOverLimit();
  const summaries = useUsageSummary();
  const usage = useUsage({ limit: 500 });
  // Admin-only endpoint — a Manager gets a 403 here, which is expected, so
  // the ingestion card is hidden rather than surfaced as a page error.
  const audit = useAuditLog();

  const loading =
    employees.isLoading ||
    sims.isLoading ||
    departments.isLoading ||
    summaries.isLoading;
  const error = employees.error ?? sims.error ?? departments.error;

  const rows = useMemo(
    () => summaries.data?.data ?? [],
    [summaries.data],
  );

  const period = useMemo(() => activePeriod(rows), [rows]);

  const totals = useMemo(() => {
    const sumFor = (month: string) =>
      rows
        .filter((row) => row.month === month)
        .reduce((sum, row) => sum + row.total_cost, 0);
    return {
      current: sumFor(period.month),
      previous: sumFor(period.previous),
    };
  }, [rows, period]);

  const trend = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const row of rows) {
      byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + row.total_cost);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, total]) => ({
        month: monthLabel(month, true),
        historical: total,
      }));
  }, [rows]);

  const simCounts = useMemo(() => {
    const list = sims.data?.data ?? [];
    const active = list.filter((sim) => sim.lifecycle_state === "active");
    return {
      total: list.length,
      active: active.length,
      allocated: active.filter((sim) => sim.employee_id).length,
    };
  }, [sims.data]);

  const departmentSpend = useMemo(() => {
    const deptOf = new Map(
      (employees.data?.data ?? []).map((e) => [e.id, e.department_id]),
    );
    const nameOf = new Map(
      (departments.data?.data ?? []).map((d) => [d.id, d.name]),
    );
    const byDept = new Map<string, number>();
    for (const row of rows.filter((r) => r.month === period.month)) {
      const deptId = deptOf.get(row.employee_id);
      if (!deptId) continue;
      byDept.set(deptId, (byDept.get(deptId) ?? 0) + row.total_cost);
    }
    return [...byDept.entries()]
      .map(([id, spend]) => ({
        id,
        label: nameOf.get(id) ?? "Unknown department",
        spend,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [rows, period, employees.data, departments.data]);

  // "Over threshold" = past 90% of the department's ceiling. Departments
  // with no ceiling set are unmonitored and never appear here.
  const overThreshold = useMemo(() => {
    const ceilings = new Map(
      (departments.data?.data ?? [])
        .filter((d) => d.budget_ceiling)
        .map((d) => [d.id, d.budget_ceiling as number]),
    );
    return departmentSpend
      .filter((dept) => {
        const ceiling = ceilings.get(dept.id);
        return ceiling ? dept.spend / ceiling >= 0.9 : false;
      })
      .map((dept) => ({
        label: dept.label,
        spend: dept.spend,
        ceiling: ceilings.get(dept.id) as number,
      }))
      .slice(0, 4);
  }, [departmentSpend, departments.data]);

  const budgetTotal = useMemo(
    () =>
      (departments.data?.data ?? []).reduce(
        (sum, d) => sum + (d.budget_ceiling ?? 0),
        0,
      ),
    [departments.data],
  );

  // Usage mix is measured in minutes, not row count — a hundred 12-second
  // internal calls shouldn't outweigh one long international call.
  const usageMix = useMemo(() => {
    const byClass = new Map<string, number>();
    for (const event of usage.data?.data ?? []) {
      byClass.set(
        event.call_classification,
        (byClass.get(event.call_classification) ?? 0) + event.duration_minutes,
      );
    }
    return [...byClass.entries()]
      .map(([label, value]) => ({ label, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value);
  }, [usage.data]);

  const topAnomalies = useMemo(
    () =>
      [...(anomalies.data?.data ?? [])]
        .sort((a, b) => b.anomaly_score - a.anomaly_score)
        .slice(0, 5),
    [anomalies.data],
  );

  const lastIngest = useMemo(
    () =>
      (audit.data?.data ?? []).find((entry) => entry.action === "cdr_ingested"),
    [audit.data],
  );

  const spendDelta = percentDelta(totals.current, totals.previous);

  // A real but tiny fraction of the ceiling must not round down to a flat
  // "0%", which reads as "nothing was spent".
  const budgetPct = (() => {
    if (!budgetTotal) return "—";
    const pct = (totals.current / budgetTotal) * 100;
    if (pct > 0 && pct < 1) return "<1%";
    return `${Math.round(pct)}%`;
  })();

  function handleExport() {
    downloadCsv(
      `telespy-spend-${period.month}.csv`,
      ["Employee", "Extension", "Month", "Total cost (KES)"],
      rows
        .filter((row: UsageSummary) => row.month === period.month)
        .map((row) => [
          row.full_name ?? row.employee_id,
          row.extension_code ?? "",
          row.month,
          row.total_cost.toFixed(2),
        ]),
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="p-6">
          <ErrorBanner error={error} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="A role-aware landing view summarising spend, anomalies and SIM activity."
        actions={
          <>
            <Badge variant="outline" className="h-8 gap-1.5 px-2.5">
              <CalendarDays aria-hidden="true" />
              {monthLabel(period.month)}
            </Badge>
            <Button
              type="button"
              variant="outline"
              onClick={handleExport}
              disabled={rows.length === 0}
            >
              <Download aria-hidden="true" data-icon="inline-start" />
              Export report
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4 p-6">
        {/* KPI row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))
          ) : (
            <>
              <StatCard
                label="Total spend"
                value={kesCompact(totals.current)}
                delta={
                  spendDelta === null
                    ? undefined
                    : {
                        label: `${spendDelta >= 0 ? "+" : ""}${spendDelta.toFixed(1)}% vs ${monthLabel(period.previous, true)}`,
                        direction: spendDelta >= 0 ? "up" : "down",
                        sentiment: spendDelta >= 0 ? "bad" : "good",
                      }
                }
              />
              <StatCard
                label="Budget allocation"
                value={budgetPct}
                hint={
                  budgetTotal
                    ? `${kesCompact(budgetTotal)} ceiling`
                    : "No ceilings set"
                }
              />
              <StatCard
                label="Open anomalies"
                value={String(anomalies.data?.data.length ?? 0)}
                tone={
                  (anomalies.data?.data.length ?? 0) > 0 ? "warning" : "default"
                }
                hint={`${topAnomalies.filter((a) => a.anomaly_score >= 0.65).length} high severity`}
              />
              <StatCard
                label="Active SIMs"
                value={`${simCounts.allocated.toLocaleString("en-KE")} / ${simCounts.active.toLocaleString("en-KE")}`}
                hint={
                  simCounts.active
                    ? `${Math.round((simCounts.allocated / simCounts.active) * 100)}% allocated`
                    : "None active"
                }
              />
              <StatCard
                label="Cost per active SIM"
                value={
                  simCounts.allocated
                    ? kes(totals.current / simCounts.allocated)
                    : "—"
                }
                hint={monthLabel(period.month)}
              />
            </>
          )}
        </div>

        {/* Trend + breakdowns */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <SectionCard
            title="Spend trend"
            description="Last 6 months, all departments"
            className="xl:col-span-2"
          >
            {summaries.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : trend.length > 0 ? (
              <div className="h-52 w-full">
                <SpendChart data={trend} />
              </div>
            ) : (
              <EmptyHint>
                No monthly totals yet — run <code>ML/training/billing.py</code>{" "}
                to populate usage summaries.
              </EmptyHint>
            )}
          </SectionCard>

          <SectionCard
            title="Spend by department"
            actionHref={{ label: "View all", href: "/departments" }}
          >
            {departmentSpend.length > 0 ? (
              <BarList
                items={departmentSpend.slice(0, 6).map((dept) => ({
                  label: dept.label,
                  value: dept.spend,
                  display: kesCompact(dept.spend),
                }))}
              />
            ) : (
              <EmptyHint>No attributed spend this month.</EmptyHint>
            )}
          </SectionCard>

          <SectionCard title="Usage mix" description="Minutes by call type">
            {usage.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : (
              <DonutChart
                data={usageMix}
                formatValue={(value) => `${value.toLocaleString("en-KE")} min`}
              />
            )}
          </SectionCard>
        </div>

        {/* Review queues */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SectionCard
            title="Anomalies needing review"
            className="xl:col-span-2"
            actionHref={{ label: "View all", href: "/analytics/anomalies" }}
            bodyClassName="px-0 pb-0"
          >
            {anomalies.isLoading ? (
              <div className="flex flex-col gap-2 px-4 pb-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : topAnomalies.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-border-subtle border-y text-[0.6875rem] tracking-wide uppercase">
                    <th scope="col" className="px-4 py-2 text-start font-medium">
                      Severity
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-medium">
                      Employee
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-medium">
                      Destination
                    </th>
                    <th scope="col" className="px-4 py-2 text-end font-medium">
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border-subtle divide-y">
                  {topAnomalies.map((flag) => (
                    <tr key={flag.id}>
                      <td className="px-4 py-2.5">
                        <SeverityBadge score={flag.anomaly_score} />
                      </td>
                      <td className="max-w-40 truncate px-4 py-2.5">
                        {flag.employee?.full_name ?? "Unattributed"}
                      </td>
                      <td className="font-tabular text-muted-foreground px-4 py-2.5 text-xs">
                        {flag.event?.destination ?? "—"}
                      </td>
                      <td className="font-tabular px-4 py-2.5 text-end">
                        {flag.anomaly_score.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-4 pb-4">
                <EmptyHint>No open anomalies right now.</EmptyHint>
              </div>
            )}
          </SectionCard>

          <div className="flex flex-col gap-4">
            <SectionCard
              title="Budgets over threshold"
              description="Past 90% of ceiling"
              actionHref={{ label: "View all", href: "/budgets" }}
            >
              {overThreshold.length > 0 ? (
                <BudgetMeter items={overThreshold} />
              ) : (
                <EmptyHint>
                  {overLimit.data?.data.length
                    ? `${overLimit.data.data.length} individual limit breach(es), but no department past 90%.`
                    : "Every department is within its ceiling."}
                </EmptyHint>
              )}
            </SectionCard>

            {lastIngest ? (
              <SectionCard
                title="Recent CDR ingestion"
                actionHref={{ label: "Open", href: "/ingestion" }}
              >
                <p className="font-tabular truncate text-xs">
                  {String(lastIngest.meta.source_file ?? "manual upload")}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground font-tabular text-xs">
                    {Number(lastIngest.meta.ingested ?? 0).toLocaleString(
                      "en-KE",
                    )}{" "}
                    rows
                  </span>
                  <Badge variant="secondary">
                    {Number(lastIngest.meta.unattributed ?? 0) > 0
                      ? `${lastIngest.meta.unattributed} unattributed`
                      : "Fully attributed"}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  {new Date(lastIngest.occured_at).toLocaleString("en-KE")}
                </p>
              </SectionCard>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground py-6 text-center text-xs text-balance">
      {children}
    </p>
  );
}

// --- Self-service view (Employee) ---------------------------------------

function EmployeeDashboard() {
  const user = useSession((state) => state.user);
  const myUsage = useMyUsage();
  const summaries = myUsage.data?.data.cost_summaries ?? [];
  const period = activePeriod(summaries);
  const currentSummary = summaries.find((s) => s.month === period.month);
  const limit = myUsage.data?.data.limit_kshs ?? null;
  const recentEvents = myUsage.data?.data.usage.slice(0, 6) ?? [];

  if (myUsage.error) {
    return (
      <>
        <PageHeader title="Your usage" />
        <div className="p-6">
          <ErrorBanner error={myUsage.error} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Welcome back${user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}`}
        description="Your telecom usage and spend at a glance."
        actions={
          <Badge variant="outline" className="h-8 gap-1.5 px-2.5">
            <CalendarDays aria-hidden="true" />
            {monthLabel(period.month)}
          </Badge>
        }
      />
      <div className="flex flex-col gap-4 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {myUsage.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))
          ) : (
            <>
              <StatCard
                label={`Spend — ${monthLabel(period.month)}`}
                value={kes(currentSummary?.total_cost ?? 0)}
                hint={limit ? `${kes(limit)} limit` : "No limit set"}
                tone={
                  limit && (currentSummary?.total_cost ?? 0) > limit
                    ? "destructive"
                    : "default"
                }
              />
              <StatCard
                label="Extension"
                value={
                  myUsage.data?.data.current_sim?.extension ??
                  myUsage.data?.data.current_sim?.msisdn_masked ??
                  "—"
                }
                hint={myUsage.data?.data.current_sim?.provider ?? undefined}
              />
              <StatCard
                label="Usage profile"
                value={
                  myUsage.data?.data.usage_profile_cluster?.replace("_", " ") ??
                  "Not yet profiled"
                }
                hint="K-means cluster"
              />
            </>
          )}
        </div>

        <SectionCard
          title="Recent calls"
          actionHref={{ label: "View invoices", href: "/invoices" }}
          bodyClassName="px-0 pb-0"
        >
          {myUsage.isLoading ? (
            <div className="flex flex-col gap-2 px-4 pb-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : recentEvents.length > 0 ? (
            <ul className="divide-border-subtle border-border-subtle divide-y border-t">
              {recentEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="font-tabular truncate">
                    {event.destination}
                  </span>
                  <span className="text-muted-foreground font-tabular shrink-0 text-xs">
                    {event.duration_minutes.toFixed(1)} min
                  </span>
                  <Badge variant="outline" className="shrink-0">
                    {event.call_classification}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 pb-4">
              <EmptyHint>No calls recorded yet.</EmptyHint>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Monthly history">
          {summaries.length > 0 ? (
            <BarList
              items={[...summaries]
                .sort((a, b) => a.month.localeCompare(b.month))
                .slice(-6)
                .map((summary) => ({
                  label: monthLabel(summary.month),
                  value: summary.total_cost,
                  display: kes(summary.total_cost),
                  alert: !!limit && summary.total_cost > limit,
                }))}
            />
          ) : (
            <EmptyHint>No monthly totals yet.</EmptyHint>
          )}
        </SectionCard>
      </div>
    </>
  );
}
