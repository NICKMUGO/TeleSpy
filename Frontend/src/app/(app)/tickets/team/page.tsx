"use client";

import { useState } from "react";
import { CircleCheckBig, Inbox, Plus, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/data/section-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NewTicketDialog } from "@/features/tickets/new-ticket-dialog";
import { TicketList } from "@/features/tickets/ticket-list";
import { useTicketAccess, useTickets } from "@/lib/api/hooks";
import type { Ticket } from "@/lib/api/types";

const byDeadline = (tickets: Ticket[] | undefined) =>
  tickets?.slice().sort((a, b) => a.due_at.localeCompare(b.due_at));

/** A department's queue: tickets the desk sent it, waiting for someone to
 * take them, being worked, and recently resolved. Open work is listed by
 * SLA deadline, so whatever is due soonest is on top. */
export default function TeamTicketsPage() {
  const access = useTicketAccess();
  const me = access.data?.data;
  const hasTeam = !!me?.department_id;
  const waiting = useTickets("team", "open", hasTeam);
  const working = useTickets("team", "in_progress", hasTeam);
  const resolved = useTickets("team", "resolved", hasTeam);
  const [creating, setCreating] = useState(false);

  // Anyone can raise a ticket, so the queue offers it too: for a phone,
  // this is where the Tickets tab lands.
  const newTicket = (
    <Button type="button" size="lg" onClick={() => setCreating(true)}>
      <Plus aria-hidden="true" />
      New ticket
    </Button>
  );
  const dialog = <NewTicketDialog open={creating} onOpenChange={setCreating} />;

  if (access.isLoading || !me) {
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!hasTeam) {
    return (
      <>
        <PageHeader title="Team tickets" actions={newTicket} />
        <p className="text-muted-foreground p-4 text-sm sm:p-6">
          You aren&apos;t in a department, so no tickets come to you.
        </p>
        {dialog}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Team tickets · ${me.department_name}`}
        actions={newTicket}
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <SectionCard
          title={`Waiting for someone${waiting.data ? ` (${waiting.data.data.length})` : ""}`}
          description="Due soonest first — open one to take it."
          bodyClassName="px-0 pb-0"
          tourId="team-waiting"
        >
          <TicketList
            tickets={byDeadline(waiting.data?.data)}
            isLoading={waiting.isLoading}
            error={waiting.error}
            onRetry={() => waiting.refetch()}
            perspective="team"
            emptyIcon={Inbox}
            emptyTitle="Nothing waiting"
            emptyDescription="New tickets for your department land here."
          />
        </SectionCard>
        <SectionCard title="In progress" bodyClassName="px-0 pb-0">
          <TicketList
            tickets={byDeadline(working.data?.data)}
            isLoading={working.isLoading}
            error={working.error}
            onRetry={() => working.refetch()}
            perspective="team"
            emptyIcon={UserCheck}
            emptyTitle="Nobody is working a ticket"
          />
        </SectionCard>
        <SectionCard title="Resolved" bodyClassName="px-0 pb-0">
          <TicketList
            tickets={resolved.data?.data}
            isLoading={resolved.isLoading}
            error={resolved.error}
            onRetry={() => resolved.refetch()}
            perspective="team"
            emptyIcon={CircleCheckBig}
            emptyTitle="No resolved tickets yet"
          />
        </SectionCard>
      </div>
      {dialog}
    </>
  );
}
