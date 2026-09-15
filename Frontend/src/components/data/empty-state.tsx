import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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
    <div className="border-border m-6 flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center">
      <Icon aria-hidden="true" className="text-muted-foreground size-8" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
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
