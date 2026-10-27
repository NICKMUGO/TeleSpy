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
  const month = monthKey(new Date());

  const stats = useTicketStats(month, desk);
  const returned = useTickets("mine", "returned");
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
          !desk
            ? "My tickets"
            : me.on_desk
              ? `Customer service desk${firstName ? ` · ${firstName}` : ""}`
              : "Customer service desk"
        }
        actions={
          <Button
            type="button"
            size="lg"
            onClick={() => setCreating(true)}
            data-tour="desk-new-ticket"
          >
            <Plus aria-hidden="true" />
            New ticket
          </Button>
        }
      />

      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div
          data-tour="desk-score"
          className={desk ? "grid grid-cols-2 gap-4 lg:grid-cols-4" : "hidden"}
        >
          {!desk ? null : stats.isLoading ? (
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

        {overseer && (stats.data?.data.agents.length ?? 0) > 0 ? (
          <SectionCard
            title="Agents"
            description={`${monthLabel(month)} — successful escalations first`}
            bodyClassName="px-0 pb-0"
          >
            <div className="overflow-x-auto">
              <table data-stack className="w-full text-sm">
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
