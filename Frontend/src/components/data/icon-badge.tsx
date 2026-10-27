import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The one round icon used on every empty, error and not-found screen, so
 * they all look alike. */
export function IconBadge({
  icon: Icon,
  tone = "muted",
}: {
  icon: LucideIcon;
  tone?: "muted" | "destructive";
}) {
  return (
    <span
      className={cn(
        "flex size-14 items-center justify-center rounded-full",
        tone === "destructive"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-7" />
    </span>
  );
}
