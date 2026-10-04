"use client";

import { useMemo, useState } from "react";
import { Check, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/data/section-card";
import { SeverityBadge } from "@/components/data/severity-badge";
import { StatCard } from "@/components/data/stat-card";
import { EmptyState } from "@/components/data/empty-state";
import { ErrorBanner } from "@/components/data/error-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";
import { AnomalyDetailSheet } from "@/features/anomalies/anomaly-detail-sheet";
import { ApiError } from "@/lib/api/client";
import { severityOf, type Severity } from "@/lib/anomaly-severity";
import {
  useAnomalies,
  useDepartments,
  useEmployees,
  useResolveAnomaly,
  useUsageSummary,
} from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";
import { downloadCsv } from "@/lib/export-csv";
import { activePeriod, kes, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AnomalyFlag } from "@/lib/api/types";

type StatusFilter = "open" | "resolved" | "all";
type SeverityFilter = "all" | Severity;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Computed once at module load, matching the CALENDAR_MONTH pattern in the
// dashboard page — Date.now() may not be called during render itself.
const WEEK_CUTOFF_MS = Date.now() - WEEK_MS;

export default function AnomaliesPage() {
  const [status, setStatus] = useState<StatusFilter>("open");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openFlag, setOpenFlag] = useState<AnomalyFlag | null>(null);

  const anomalies = useAnomalies(
    status === "all" ? undefined : status === "resolved",
  );
  const resolveAnomaly = useResolveAnomaly();
  const employees = useEmployees();
  const departments = useDepartments();
  const summaries = useUsageSummary();
  const role = useSession((state) => state.user?.role);
  const canResolve = role === "Admin";

  const all = useMemo(() => anomalies.data?.data ?? [], [anomalies.data]);

  // event.computed_cost is always 0 — ingestion no longer writes it (see
  // CdrController); real per-employee cost only exists in usage_summaries,
  // written on its own schedule by ML/training/billing.py. Department name
  // and "flagged spend" are both derived from that join instead of the
  // per-event field, which would otherwise render KES 0 everywhere.
  const departmentOf = useMemo(() => {
    const deptId = new Map(
      (employees.data?.data ?? []).map((e) => [e.id, e.department_id]),
    );
    const deptName = new Map(
      (departments.data?.data ?? []).map((d) => [d.id, d.name]),
    );
    return (employeeId: string | undefined) => {
      if (!employeeId) return null;
      const id = deptId.get(employeeId);
      return id ? (deptName.get(id) ?? null) : null;
    };
  }, [employees.data, departments.data]);

  const period = useMemo(
    () => activePeriod(summaries.data?.data ?? []),
    [summaries.data],
  );

  const costOf = useMemo(() => {
    const byEmployee = new Map(
      (summaries.data?.data ?? [])
        .filter((row) => row.month === period.month)
        .map((row) => [row.employee_id, row.total_cost]),
    );
    return (employeeId: string | undefined) =>
      employeeId ? (byEmployee.get(employeeId) ?? null) : null;
  }, [summaries.data, period]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all
      .filter((flag) =>
        severity === "all" ? true : severityOf(flag.anomaly_score) === severity,
      )
      .filter((flag) => {
        if (!needle) return true;
        return (
          (flag.employee?.full_name ?? "").toLowerCase().includes(needle) ||
          (flag.event?.destination ?? "").toLowerCase().includes(needle) ||
          (flag.event?.msisdn_pbx ?? "").toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => b.anomaly_score - a.anomaly_score);
  }, [all, severity, query]);

  const stats = useMemo(() => {
    const open = all.filter((flag) => !flag.resolved);
    return {
      open: open.length,
      high: open.filter((flag) => severityOf(flag.anomaly_score) === "high")
        .length,
      thisWeek: all.filter((flag) => {
        const at = flag.event?.occured_at;
        return at ? new Date(at).getTime() >= WEEK_CUTOFF_MS : false;
      }).length,
      // Sum each affected employee's month-to-date spend once, not once
      // per anomaly — an employee with five open flags shouldn't count
      // their own total five times over.
      exposure: [
        ...new Set(
          open.map((flag) => flag.employee?.id).filter((id): id is string => !!id),
        ),
      ].reduce((sum, id) => sum + (costOf(id) ?? 0), 0),
    };
  }, [all, costOf]);

  const selectedOpen = useMemo(
    () => rows.filter((flag) => selected.has(flag.id) && !flag.resolved),
    [rows, selected],
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) =>
      current.size === rows.length
        ? new Set()
        : new Set(rows.map((flag) => flag.id)),
    );
  }

  async function handleResolve(ids: string[]) {
    let failed = 0;
    for (const id of ids) {
      try {
        await resolveAnomaly.mutateAsync(id);
      } catch (error) {
        failed++;
        if (failed === 1) {
          toast.error(
            error instanceof ApiError
              ? error.message
              : "Couldn't resolve this anomaly.",
          );
        }
      }
    }
    const resolved = ids.length - failed;
    if (resolved > 0) toast.success(`Resolved ${resolved} anomal${resolved === 1 ? "y" : "ies"}.`);
    setSelected(new Set());
    setOpenFlag(null);
  }

  return (
    <>
      <PageHeader
        title="Anomalies"
        description="Usage flagged by the Isolation Forest model for review."
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                "telespy-anomalies.csv",
                [
                  "Severity",
                  "Score",
                  "Employee",
                  "Department",
                  "Extension",
                  "Destination",
                  "Occurred",
                  "Status",
                ],
                rows.map((flag) => [
                  severityOf(flag.anomaly_score),
                  flag.anomaly_score.toFixed(4),
                  flag.employee?.full_name ?? "Unattributed",
                  departmentOf(flag.employee?.id) ?? "",
                  flag.event?.msisdn_pbx ?? "",
                  flag.event?.destination ?? "",
                  flag.event?.occured_at ?? "",
                  flag.resolved ? "resolved" : "open",
                ]),
              )
            }
          >
            Export
          </Button>
        }
      />

      <div className="flex flex-col gap-4 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {anomalies.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))
          ) : (
            <>
              <StatCard
                label="Open anomalies"
                value={String(stats.open)}
                tone={stats.open > 0 ? "warning" : "default"}
                hint={`${stats.high} high severity`}
              />
              <StatCard
                label="Flagged this week"
                value={String(stats.thisWeek)}
                hint="By event date"
              />
              <StatCard
                label="Flagged spend"
                value={kes(stats.exposure)}
                hint={`${monthLabel(period.month)} · affected employees`}
              />
            </>
          )}
        </div>

        <SectionCard title="Flagged usage" bodyClassName="px-0 pb-0">
          {/* Filters */}
          <div className="border-border-subtle flex flex-wrap items-end gap-3 border-y px-4 py-3">
            <div className="relative min-w-52 flex-1">
              <Label htmlFor="anomaly-search" className="sr-only">
                Search anomalies
              </Label>
              <Search
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id="anomaly-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search employee, extension or destination"
                className="h-9 ps-8"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="anomaly-severity" className="text-xs">
                Severity
              </Label>
              <SelectNative
                id="anomaly-severity"
                value={severity}
                onChange={(event) =>
                  setSeverity(event.target.value as SeverityFilter)
                }
                className="w-36"
              >
                <option value="all">All severities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </SelectNative>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="anomaly-status" className="text-xs">
                Status
              </Label>
              <SelectNative
                id="anomaly-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as StatusFilter);
                  setSelected(new Set());
                }}
                className="w-32"
              >
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="all">All</option>
              </SelectNative>
            </div>
          </div>

          {/* Bulk actions — only the action the API actually exposes
           * (POST /analytics/anomalies/{id}/resolve). */}
          {canResolve && selectedOpen.length > 0 ? (
            <div className="bg-muted/60 border-border-subtle flex items-center gap-3 border-b px-4 py-2">
              <span className="text-xs font-medium">
                {selectedOpen.length} selected
              </span>
              <Button
                type="button"
                size="sm"
                disabled={resolveAnomaly.isPending}
                onClick={() =>
                  handleResolve(selectedOpen.map((flag) => flag.id))
                }
              >
                <Check aria-hidden="true" data-icon="inline-start" />
                Resolve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
          ) : null}

          {anomalies.error ? (
            <div className="p-4">
              <ErrorBanner
                error={anomalies.error}
                onRetry={() => anomalies.refetch()}
              />
            </div>
          ) : anomalies.isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={TriangleAlert}
              title="No anomalies to show"
              description="Nothing matches these filters. Isolation Forest may not have flagged anything in this view yet."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-border-subtle border-b text-[0.6875rem] tracking-wide uppercase">
                      {canResolve ? (
                        <th scope="col" className="w-10 ps-4">
                          <Checkbox
                            checked={
                              rows.length > 0 && selected.size === rows.length
                            }
                            onCheckedChange={toggleAll}
                            aria-label="Select all anomalies"
                          />
                        </th>
                      ) : null}
                      <Th>Severity</Th>
                      <Th>Employee</Th>
                      <Th>Department</Th>
                      <Th>Extension</Th>
                      <Th>Destination</Th>
                      <Th align="end">Score</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-border-subtle divide-y">
                    {rows.map((flag) => (
                      <tr
                        key={flag.id}
                        className={cn(
                          "hover:bg-muted/50",
                          selected.has(flag.id) && "bg-muted/40",
                        )}
                      >
                        {canResolve ? (
                          <td className="ps-4">
                            <Checkbox
                              checked={selected.has(flag.id)}
                              onCheckedChange={() => toggle(flag.id)}
                              aria-label={`Select anomaly for ${flag.employee?.full_name ?? "unattributed event"}`}
                            />
                          </td>
                        ) : null}
                        <td className="px-4 py-2.5">
                          <SeverityBadge score={flag.anomaly_score} />
                        </td>
                        <td className="max-w-40 px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => setOpenFlag(flag)}
                            className="focus-visible:ring-ring max-w-full truncate rounded-sm text-start hover:underline focus-visible:ring-2 focus-visible:outline-none"
                          >
                            {flag.employee?.full_name ?? "Unattributed"}
                          </button>
                        </td>
                        <td className="text-muted-foreground max-w-32 truncate px-4 py-2.5 text-xs">
                          {departmentOf(flag.employee?.id) ?? "—"}
                        </td>
                        <td className="font-tabular text-muted-foreground px-4 py-2.5 text-xs">
                          {flag.event?.msisdn_pbx ?? "—"}
                        </td>
                        <td className="font-tabular px-4 py-2.5 text-xs">
                          {flag.event?.destination ?? "—"}
                        </td>
                        <td className="font-tabular px-4 py-2.5 text-end">
                          {flag.anomaly_score.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge
                            variant={flag.resolved ? "secondary" : "destructive"}
                          >
                            {flag.resolved ? "Resolved" : "Open"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground border-border-subtle border-t px-4 py-2.5 text-xs">
                Showing {rows.length} of {all.length} anomalies
              </p>
            </>
          )}
        </SectionCard>
      </div>

      <AnomalyDetailSheet
        flag={openFlag}
        onOpenChange={(open) => !open && setOpenFlag(null)}
        onResolve={(id) => handleResolve([id])}
        resolving={resolveAnomaly.isPending}
        canResolve={canResolve}
      />
    </>
  );
}

function Th({
  children,
  align = "start",
}: {
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2 font-medium",
        align === "end" ? "text-end" : "text-start",
      )}
    >
      {children}
    </th>
  );
}
