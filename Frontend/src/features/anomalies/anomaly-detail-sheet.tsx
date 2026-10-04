"use client";

import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScoreGauge } from "@/features/anomalies/score-gauge";
import type { AnomalyFlag } from "@/lib/api/types";

/** Keys inside contributing_features that are rendered by the dedicated
 * rows below, so the raw dump doesn't repeat them. */
const HANDLED_KEYS = new Set([
  "reason",
  "duration_minutes",
  "computed_cost",
  "call_classification",
  "model_score",
]);

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Detail view for one anomaly flag.
 *
 * The "contributing features" shown are exactly the ones
 * ML/training/anomaly_detection.py writes into
 * anomaly_flags.contributing_features — duration, cost, classification and
 * the raw decision_function score. The model does not emit per-feature
 * importances, so there is nothing here to render as weighted bars.
 */
export function AnomalyDetailSheet({
  flag,
  onOpenChange,
  onResolve,
  resolving,
  canResolve,
}: {
  flag: AnomalyFlag | null;
  onOpenChange: (open: boolean) => void;
  onResolve: (flagId: string) => void;
  resolving: boolean;
  canResolve: boolean;
}) {
  if (!flag) return null;

  const features = flag.contributing_features ?? {};
  const name = flag.employee?.full_name ?? "Unattributed";
  const extra = Object.entries(features).filter(
    ([key]) => !HANDLED_KEYS.has(key),
  );

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-md"
      >
        <SheetHeader>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            >
              {initials(name)}
            </span>
            <div className="min-w-0">
              <SheetTitle className="truncate text-base">{name}</SheetTitle>
              <SheetDescription className="font-tabular truncate">
                {flag.event?.msisdn_pbx ? `ext ${flag.event.msisdn_pbx}` : "—"}
                {flag.event?.destination ? ` → ${flag.event.destination}` : ""}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-4">
          <ScoreGauge score={flag.anomaly_score} />

          <section>
            <h3 className="text-muted-foreground text-[0.6875rem] font-medium tracking-[0.12em] uppercase">
              Triggering event
            </h3>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <DetailRow
                label="Occurred"
                value={
                  flag.event?.occured_at
                    ? new Date(flag.event.occured_at).toLocaleString("en-KE")
                    : "—"
                }
              />
              <DetailRow
                label="Duration"
                value={
                  flag.event
                    ? `${flag.event.duration_minutes.toFixed(2)} min`
                    : "—"
                }
              />
              <DetailRow
                label="Classification"
                value={flag.event?.call_classification ?? "—"}
              />
              <DetailRow
                label="Attribution"
                value={flag.event?.attribution_state ?? "—"}
              />
            </dl>
          </section>

          <section>
            <h3 className="text-muted-foreground text-[0.6875rem] font-medium tracking-[0.12em] uppercase">
              Model output
            </h3>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <DetailRow
                label="Detector"
                value={String(features.reason ?? "isolation_forest")}
              />
              <DetailRow
                label="decision_function"
                value={
                  features.model_score === undefined
                    ? "—"
                    : String(features.model_score)
                }
              />
              <DetailRow
                label="Stored score"
                value={flag.anomaly_score.toFixed(4)}
              />
              {extra.map(([key, value]) => (
                <DetailRow key={key} label={key} value={String(value)} />
              ))}
            </dl>
          </section>

          <section>
            <h3 className="text-muted-foreground text-[0.6875rem] font-medium tracking-[0.12em] uppercase">
              Status
            </h3>
            <div className="mt-3">
              {flag.resolved ? (
                <Badge variant="secondary">
                  Resolved
                  {flag.resolved_at
                    ? ` · ${new Date(flag.resolved_at).toLocaleDateString("en-KE")}`
                    : ""}
                </Badge>
              ) : (
                <Badge variant="destructive">Open</Badge>
              )}
            </div>
          </section>

          {canResolve && !flag.resolved ? (
            <Button
              type="button"
              className="w-full"
              disabled={resolving}
              onClick={() => onResolve(flag.id)}
            >
              <Check aria-hidden="true" data-icon="inline-start" />
              {resolving ? "Resolving…" : "Mark resolved"}
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-tabular min-w-0 truncate text-end text-xs">
        {value}
      </dd>
    </div>
  );
}
