import {
  HIGH_SEVERITY_THRESHOLD,
  severityOf,
  SEVERITY_LABEL,
} from "@/lib/anomaly-severity";
import { cn } from "@/lib/utils";

const STROKE = {
  high: "stroke-severity-high",
  medium: "stroke-severity-medium",
  low: "stroke-severity-low",
};

const TEXT = {
  high: "text-severity-high",
  medium: "text-severity-medium",
  low: "text-muted-foreground",
};

/**
 * The Isolation Forest score as a single hero number inside a progress
 * ring. The ring is scaled over [0.5, 1.0], not [0, 1]: the scorer only
 * writes a row once the model has already called the event an outlier, so
 * no stored score is below ~0.5 and a full-range ring would start every
 * anomaly at half full and compress the part that actually varies.
 */
export function ScoreGauge({ score }: { score: number }) {
  const severity = severityOf(score);
  const fraction = Math.min(Math.max((score - 0.5) / 0.5, 0), 1);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative size-28">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth="8"
            className="stroke-muted"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            className={STROKE[severity]}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="font-tabular text-2xl font-semibold">
            {score.toFixed(2)}
          </span>
        </span>
      </div>
      <p className="text-center text-xs">
        <span className="text-muted-foreground">Isolation Forest score</span>
        <br />
        <span className={cn("font-medium", TEXT[severity])}>
          {SEVERITY_LABEL[severity]} severity
        </span>
        <span className="text-muted-foreground">
          {" "}
          · threshold {HIGH_SEVERITY_THRESHOLD}
        </span>
      </p>
    </div>
  );
}
