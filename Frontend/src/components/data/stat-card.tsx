import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string;
  tone?: "default" | "warning" | "destructive" | "success";
  /** Secondary line under the number — context, not decoration. */
  hint?: string;
  /** Period-over-period change. `direction` is the arrow; `sentiment`
   * decides the colour, because for spend "up" is bad and for recovered
   * cost "up" is good. */
  delta?: {
    label: string;
    direction: "up" | "down";
    sentiment?: "good" | "bad" | "neutral";
  };
}

const TONE_CLASSES: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
  success: "text-success",
};

const SENTIMENT_CLASSES = {
  good: "text-success",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
};

/** Clarity over decoration, one number the eye lands on first (Apple HIG's
 * "defer to content" read into a KES-figure dashboard tile) — no card
 * chrome competing with the number itself. */
export function StatCard({
  label,
  value,
  tone = "default",
  hint,
  delta,
}: StatCardProps) {
  const DeltaIcon = delta?.direction === "down" ? ArrowDownRight : ArrowUpRight;

  return (
    <div className="bg-card shadow-panel flex flex-col gap-1.5 rounded-xl px-5 py-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <p
        className={cn(
          "font-tabular text-xl leading-tight font-semibold break-words sm:text-2xl",
          TONE_CLASSES[tone],
        )}
      >
        {value}
      </p>
      {delta ? (
        <p
          className={cn(
            "flex items-center gap-1 text-xs",
            SENTIMENT_CLASSES[delta.sentiment ?? "neutral"],
          )}
        >
          <DeltaIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="font-tabular">{delta.label}</span>
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
