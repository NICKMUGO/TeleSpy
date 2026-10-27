"use client";

import { CircleCheckBig, Inbox, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/data/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { TicketList } from "@/features/tickets/ticket-list";
import { useTicketAccess, useTickets } from "@/lib/api/hooks";

/** A department's queue: tickets the desk sent it, waiting for someone to
 * take them, being worked, and recently resolved. */
export default function TeamTicketsPage() {
  const access = useTicketAccess();
  const me = access.data?.data;
  const hasTeam = !!me?.department_id;
  const waiting = useTickets("team", "open", hasTeam);
  const working = useTickets("team", "in_progress", hasTeam);
  const resolved = useTickets("team", "resolved", hasTeam);

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
        <PageHeader title="Team tickets" />
        <p className="text-muted-foreground p-4 text-sm sm:p-6">
          You aren&apos;t in a department, so no tickets come to you.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader title={`Team tickets · ${me.department_name}`} />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <SectionCard
          title={`Waiting for someone${waiting.data ? ` (${waiting.data.data.length})` : ""}`}
          description="Oldest first is fairest — open one to take it."
          bodyClassName="px-0 pb-0"
          tourId="team-waiting"
        >
          <TicketList
            tickets={waiting.data?.data.slice().reverse()}
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
            tickets={working.data?.data}
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
    </>
  );
}
