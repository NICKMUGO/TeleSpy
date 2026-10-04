import { cn } from "@/lib/utils";

export interface BudgetMeterItem {
  label: string;
  spend: number;
  ceiling: number;
}

function kesCompact(value: number) {
  if (value >= 1_000_000) return `KES ${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `KES ${(value / 1_000).toFixed(0)}k`;
  return `KES ${Math.round(value)}`;
}

/**
 * Spend against a ceiling. The bar is clipped at 100% of the track so the
 * row never grows, and the overspend is carried by the percentage chip
 * instead — a bar that renders past its own container reads as a layout
 * bug rather than as "over budget".
 */
export function BudgetMeter({
  items,
  className,
}: {
  items: BudgetMeterItem[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {items.map((item) => {
        const pct = item.ceiling > 0 ? (item.spend / item.ceiling) * 100 : 0;
        const over = pct > 100;
        return (
          <li key={item.label} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-xs font-medium">{item.label}</span>
              <span
                className={cn(
                  "font-tabular shrink-0 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold",
                  over
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {Math.round(pct)}%
              </span>
            </div>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full">
              <div
                className={cn(
                  "h-full rounded-full",
                  over ? "bg-destructive" : "bg-chart-5/55",
                )}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <p className="font-tabular text-muted-foreground text-[0.6875rem]">
              {kesCompact(item.spend)} of {kesCompact(item.ceiling)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
