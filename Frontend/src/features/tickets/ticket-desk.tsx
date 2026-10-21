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
import type { TicketAccess, TicketStatus } from "@/lib/api/types";
import { useSession } from "@/lib/auth/session-store";
import { monthKey, monthLabel } from "@/lib/format";

/** The customer service desk's home: raise a ticket, see what came back,
 * follow everything raised, and the escalation score for the month. */
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
  if (!me.on_desk && !me.is_admin) {
    return (
      <>
        <PageHeader title="Ticket desk" />
        <p className="text-muted-foreground p-4 text-sm sm:p-6">
          The ticket desk is for the customer service team.
          {me.handles_tickets
            ? " Tickets sent to your department are under Team tickets."
            : ""}
        </p>
      </>
    );
  }
  return <Desk me={me} />;
}

function Desk({ me }: { me: TicketAccess }) {
  const firstName = useSession((s) => s.user?.full_name?.split(" ")[0]);
  const userId = useSession((s) => s.user?.id);
  const [creating, setCreating] = useState(false);
  const overseer = me.desk_manager || me.is_admin;
  // An Admin outside the desk has no tickets of their own to list.
  const [scope, setScope] = useState<TicketScope>(
    me.on_desk && !me.desk_manager ? "mine" : "desk",
  );
  const [status, setStatus] = useState<TicketStatus | "">("");
  const month = monthKey(new Date());

  const stats = useTicketStats(month);
  const returned = useTickets("mine", "returned", me.on_desk);
  const tickets = useTickets(scope, status || undefined);
  const mine = stats.data?.data.agents.find((a) => a.user_id === userId);
  const deskTotals = stats.data?.data.agents.reduce(
    (sum, a) => ({
      raised: sum.raised + a.raised,
      resolved: sum.resolved + a.resolved,
      returned: sum.returned + a.returned,
      open: sum.open + a.open,
    }),
    { raised: 0, resolved: 0, returned: 0, open: 0 },
  );
  const figures = overseer ? deskTotals : mine;
  const returnedTickets = returned.data?.data ?? [];

  return (
    <>
      <PageHeader
        title={
          me.on_desk
            ? `Customer service desk${firstName ? ` · ${firstName}` : ""}`
            : "Customer service desk"
        }
        description={
          overseer
            ? `Every ticket the desk has raised, and how each agent's escalations are going in ${monthLabel(month)}.`
            : "Raise a ticket when another department needs to handle a customer's issue, and follow it until it's resolved."
        }
        actions={
          me.on_desk || me.is_admin ? (
            <Button
              type="button"
              size="lg"
              onClick={() => setCreating(true)}
              data-tour="desk-new-ticket"
            >
              <Plus aria-hidden="true" />
              New ticket
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div
          data-tour="desk-score"
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          {stats.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))
          ) : (
            <>
              <StatCard
                label="Successful escalations"
                value={String(figures?.resolved ?? 0)}
                tone="success"
                hint={`Resolved in ${monthLabel(month)}`}
              />
              <StatCard
                label="Raised"
                value={String(figures?.raised ?? 0)}
                hint={monthLabel(month)}
              />
              <StatCard
                label="Returned"
                value={String(figures?.returned ?? 0)}
                tone={(figures?.returned ?? 0) > 0 ? "warning" : "default"}
                hint="Sent back to the desk"
              />
              <StatCard
                label="Still open"
                value={String(figures?.open ?? 0)}
                hint="Waiting or in progress"
              />
            </>
          )}
        </div>

        {returnedTickets.length > 0 ? (
          <SectionCard
            title={`Returned to you (${returnedTickets.length})`}
            description="The team sent these back — open one to see why, fix it and send it again."
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

        {overseer && (stats.data?.data.agents.length ?? 0) > 0 ? (
          <SectionCard
            title="Agents"
            description={`${monthLabel(month)} — successful escalations first`}
            bodyClassName="px-0 pb-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-border-subtle border-y text-xs">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Agent
                    </th>
                    {["Resolved", "Raised", "Returned", "Open"].map((h) => (
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
                  {stats.data?.data.agents.map((a) => (
                    <tr key={a.user_id}>
                      <td className="px-4 py-2">{a.name}</td>
                      <td className="text-success font-tabular px-4 py-2 text-right font-medium">
                        {a.resolved}
                      </td>
                      <td className="font-tabular px-4 py-2 text-right">
                        {a.raised}
                      </td>
                      <td className="font-tabular px-4 py-2 text-right">
                        {a.returned}
                      </td>
                      <td className="font-tabular px-4 py-2 text-right">
                        {a.open}
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
                : "When a customer's issue needs another department, raise a ticket with New ticket."
            }
          />
        </SectionCard>
      </div>

      <NewTicketDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
