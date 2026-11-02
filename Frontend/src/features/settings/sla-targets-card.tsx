"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/data/section-card";
import { ErrorBanner } from "@/components/data/error-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PRIORITY_LABELS } from "@/features/tickets/ticket-status";
import { ApiError } from "@/lib/api/client";
import { useSlaTargets, useUpdateSlaTargets } from "@/lib/api/hooks";
import type { SlaTargets, TicketPriority } from "@/lib/api/types";

const TITLE = "Ticket SLA targets";
const DESCRIPTION =
  "How many hours a ticket of each priority has to be resolved in, counted around the clock. Changes apply to new tickets only.";
const MAX_HOURS = 24 * 30;
const PRIORITIES: TicketPriority[] = ["high", "medium", "low"];

/** Admin: the SLA (service level agreement) target per ticket priority. */
export function SlaTargetsCard() {
  const { data, isLoading, error, refetch } = useSlaTargets();

  if (isLoading) {
    return (
      <SectionCard title={TITLE} description={DESCRIPTION}>
        <Skeleton className="h-9 w-full" />
      </SectionCard>
    );
  }
  if (error || !data?.data) {
    return (
      <SectionCard title={TITLE} description={DESCRIPTION}>
        <ErrorBanner error={error} onRetry={() => refetch()} />
      </SectionCard>
    );
  }
  // Keyed on the values so a save remounts the form on the new baseline.
  return (
    <SlaTargetsForm
      key={Object.values(data.data).join(":")}
      initial={data.data}
    />
  );
}

function SlaTargetsForm({ initial }: { initial: SlaTargets }) {
  const update = useUpdateSlaTargets();
  const [hours, setHours] = useState<Record<TicketPriority, string>>({
    high: String(initial.high_hours),
    medium: String(initial.medium_hours),
    low: String(initial.low_hours),
  });

  const values = PRIORITIES.map((p) => Number(hours[p]));
  const inRange = values.every(
    (h) => Number.isInteger(h) && h >= 1 && h <= MAX_HOURS,
  );
  const ordered = values[0] <= values[1] && values[1] <= values[2];
  const dirty = PRIORITIES.some(
    (p) => Number(hours[p]) !== initial[`${p}_hours`],
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!inRange || !ordered || !dirty) return;
    try {
      await update.mutateAsync({
        high_hours: values[0],
        medium_hours: values[1],
        low_hours: values[2],
      });
      toast.success("SLA targets saved.");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't save the targets.",
      );
    }
  }

  return (
    <SectionCard title={TITLE} description={DESCRIPTION}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          {PRIORITIES.map((p) => (
            <div key={p} className="flex flex-col gap-2">
              <Label htmlFor={`sla-${p}`}>{PRIORITY_LABELS[p]} (hours)</Label>
              <Input
                id={`sla-${p}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_HOURS}
                step={1}
                value={hours[p]}
                onChange={(e) =>
                  setHours((h) => ({ ...h, [p]: e.target.value }))
                }
                className="font-tabular"
              />
            </div>
          ))}
        </div>
        {inRange && !ordered ? (
          <p role="alert" className="text-destructive text-sm">
            A higher priority needs a shorter (or equal) target: High ≤ Medium ≤
            Low.
          </p>
        ) : null}
        <Button
          type="submit"
          className="w-fit"
          disabled={!inRange || !ordered || !dirty || update.isPending}
        >
          {update.isPending ? "Saving…" : "Save targets"}
        </Button>
      </form>
    </SectionCard>
  );
}
