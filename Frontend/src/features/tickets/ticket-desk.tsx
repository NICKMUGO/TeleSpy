"use client";

import { useState } from "react";
import { CircleCheckBig, Headset, Plus, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/data/section-card";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { SelectNative } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";
import { NewTicketDialog } from "@/features/tickets/new-ticket-dialog";
import { TicketList } from "@/features/tickets/ticket-list";
import { TICKET_STATUS_LABELS } from "@/features/tickets/ticket-status";
import { useTicketAccess, useTickets, useTicketStats } from "@/lib/api/hooks";
import type { TicketScope } from "@/lib/api/resources";
import type {
  TicketAccess,
  TicketAgentStats,
  TicketStatus,
} from "@/lib/api/types";
import { useSession } from "@/lib/auth/session-store";
import { duration, monthKey, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** This month and the five before it, newest first. */
function recentMonths() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) =>
    monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)),
  );
}

const rating = (value: number | null | undefined) =>
  value == null ? "—" : `${value.toFixed(1)} / 5`;

/** 1 → "1st", 2 → "2nd", 13 → "13th". */
function ordinal(n: number) {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ??
        "th");
  return `${n}${suffix}`;
}

/** Average of the agents' ratings, weighted by how many each got. */
function weightedRating(agents: TicketAgentStats[]) {
  const responses = agents.reduce((n, a) => n + a.csat_responses, 0);
  if (responses === 0) return { avg: null, responses };
  const total = agents.reduce(
    (n, a) => n + (a.csat_avg ?? 0) * a.csat_responses,
    0,
  );
  return { avg: Math.round((100 * total) / responses) / 100, responses };
}

/** The customer service desk's home: raise a ticket, see what came back,
 * follow everything raised, and the escalation score for the month. Anyone
 * else gets the same page as "My tickets", without the desk's scores. */
export function TicketDesk() {
  const access = useTicketAccess();
  const me = access.data?.data;

  if (access.isLoading || !me) {
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return <Desk me={me} />;
}

function Desk({ me }: { me: TicketAccess }) {
  const firstName = useSession((s) => s.user?.full_name?.split(" ")[0]);
  const userId = useSession((s) => s.user?.id);
  const [creating, setCreating] = useState(false);
  const overseer = me.desk_manager || me.is_admin;
  // The desk (and Admin) get the escalation scores; anyone else just
  // follows the tickets they raised.
  const desk = me.on_desk || me.is_admin;
  // The desk Manager and Admin start on the whole desk; everyone else on
  // the tickets they raised.
  const [scope, setScope] = useState<TicketScope>(overseer ? "desk" : "mine");
  const [status, setStatus] = useState<TicketStatus | "">("");
  const months = recentMonths();
  const [month, setMonth] = useState(months[0]);

  const stats = useTicketStats(month, desk);
  const returned = useTickets("mine", "returned");
  const tickets = useTickets(scope, status || undefined);
  const agents = stats.data?.data.agents ?? [];
  const team = stats.data?.data.team;
  const ranks = stats.data?.data.me?.ranks;
  const mine = agents.find((a) => a.user_id === userId);
  // The desk Manager sees the whole desk's totals; an agent their own
  // figures, against the team average and their place on the desk.
  const totals = agents.reduce(
    (sum, a) => ({
      raised: sum.raised + a.raised,
      resolved: sum.resolved + a.resolved,
      successful: sum.successful + a.successful,
      returned: sum.returned + a.returned,
    }),
    { raised: 0, resolved: 0, successful: 0, returned: 0 },
  );
  const figures = overseer
    ? {
        ...totals,
        success_pct: totals.resolved
          ? Math.round((1000 * totals.successful) / totals.resolved) / 10
          : null,
      }
    : mine;
  const ratingFigures = overseer
    ? weightedRating(agents)
    : { avg: mine?.csat_avg ?? null, responses: mine?.csat_responses ?? 0 };
  /** "3rd of 12" under an agent's own figure — their place on the desk. */
  const placing = (rank: number | null | undefined) =>
    overseer || !team || rank == null || team.agents <= 1
      ? undefined
      : `${ordinal(rank)} of ${team.agents}`;
  const returnedTickets = returned.data?.data ?? [];

  return (
    <>
      <PageHeader
        title={
          !desk
            ? "My tickets"
            : me.on_desk
              ? `Customer service desk${firstName ? ` · ${firstName}` : ""}`
              : "Customer service desk"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {desk ? (
              <SelectNative
                aria-label="Month for the scores"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </SelectNative>
            ) : null}
            <Button
              type="button"
              size="lg"
              onClick={() => setCreating(true)}
              data-tour="desk-new-ticket"
            >
              <Plus aria-hidden="true" />
              New ticket
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div
          data-tour="desk-score"
          className={
            desk
              ? "grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5"
              : "hidden"
          }
        >
          {!desk ? null : stats.isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))
          ) : (
            <>
              <StatCard
                label="Successful escalations"
                value={String(figures?.successful ?? 0)}
                tone="success"
                hint={placing(ranks?.successful) ?? "Resolved, never rejected"}
              />
              <StatCard
                label="Success rate"
                value={
                  figures?.success_pct == null ? "—" : `${figures.success_pct}%`
                }
                hint={
                  placing(ranks?.success_pct) ??
                  "Of tickets resolved this month"
                }
              />
              <StatCard
                label="Raised"
                value={String(figures?.raised ?? 0)}
                hint={monthLabel(month)}
              />
              <StatCard
                label="Rejected"
                value={String(figures?.returned ?? 0)}
                tone={(figures?.returned ?? 0) > 0 ? "warning" : "default"}
                hint="Wrong department, duplicate or invalid"
              />
              <StatCard
                label="Customer rating"
                value={rating(ratingFigures.avg)}
                tone={
                  ratingFigures.avg == null
                    ? "default"
                    : ratingFigures.avg >= 4
                      ? "success"
                      : ratingFigures.avg >= 3
                        ? "warning"
                        : "destructive"
                }
                // Only the viewer's own ratings (the desk's, for the
                // Manager) — no team average beside it.
                hint={
                  ratingFigures.responses
                    ? `${ratingFigures.responses} rating${ratingFigures.responses === 1 ? "" : "s"} in ${monthLabel(month)}`
                    : "No customer ratings yet"
                }
              />
            </>
          )}
        </div>

        {returnedTickets.length > 0 ? (
          <SectionCard
            title={`Rejected — fix and resend (${returnedTickets.length})`}
            description="The team sent these back. Open one to see why, fix it and send it again."
            bodyClassName="px-0 pb-0"
            className="border-warning/50"
          >
            <TicketList
              tickets={returnedTickets}
              isLoading={false}
              emptyTitle=""
              perspective="desk"
            />
          </SectionCard>
        ) : null}

        {overseer && agents.length > 0 ? (
          <SectionCard
            title="Agent scorecard"
            description={`Customer service desk · ${monthLabel(month)}. Successful = resolved without being rejected. SLA and time are for tickets they raised that were resolved this month — shown for context, mostly down to the handling team.`}
            bodyClassName="px-0 pb-0"
          >
            <div className="overflow-x-auto">
              <table data-stack className="w-full text-sm">
                <thead className="text-muted-foreground border-border-subtle border-y text-xs">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Agent
                    </th>
                    {[
                      "Raised",
                      "Successful",
                      "Success rate",
                      "Rejected",
                      "Open",
                      "Met SLA",
                      "Avg time",
                      "Customer rating",
                    ].map((h) => (
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
                  {agents.map((a) => (
                    <tr key={a.user_id}>
                      <td data-label="Agent" className="px-4 py-2">
                        {a.name}
                      </td>
                      <td
                        data-label="Raised"
                        className="font-tabular px-4 py-2 text-right"
                      >
                        {a.raised}
                      </td>
                      <td
                        data-label="Successful"
                        className="text-success font-tabular px-4 py-2 text-right font-medium"
                      >
                        {a.successful}
                      </td>
                      <td
                        data-label="Success rate"
                        className="font-tabular px-4 py-2 text-right"
                      >
                        {a.success_pct == null ? "—" : `${a.success_pct}%`}
                      </td>
                      <td
                        data-label="Rejected"
                        className={cn(
                          "font-tabular px-4 py-2 text-right",
                          a.returned > 0 && "text-warning",
                        )}
                      >
                        {a.returned}
                      </td>
                      <td
                        data-label="Open"
                        className="font-tabular px-4 py-2 text-right"
                      >
                        {a.open}
                      </td>
                      <td
                        data-label="Met SLA"
                        className={cn(
                          "font-tabular px-4 py-2 text-right",
                          a.sla_met_pct != null &&
                            (a.sla_met_pct >= 90
                              ? "text-success"
                              : a.sla_met_pct >= 75
                                ? "text-warning"
                                : "text-destructive"),
                        )}
                      >
                        {a.sla_met_pct == null ? "—" : `${a.sla_met_pct}%`}
                      </td>
                      <td
                        data-label="Avg time"
                        className="font-tabular px-4 py-2 text-right whitespace-nowrap"
                      >
                        {a.avg_resolution_minutes == null
                          ? "—"
                          : duration(a.avg_resolution_minutes)}
                      </td>
                      <td
                        data-label="Customer rating"
                        className="font-tabular px-4 py-2 text-right whitespace-nowrap"
                      >
                        {rating(a.csat_avg)}
                        {a.csat_responses ? (
                          <span className="text-muted-foreground text-xs">
                            {" "}
                            ({a.csat_responses})
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        ) : null}

        <SectionCard
          title={scope === "mine" ? "Tickets you raised" : "Desk tickets"}
          bodyClassName="px-0 pb-0"
          action={
            <div className="flex flex-wrap items-center gap-2">
              {overseer && me.on_desk ? (
                <SelectNative
                  aria-label="Whose tickets"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as TicketScope)}
                  className="h-8"
                >
                  <option value="desk">Whole desk</option>
                  <option value="mine">Raised by me</option>
                </SelectNative>
              ) : null}
              <SelectNative
                aria-label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value as TicketStatus | "")}
                className="h-8"
              >
                <option value="">Any status</option>
                {Object.entries(TICKET_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectNative>
            </div>
          }
        >
          <TicketList
            tickets={tickets.data?.data}
            isLoading={tickets.isLoading}
            error={tickets.error}
            onRetry={() => tickets.refetch()}
            perspective="desk"
            emptyIcon={
              status === "resolved"
                ? CircleCheckBig
                : status === "returned"
                  ? Undo2
                  : Headset
            }
            emptyTitle={
              status
                ? `No ${TICKET_STATUS_LABELS[status].toLowerCase()} tickets`
                : "No tickets yet"
            }
            emptyDescription={
              status
                ? undefined
                : desk
                  ? "When a customer's issue needs another department, raise a ticket with New ticket."
                  : "When you need another department to handle something, raise a ticket with New ticket."
            }
          />
        </SectionCard>
      </div>

      <NewTicketDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
