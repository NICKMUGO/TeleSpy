import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "default" | "warning" | "destructive" | "success";
  hint?: string;
}

const TONE_CLASSES: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
  success: "text-success",
};

/** Clarity over decoration, one number the eye lands on first (Apple HIG's
 * "defer to content" read into a KES-figure dashboard tile) — no card
 * chrome competing with the number itself. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  hint,
}: StatCardProps) {
  return (
    <div className="border-border bg-card flex flex-col gap-2 rounded-lg border p-5">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Icon aria-hidden="true" className="size-4" />
        <span>{label}</span>
      </div>
      <p
        className={cn(
          "font-mono text-2xl font-semibold tabular-nums",
          TONE_CLASSES[tone],
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}
