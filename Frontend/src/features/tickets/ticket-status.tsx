import { Badge } from "@/components/ui/badge";
import type { TicketStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Waiting",
  in_progress: "In progress",
  returned: "Returned",
  resolved: "Resolved",
};

const STATUS_CLASSES: Record<TicketStatus, string> = {
  open: "",
  in_progress: "border-primary/40 text-primary",
  returned: "border-warning/50 text-warning",
  resolved: "border-success/50 text-success",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge variant="outline" className={cn("shrink-0", STATUS_CLASSES[status])}>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}
