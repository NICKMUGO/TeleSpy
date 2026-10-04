import { cn } from "@/lib/utils";

export interface BarListItem {
  label: string;
  value: number;
  /** Right-hand display string. Falls back to the raw value. */
  display?: string;
  /** Paint this row in the primary/alert colour rather than the neutral. */
  alert?: boolean;
}

/**
 * Ranked horizontal bars — the default form for "magnitude by category"
 * (spend by department, contributing features). Preferred over a pie for
 * this job: the labels sit on one reading axis and the lengths share a
 * common baseline, so ranking is read directly rather than by arc.
 *
 * Every row is directly labelled with its value, so the bar is a visual
 * aid rather than the only carrier of the number.
 */
export function BarList({
  items,
  className,
}: {
  items: BarListItem[];
  className?: string;
}) {
  const max = Math.max(...items.map((item) => item.value), 0) || 1;

  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate">{item.label}</span>
            <span className="font-tabular text-muted-foreground shrink-0">
              {item.display ?? item.value.toLocaleString("en-KE")}
            </span>
          </div>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full",
                item.alert ? "bg-primary" : "bg-chart-5/55",
              )}
              style={{ width: `${Math.max((item.value / max) * 100, 1.5)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
