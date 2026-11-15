import { Badge } from "@/components/ui/badge";
import type {
  SlaStatus,
  Ticket,
  TicketPriority,
  TicketStatus,
} from "@/lib/api/types";
import { duration } from "@/lib/format";
import { cn } from "@/lib/utils";

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Waiting",
  in_progress: "In progress",
  returned: "Rejected",
  resolved: "Resolved",
  withdrawn: "Withdrawn",
  closed: "Closed",
};

const STATUS_CLASSES: Record<TicketStatus, string> = {
  open: "",
  in_progress: "border-primary/40 text-primary",
  returned: "border-warning/50 text-warning",
  resolved: "border-success/50 text-success",
  withdrawn: "text-muted-foreground",
  closed: "text-muted-foreground",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge variant="outline" className={cn("shrink-0", STATUS_CLASSES[status])}>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Out with someone else right now, waiting to come back. */
export function ForwardedBadge({ ticket }: { ticket: Ticket }) {
  const out = ticket.forwards.filter((f) => f.status === "pending");
  if (out.length === 0) return null;
  const to = out
    .map((f) => f.to_user_name ?? f.to_department_name ?? "another team")
    .join(", ");
  return (
    <Badge
      variant="outline"
      className="border-info/50 text-info shrink-0"
      title={`Forwarded to ${to}`}
    >
      Forwarded
    </Badge>
  );
}

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const PRIORITY_CLASSES: Record<TicketPriority, string> = {
  high: "border-destructive/50 text-destructive",
  medium: "border-warning/50 text-warning",
  low: "text-muted-foreground",
};

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <Badge
      variant="outline"
      className={cn("shrink-0", PRIORITY_CLASSES[priority])}
    >
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}

export const SLA_STATUS_LABELS: Record<SlaStatus, string> = {
  on_track: "On track",
  overdue: "Overdue",
  paused: "Paused",
  met: "Met SLA",
  missed: "Missed SLA",
  none: "No SLA result",
};

/** One line on where a ticket stands against its deadline: time left,
 * how late it is, or — once resolved — whether it made it. */
export function slaSummary(ticket: Ticket, now: number = Date.now()) {
  const left = (new Date(ticket.due_at).getTime() - now) / 60_000;
  switch (ticket.sla_status) {
    case "on_track":
      return `${duration(left)} left`;
    case "overdue":
      return `${duration(left)} overdue`;
    case "paused":
      return ticket.status === "returned"
        ? "SLA paused while rejected"
        : "SLA paused while forwarded";
    case "none":
      return ticket.status === "withdrawn" ? "Withdrawn" : "Closed";
    case "met":
    case "missed": {
      const late =
        ticket.resolved_at === null
          ? 0
          : (new Date(ticket.resolved_at).getTime() -
              new Date(ticket.due_at).getTime()) /
            60_000;
      return ticket.sla_status === "met"
        ? "Within SLA"
        : `${duration(late)} past SLA`;
    }
  }
}

const SLA_CLASSES: Record<SlaStatus, string> = {
  on_track: "text-muted-foreground",
  overdue: "border-destructive/50 text-destructive",
  paused: "text-muted-foreground",
  met: "border-success/50 text-success",
  missed: "border-destructive/50 text-destructive",
  none: "text-muted-foreground",
};

export function SlaBadge({ ticket }: { ticket: Ticket }) {
  return (
    <Badge
      variant="outline"
      className={cn("shrink-0", SLA_CLASSES[ticket.sla_status])}
      title={SLA_STATUS_LABELS[ticket.sla_status]}
    >
      {slaSummary(ticket)}
    </Badge>
  );
}
