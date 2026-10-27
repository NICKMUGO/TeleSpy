import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The dashboard/analytics panel: a titled surface with an optional action
 * on the title row. One component so every panel on every screen shares
 * the same header height, rule and padding.
 */
export function SectionCard({
  title,
  description,
  action,
  actionHref,
  children,
  className,
  bodyClassName,
  tourId,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  actionHref?: { label: string; href: string };
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Spotlight anchor for the guided tour (TutorialContent.cs Target). */
  tourId?: string;
}) {
  return (
    <section
      data-tour={tourId}
      className={cn(
        "bg-card shadow-panel flex flex-col overflow-hidden rounded-xl",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-xs">
              {description}
            </p>
          ) : null}
        </div>
        {actionHref ? (
          <Link
            href={actionHref.href}
            className="text-primary focus-visible:ring-ring shrink-0 rounded-sm text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {actionHref.label}
          </Link>
        ) : (
          action
        )}
      </div>
      <div className={cn("flex-1 px-5 pb-5", bodyClassName)}>{children}</div>
    </section>
  );
}
