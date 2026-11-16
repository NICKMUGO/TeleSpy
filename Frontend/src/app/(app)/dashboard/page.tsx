"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/data/stat-card";
import { SectionCard } from "@/components/data/section-card";
import { BarList } from "@/components/data/bar-list";
import { BudgetMeter } from "@/components/data/budget-meter";
import { DonutChart } from "@/components/data/donut-chart";
import { SeverityBadge } from "@/components/data/severity-badge";
import { SpendChart } from "@/components/data/spend-chart";
import { Badge } from "@/components/ui/badge";
import { SelectNative } from "@/components/ui/select-native";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/data/error-banner";
import {
  useAnomalies,
  useCdrBatches,
  useDepartments,
  useEmployees,
  useMyUsage,
  useOverLimit,
  useSims,
  useTicketAccess,
  useUsage,
  useUsageSummary,
} from "@/lib/api/hooks";
import { TicketDesk } from "@/features/tickets/ticket-desk";
import { cn } from "@/lib/utils";
import { HIGH_SEVERITY_THRESHOLD } from "@/lib/anomaly-severity";
import { useSession } from "@/lib/auth/session-store";
import {
  activePeriod,
  callDuration,
  kes,
  kesCompact,
  monthKey,
  monthLabel,
  percentDelta,
} from "@/lib/format";

const UNKNOWN_DEPARTMENT = "unknown";

export default function DashboardPage() {
  const user = useSession((state) => state.user);
  const ticketAccess = useTicketAccess();
  const isSelfService = user?.role === "Employee";

  // The customer service desk signs in to its ticket desk, not the telecom
  // dashboard. Wait for that answer rather than flash the wrong view.
  if (ticketAccess.isLoading) {
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  const usageView = isSelfService ? <EmployeeDashboard /> : <OrgDashboard />;
  if (ticketAccess.data?.data.on_desk) {
    return (
      <DeskDashboard
        usage={usageView}
        usageLabel={isSelfService ? "My usage" : "Telecom"}
      />
    );
  }
  return usageView;
}

/** The customer service desk opens on its tickets, with a switch to the
 * same usage view everyone else gets (their own SIM usage, or — for the
 * desk's Manager — the department's). */
function DeskDashboard({
  usage,
  usageLabel,
}: {
  usage: ReactNode;
  usageLabel: string;
}) {
  const [view, setView] = useState<"tickets" | "usage">("tickets");
  return (
    <>
      <div className="flex justify-center px-4 pt-4 sm:justify-start sm:px-6">
        <div
          role="tablist"
          aria-label="Dashboard view"
          className="bg-muted inline-flex rounded-lg p-1 text-sm"
        >
          {(
            [
              ["tickets", "Ticket desk"],
              ["usage", usageLabel],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium transition-colors",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                view === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === "tickets" ? <TicketDesk /> : usage}
    </>
  );
}

// --- Org view (Admin / Manager) -----------------------------------------

function OrgDashboard() {
  const employees = useEmployees();
  const sims = useSims();
  const departments = useDepartments();
  const anomalies = useAnomalies(false);
  const summaries = useUsageSummary();
  const usage = useUsage({ limit: 500 });
  // Admin-only endpoint — a Manager gets a 403 here, which is expected, so
  // the ingestion card is hidden rather than surfaced as a page error.
  const batches = useCdrBatches({ limit: 1 });

  const loading =
    employees.isLoading ||
    sims.isLoading ||
    departments.isLoading ||
    summaries.isLoading;
  const error = employees.error ?? sims.error ?? departments.error;

  const rows = useMemo(() => summaries.data?.data ?? [], [summaries.data]);

  // Every month that has costs, newest first — the dashboard opens on the
  // latest and can be switched to any other; the report exports whichever
  // month is on screen.
  const months = useMemo(
    () => [...new Set(rows.map((row) => row.month))].sort().reverse(),
    [rows],
  );
  const [chosenMonth, setChosenMonth] = useState<string | null>(null);
  const period = useMemo(() => {
    const latest = activePeriod(rows);
    if (!chosenMonth || !months.includes(chosenMonth)) return latest;
    const [year, index] = chosenMonth.split("-").map(Number);
    return {
      month: chosenMonth,
      previous: monthKey(new Date(year, index - 2, 1)),
    };
  }, [rows, months, chosenMonth]);
  const overLimit = useOverLimit(period.month);

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
      // Departments whose name isn't known (the department list hasn't
      // loaded yet, or the department was removed) share one row, so the
      // chart never gets several rows with the same label.
      const key = nameOf.has(deptId) ? deptId : UNKNOWN_DEPARTMENT;
      byDept.set(key, (byDept.get(key) ?? 0) + row.total_cost);
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

  const lastIngest = batches.data?.data[0];

  const spendDelta = percentDelta(totals.current, totals.previous);

  // A real but tiny fraction of the ceiling must not round down to a flat
  // "0%", which reads as "nothing was spent".
  const budgetPct = (() => {
    if (!budgetTotal) return "—";
    const pct = (totals.current / budgetTotal) * 100;
    if (pct > 0 && pct < 1) return "<1%";
    return `${Math.round(pct)}%`;
  })();

  if (error) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="p-4 sm:p-6">
          <ErrorBanner error={error} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <SelectNative
              aria-label="Month"
              value={period.month}
              disabled={months.length === 0}
              onChange={(e) => setChosenMonth(e.target.value)}
            >
              {months.length === 0 ? (
                <option value={period.month}>{monthLabel(period.month)}</option>
              ) : null}
              {months.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </SelectNative>
            {rows.length === 0 ? (
              <Button type="button" variant="outline" disabled>
                <FileText aria-hidden="true" data-icon="inline-start" />
                Export report
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href={`/report?month=${period.month}`}>
                  <FileText aria-hidden="true" data-icon="inline-start" />
                  Export report
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {/* KPI row */}
        <div
          data-tour="dashboard-kpis"
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5"
        >
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
                hint={`${topAnomalies.filter((a) => a.anomaly_score >= HIGH_SEVERITY_THRESHOLD).length} high severity`}
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
            bodyClassName="overflow-x-auto px-0 pb-0"
          >
            {anomalies.isLoading ? (
              <div className="flex flex-col gap-2 px-4 pb-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : topAnomalies.length > 0 ? (
              <table data-stack className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-border-subtle border-y text-[0.6875rem] tracking-wide uppercase">
                    <th
                      scope="col"
                      className="px-4 py-2 text-start font-medium"
                    >
                      Severity
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-start font-medium"
                    >
                      Employee
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-start font-medium"
                    >
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
              title="Near or over spending limit"
              description="Past 90% of their monthly limit"
              actionHref={{ label: "View invoices", href: "/invoices" }}
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
                  {lastIngest.source_file ?? "manual upload"}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground font-tabular text-xs">
                    {lastIngest.ingested.toLocaleString("en-KE")} rows
                  </span>
                  <Badge variant="secondary">
                    {lastIngest.unattributed > 0
                      ? `${lastIngest.unattributed} unattributed`
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

/** The employee's own standing against their monthly limit: a plain
 * verdict for the latest month, then every month with what was spent and,
 * where they went over, by how much — the amount they are invoiced for. */
function SpendingLimitSection({
  summaries,
  limit,
  isLoading,
}: {
  summaries: { month: string; total_cost: number }[];
  limit: number | null;
  isLoading: boolean;
}) {
  const months = [...summaries].sort((a, b) => b.month.localeCompare(a.month));
  const latest = months[0];
  const latestOverBy = latest && limit !== null ? latest.total_cost - limit : 0;
  const monthsOver =
    limit === null ? 0 : months.filter((m) => m.total_cost > limit).length;

  return (
    <SectionCard
      title="Your spending limit"
      description={
        limit === null
          ? "No monthly limit is set for your role."
          : `${kes(limit)} a month. You are invoiced only for the amount you go over it.`
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : limit === null || !latest ? (
        <EmptyHint>
          {limit === null
            ? "You have no monthly limit, so you're never invoiced for calls."
            : "No monthly totals yet."}
        </EmptyHint>
      ) : (
        <div className="flex flex-col gap-3">
          <p
            role="status"
            className={
              latestOverBy > 0
                ? "text-destructive text-sm font-medium"
                : "text-success text-sm font-medium"
            }
          >
            {latestOverBy > 0
              ? `You are over your limit for ${monthLabel(latest.month)} by ${kes(latestOverBy)}.`
              : `You are within your limit for ${monthLabel(latest.month)}, with ${kes(limit - latest.total_cost)} to spare.`}
            {monthsOver > 0 ? (
              <span className="text-muted-foreground font-normal">
                {" "}
                Over the limit in {monthsOver} of {months.length}{" "}
                {months.length === 1 ? "month" : "months"} on record.
              </span>
            ) : null}
          </p>
          <div className="border-border-subtle overflow-x-auto rounded-lg border">
            <table data-stack className="w-full text-sm">
              <caption className="sr-only">
                Your call costs against your limit, by month
              </caption>
              <thead className="border-border-subtle bg-muted/40 border-b">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Month
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Spent
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Limit
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Over by
                  </th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const overBy = m.total_cost - limit;
                  return (
                    <tr
                      key={m.month}
                      className="border-border-subtle border-b last:border-b-0"
                    >
                      <th
                        scope="row"
                        className="px-3 py-2 text-left font-normal whitespace-nowrap"
                      >
                        {monthLabel(m.month)}
                      </th>
                      <td className="font-tabular px-3 py-2 text-right">
                        {kes(m.total_cost)}
                      </td>
                      <td className="font-tabular text-muted-foreground px-3 py-2 text-right">
                        {kes(limit)}
                      </td>
                      <td
                        className={
                          overBy > 0
                            ? "font-tabular text-destructive px-3 py-2 text-right font-medium"
                            : "font-tabular text-muted-foreground px-3 py-2 text-right"
                        }
                      >
                        {overBy > 0 ? kes(overBy) : "Within limit"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
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
  // Null until the employee picks a month — the view opens on their latest.
  const [chosenMonth, setChosenMonth] = useState<string | null>(null);
  const myUsage = useMyUsage(chosenMonth ?? undefined);
  const summaries = useMemo(
    () => myUsage.data?.data.cost_summaries ?? [],
    [myUsage.data],
  );
  // Every month the company has been billed for, plus any of the
  // employee's own, newest first — a month they made no calls in is still
  // pickable and simply shows KES 0.
  const billedMonths = myUsage.data?.data.billed_months;
  const months = useMemo(
    () =>
      [...new Set([...(billedMonths ?? []), ...summaries.map((s) => s.month)])]
        .sort()
        .reverse(),
    [billedMonths, summaries],
  );
  const month =
    chosenMonth && months.includes(chosenMonth)
      ? chosenMonth
      : (months[0] ?? activePeriod(summaries).month);
  const currentSummary = summaries.find((s) => s.month === month);
  const limit = myUsage.data?.data.limit_kshs ?? null;
  const recentEvents = myUsage.data?.data.usage.slice(0, 6) ?? [];
  const callCount = myUsage.data?.meta?.total;

  if (myUsage.error) {
    return (
      <>
        <PageHeader title="Your usage" />
        <div className="p-4 sm:p-6">
          <ErrorBanner error={myUsage.error} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Welcome back${user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}`}
        actions={
          months.length > 1 ? (
            <SelectNative
              aria-label="Month"
              value={month}
              onChange={(e) => setChosenMonth(e.target.value)}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </SelectNative>
          ) : (
            <Badge variant="outline" className="h-8 gap-1.5 px-2.5">
              <CalendarDays aria-hidden="true" />
              {monthLabel(month)}
            </Badge>
          )
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div
          data-tour="dashboard-kpis"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"
        >
          {myUsage.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))
          ) : (
            <>
              <StatCard
                label={`Spend — ${monthLabel(month)}`}
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

        <SpendingLimitSection
          summaries={summaries}
          limit={limit}
          isLoading={myUsage.isLoading}
        />

        <SectionCard
          title={chosenMonth ? `Calls in ${monthLabel(month)}` : "Recent calls"}
          description={
            chosenMonth && callCount !== undefined
              ? `Latest ${Math.min(recentEvents.length, callCount)} of ${callCount}`
              : undefined
          }
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
                    {callDuration(event.duration_minutes)}
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
