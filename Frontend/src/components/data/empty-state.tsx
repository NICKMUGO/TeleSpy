import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconBadge } from "@/components/data/icon-badge";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

/** The real "no data yet" primitive Phase 3's StubNotice deferred to —
 * used once screens are wired to live data instead of scaffolding. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="animate-rise m-4 flex flex-1 flex-col items-center justify-center gap-4 px-6 py-14 text-center sm:m-6">
      <IconBadge icon={Icon} />
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold">{title}</p>
        {description ? (
          <p className="text-muted-foreground max-w-sm text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
