import Link from "next/link";
import { Inbox, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/data/empty-state";
import { ErrorBanner } from "@/components/data/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { TicketStatusBadge } from "@/features/tickets/ticket-status";
import type { Ticket } from "@/lib/api/types";
import { timeAgo } from "@/lib/format";

/** Tickets as a scannable list: number, subject and customer on the left;
 * where it is and who has it on the right. Each row opens the ticket. */
export function TicketList({
  tickets,
  isLoading,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  emptyIcon = Inbox,
  /** Desk view names the handling department; team view names who raised it. */
  perspective,
}: {
  tickets: Ticket[] | undefined;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  perspective: "desk" | "team";
}) {
  if (error) return <ErrorBanner error={error} onRetry={onRetry} />;
  if (isLoading || !tickets) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (tickets.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <ul className="divide-border-subtle divide-y">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <Link
            href={`/tickets/${ticket.id}`}
            className="hover:bg-muted/50 focus-visible:ring-ring flex flex-col gap-1 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset sm:flex-row sm:items-center sm:gap-4"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-tabular text-xs">
                  {ticket.number}
                </span>
                <span className="truncate text-sm font-medium">
                  {ticket.subject}
                </span>
              </div>
              <span className="text-muted-foreground truncate text-xs">
                {ticket.customer_name}
                {ticket.booking_reference
                  ? ` · ${ticket.booking_reference}`
                  : ""}
                {" · "}
                {ticket.category_name}
              </span>
            </div>
            <div className="text-muted-foreground flex items-center gap-3 text-xs sm:justify-end">
              <span className="truncate">
                {perspective === "desk"
                  ? ticket.department_name
                  : ticket.claimed_by_name
                    ? `With ${ticket.claimed_by_name}`
                    : `From ${ticket.raised_by_name ?? "the desk"}`}
              </span>
              <span className="shrink-0">{timeAgo(ticket.updated_at)}</span>
              <TicketStatusBadge status={ticket.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
