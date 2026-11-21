import {
  severityOf,
  SEVERITY_LABEL,
  type Severity,
} from "@/lib/anomaly-severity";
import { cn } from "@/lib/utils";

const SWATCH: Record<Severity, string> = {
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-severity-low",
};

const TEXT: Record<Severity, string> = {
  high: "text-severity-high",
  medium: "text-severity-medium",
  low: "text-muted-foreground",
};

/**
 * Severity as a square swatch + a word. Never the swatch alone — severity
 * is the one thing in this table a colourblind reader must not have to
 * infer from hue.
 */
export function SeverityBadge({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  const severity = severityOf(score);
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-[2px]", SWATCH[severity])}
      />
      <span
        className={cn(
          "text-[0.6875rem] font-semibold tracking-wide uppercase",
          TEXT[severity],
        )}
      >
        {SEVERITY_LABEL[severity]}
      </span>
    </span>
  );
}
