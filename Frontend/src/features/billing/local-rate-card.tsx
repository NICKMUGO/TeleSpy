"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/data/section-card";
import { ErrorBanner } from "@/components/data/error-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useLocalCallRate, useUpdateLocalCallRate } from "@/lib/api/hooks";
import type { LocalCallRateSettings } from "@/lib/api/types";

function hourLabel(hour: number) {
  return `${hour.toString().padStart(2, "0")}:00`;
}

/** The local (Kenyan) list rates — peak/off-peak KES/minute, tax-inclusive,
 * before the contract discount (see DiscountsCard) — and the peak window,
 * plus the fallback rate for an unpriced international destination. Editable here (PATCH /call-rates/local) so a pricing change
 * doesn't need a redeploy; ML/training/billing.py reads this table on its
 * next run. */
export function LocalRateCard() {
  const { data, isLoading, error, refetch } = useLocalCallRate();

  if (isLoading) {
    return (
      <SectionCard
        title="Local call rates"
        description="Peak and off-peak list price for Kenyan calls, before the contract discount."
      >
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </SectionCard>
    );
  }

  if (error || !data?.data) {
    return (
      <SectionCard
        title="Local call rates"
        description="Peak and off-peak list price for Kenyan calls, before the contract discount."
      >
        <ErrorBanner error={error} onRetry={() => refetch()} />
      </SectionCard>
    );
  }

  // Keyed on updated_at: a fresh save (or another admin's edit landing via
  // refetch) gets a new timestamp, remounting this form with the new
  // canonical values as its baseline rather than leaving a stale draft.
  return <LocalRateForm key={data.data.updated_at} initial={data.data} />;
}

function LocalRateForm({ initial }: { initial: LocalCallRateSettings }) {
  const updateLocalRate = useUpdateLocalCallRate();
  const [form, setForm] = useState(initial);

  const dirty =
    form.peak_rate_kes !== initial.peak_rate_kes ||
    form.off_peak_rate_kes !== initial.off_peak_rate_kes ||
    form.peak_start_hour !== initial.peak_start_hour ||
    form.peak_end_hour !== initial.peak_end_hour ||
    form.default_international_rate_kes !==
      initial.default_international_rate_kes;

  function setField(field: keyof LocalCallRateSettings, value: number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    try {
      await updateLocalRate.mutateAsync({
        peak_rate_kes: form.peak_rate_kes,
        off_peak_rate_kes: form.off_peak_rate_kes,
        peak_start_hour: form.peak_start_hour,
        peak_end_hour: form.peak_end_hour,
        default_international_rate_kes: form.default_international_rate_kes,
      });
      toast.success("Local call rates updated.");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Couldn't save the call rates.",
      );
    }
  }

  return (
    <SectionCard
      title="Local call rates"
      description={`List price per minute for Kenyan calls, including tax and before the contract discount. Peak is ${hourLabel(form.peak_start_hour)}–${hourLabel(form.peak_end_hour)}.`}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rate-peak">Peak list rate (KES/minute)</Label>
          <Input
            id="rate-peak"
            type="number"
            step="0.01"
            min="0"
            value={form.peak_rate_kes}
            onChange={(e) => setField("peak_rate_kes", Number(e.target.value))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rate-off-peak">Off-peak list rate (KES/minute)</Label>
          <Input
            id="rate-off-peak"
            type="number"
            step="0.01"
            min="0"
            value={form.off_peak_rate_kes}
            onChange={(e) =>
              setField("off_peak_rate_kes", Number(e.target.value))
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rate-peak-start">Peak starts at (hour)</Label>
          <Input
            id="rate-peak-start"
            type="number"
            min="0"
            max="24"
            value={form.peak_start_hour}
            onChange={(e) =>
              setField("peak_start_hour", Number(e.target.value))
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rate-peak-end">Peak ends at (hour)</Label>
          <Input
            id="rate-peak-end"
            type="number"
            min="0"
            max="24"
            value={form.peak_end_hour}
            onChange={(e) => setField("peak_end_hour", Number(e.target.value))}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="rate-default-intl">
            Default international rate (KES/minute)
          </Label>
          <p className="text-muted-foreground text-xs">
            Used for a country code not yet priced in the table below.
          </p>
          <Input
            id="rate-default-intl"
            type="number"
            step="0.01"
            min="0"
            className="max-w-40"
            value={form.default_international_rate_kes}
            onChange={(e) =>
              setField("default_international_rate_kes", Number(e.target.value))
            }
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={!dirty || updateLocalRate.isPending}
        >
          {updateLocalRate.isPending ? "Saving…" : "Save changes"}
        </Button>
        {!dirty ? (
          <span className="text-muted-foreground text-xs">
            Last updated {new Date(form.updated_at).toLocaleString()}
          </span>
        ) : null}
      </div>
    </SectionCard>
  );
}
