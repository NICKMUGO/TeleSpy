"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/client";
import { useUpdateInternationalCallRate } from "@/lib/api/hooks";
import type { InternationalCallRate } from "@/lib/api/types";

/** One editable rate cell: view mode shows "KES X.XX/min" with an edit
 * button; edit mode swaps in a number input + save/cancel, PATCHing
 * /call-rates/international/<country_code> on save. Isolated per-row state
 * so editing one country's rate never touches the rest of the table. */
export function InternationalRateRow({
  rate,
}: {
  rate: InternationalCallRate;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(rate.rate_kes_per_minute);
  const updateRate = useUpdateInternationalCallRate();

  function startEditing() {
    setValue(rate.rate_kes_per_minute);
    setEditing(true);
  }

  async function handleSave() {
    if (value <= 0) {
      toast.error("Rate must be a positive number.");
      return;
    }
    try {
      await updateRate.mutateAsync({
        countryCode: rate.country_code,
        body: { rate_kes_per_minute: value },
      });
      toast.success(
        `Updated rate for ${rate.country_name ?? rate.country_code}.`,
      );
      setEditing(false);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Couldn't save this rate.",
      );
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-tabular">
          KES{" "}
          {rate.rate_kes_per_minute.toLocaleString("en-KE", {
            minimumFractionDigits: 2,
          })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Edit rate for ${rate.country_name ?? rate.country_code}`}
          onClick={startEditing}
        >
          <Pencil aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        step="0.01"
        min="0"
        autoFocus
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-8 w-24"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Save"
        disabled={updateRate.isPending}
        onClick={handleSave}
      >
        <Check aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Cancel"
        disabled={updateRate.isPending}
        onClick={() => setEditing(false)}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
