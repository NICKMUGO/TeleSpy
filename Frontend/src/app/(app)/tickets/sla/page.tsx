"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AlarmClock, CircleCheckBig } from "lucide-react";
import { EmptyState } from "@/components/data/empty-state";
import { ErrorBanner } from "@/components/data/error-banner";
import { SectionCard } from "@/components/data/section-card";
import { StatCard } from "@/components/data/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { SelectNative } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";
import { TicketList } from "@/features/tickets/ticket-list";
import {
  PRIORITY_LABELS,
  PriorityBadge,
  SlaBadge,
} from "@/features/tickets/ticket-status";
import { useSlaReport } from "@/lib/api/hooks";
import type { SlaFigures } from "@/lib/api/types";
import { dateTime, duration, monthKey, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The last twelve months, newest first. */
function recentMonths() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) =>
    monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)),
  );
}

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);
const avg = (minutes: number | null) =>
  minutes === null ? "—" : duration(minutes);

function complianceTone(value: number | null) {
  if (value === null) return "default" as const;
  if (value >= 90) return "success" as const;
  if (value >= 75) return "warning" as const;
  return "destructive" as const;
}

/** The organisation against the ticket SLA: of the tickets resolved in a
 * month, how many were resolved by their deadline — overall, per priority,
 * per department and per person — and what is overdue right now. */
export default function SlaReportPage() {
  const months = recentMonths();
  const [month, setMonth] = useState(months[0]);
  const report = useSlaReport(month);
  const r = report.data?.data;

  return (
    <>
      <PageHeader
        title="SLA report"
        meta="Tickets resolved by their deadline, across the organisation"
        actions={
          <SelectNative
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </SelectNative>
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {report.error ? (
          <ErrorBanner error={report.error} onRetry={() => report.refetch()} />
        ) : !r ? (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-48 w-full" />
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                label="Met SLA"
                value={pct(r.totals.compliance_pct)}
                tone={complianceTone(r.totals.compliance_pct)}
                hint={`${r.totals.met} of ${r.totals.resolved} resolved in time`}
              />
              <StatCard
                label="Missed SLA"
                value={String(r.totals.missed)}
                tone={r.totals.missed > 0 ? "destructive" : "default"}
                hint={`Resolved late in ${monthLabel(r.month)}`}
              />
              <StatCard
                label="Overdue now"
                value={String(r.totals.overdue_open)}
                tone={r.totals.overdue_open > 0 ? "warning" : "default"}
                hint="Open past the deadline"
              />
              <StatCard
                label="Average time to resolve"
                value={avg(r.totals.avg_resolution_minutes)}
                hint="Raised to resolved"
              />
            </div>

            <SectionCard
              title="By priority"
              description="Targets are set by an Admin in Settings."
              bodyClassName="px-0 pb-0"
            >
              <FiguresTable
                firstHeader="Priority"
                extraHeader="Target"
                rows={r.by_priority.map((row) => ({
                  key: row.priority,
                  first: <PriorityBadge priority={row.priority} />,
                  extra: `within ${duration(row.target_hours * 60)}`,
                  overdue: row.overdue_open,
                  figures: row,
                }))}
              />
            </SectionCard>

            <SectionCard
              title="By department"
              description="The department that handled the ticket — lowest compliance first."
              bodyClassName="px-0 pb-0"
            >
              {r.by_department.length === 0 ? (
                <EmptyState
                  icon={CircleCheckBig}
                  title={`No tickets resolved in ${monthLabel(r.month)}`}
                />
              ) : (
                <FiguresTable
                  firstHeader="Department"
                  rows={r.by_department.map((row) => ({
                    key: row.department_id,
                    first: row.department_name ?? "—",
                    overdue: row.overdue_open,
                    figures: row,
                  }))}
                />
              )}
            </SectionCard>

            {r.by_resolver.length > 0 ? (
              <SectionCard
                title="Resolved by"
                description="Everyone who closed a ticket this month."
                bodyClassName="px-0 pb-0"
              >
                <FiguresTable
                  firstHeader="Person"
                  extraHeader="Department"
                  rows={r.by_resolver.map((row) => ({
                    key: row.user_id,
                    first: row.name ?? "—",
                    extra: row.department_name ?? "—",
                    figures: row,
                  }))}
                />
              </SectionCard>
            ) : null}

            <SectionCard
              title={`Overdue now${r.overdue.length ? ` (${r.overdue.length})` : ""}`}
              description="Open tickets past their deadline that you can see, most overdue first."
              bodyClassName="px-0 pb-0"
            >
              <TicketList
                tickets={r.overdue}
                isLoading={false}
                perspective="desk"
                emptyIcon={AlarmClock}
                emptyTitle="Nothing overdue"
              />
            </SectionCard>

            <SectionCard
              title="Resolved tickets"
              description={`Resolved in ${monthLabel(r.month)}: who closed each one, when, and whether it was in time.`}
              bodyClassName="px-0 pb-0"
            >
              {r.resolved.length === 0 ? (
                <EmptyState
                  icon={CircleCheckBig}
                  title="No resolved tickets you can see"
                />
              ) : (
                <div className="overflow-x-auto">
                  <table data-stack className="w-full text-sm">
                    <thead className="text-muted-foreground border-border-subtle border-y text-xs">
                      <tr>
                        {[
                          "Ticket",
                          "Priority",
                          "Department",
                          "Resolved by",
                          "Resolved",
                          "Took",
                          "SLA",
                        ].map((h) => (
                          <th
                            key={h}
                            scope="col"
                            className="px-4 py-2 text-left font-medium"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-border-subtle divide-y">
                      {r.resolved.map((t) => (
                        <tr key={t.id}>
                          <td data-label="Ticket" className="px-4 py-2">
                            <Link
                              href={`/tickets/${t.id}`}
                              className="underline-offset-2 hover:underline"
                            >
                              <span className="text-muted-foreground font-tabular text-xs">
                                {t.number}
                              </span>{" "}
                              {t.subject}
                            </Link>
                          </td>
                          <td data-label="Priority" className="px-4 py-2">
                            {PRIORITY_LABELS[t.priority]}
                          </td>
                          <td data-label="Department" className="px-4 py-2">
                            {t.department_name}
                          </td>
                          <td data-label="Resolved by" className="px-4 py-2">
                            {t.resolved_by_name ?? "—"}
                          </td>
                          <td
                            data-label="Resolved"
                            className="px-4 py-2 whitespace-nowrap"
                          >
                            {t.resolved_at ? dateTime(t.resolved_at) : "—"}
                          </td>
                          <td
                            data-label="Took"
                            className="font-tabular px-4 py-2 whitespace-nowrap"
                          >
                            {avg(t.resolution_minutes)}
                          </td>
                          <td data-label="SLA" className="px-4 py-2">
                            <SlaBadge ticket={t} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </>
  );
}

function FiguresTable({
  firstHeader,
  extraHeader,
  rows,
}: {
  firstHeader: string;
  extraHeader?: string;
  rows: {
    key: string;
    first: ReactNode;
    extra?: string;
    /** Left out where it doesn't apply (people). */
    overdue?: number;
    figures: SlaFigures;
  }[];
}) {
  const showOverdue = rows.some((row) => row.overdue !== undefined);
  const numeric = [
    "Resolved",
    "Met",
    "Missed",
    "Met SLA",
    "Avg time",
    ...(showOverdue ? ["Overdue now"] : []),
  ];
  return (
    <div className="overflow-x-auto">
      <table data-stack className="w-full text-sm">
        <thead className="text-muted-foreground border-border-subtle border-y text-xs">
          <tr>
            <th scope="col" className="px-4 py-2 text-left font-medium">
              {firstHeader}
            </th>
            {extraHeader ? (
              <th scope="col" className="px-4 py-2 text-left font-medium">
                {extraHeader}
              </th>
            ) : null}
            {numeric.map((h) => (
              <th
                key={h}
                scope="col"
                className="px-4 py-2 text-right font-medium"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border-subtle divide-y">
          {rows.map((row) => {
            const f = row.figures;
            const tone = complianceTone(f.compliance_pct);
            return (
              <tr key={row.key}>
                <td data-label={firstHeader} className="px-4 py-2">
                  {row.first}
                </td>
                {extraHeader ? (
                  <td
                    data-label={extraHeader}
                    className="text-muted-foreground px-4 py-2"
                  >
                    {row.extra}
                  </td>
                ) : null}
                <td
                  data-label="Resolved"
                  className="font-tabular px-4 py-2 text-right"
                >
                  {f.resolved}
                </td>
                <td
                  data-label="Met"
                  className="font-tabular px-4 py-2 text-right"
                >
                  {f.met}
                </td>
                <td
                  data-label="Missed"
                  className={cn(
                    "font-tabular px-4 py-2 text-right",
                    f.missed > 0 && "text-destructive",
                  )}
                >
                  {f.missed}
                </td>
                <td
                  data-label="Met SLA"
                  className={cn(
                    "font-tabular px-4 py-2 text-right font-medium",
                    tone === "success" && "text-success",
                    tone === "warning" && "text-warning",
                    tone === "destructive" && "text-destructive",
                  )}
                >
                  {pct(f.compliance_pct)}
                </td>
                <td
                  data-label="Avg time"
                  className="font-tabular px-4 py-2 text-right whitespace-nowrap"
                >
                  {avg(f.avg_resolution_minutes)}
                </td>
                {showOverdue ? (
                  <td
                    data-label="Overdue now"
                    className={cn(
                      "font-tabular px-4 py-2 text-right",
                      (row.overdue ?? 0) > 0 && "text-warning",
                    )}
                  >
                    {row.overdue ?? 0}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
