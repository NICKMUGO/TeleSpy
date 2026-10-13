"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/data/section-card";
import { ErrorBanner } from "@/components/data/error-banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useNumberFormat, useUpdateNumberFormat } from "@/lib/api/hooks";
import type { NumberFormat } from "@/lib/api/types";

const TITLE = "Company number format";
const DESCRIPTION =
  "Every staff line is one shared prefix followed by the person's 3-digit extension.";
const EXAMPLE_EXTENSION = "370";
const PREFIX_MIN = 6;
const PREFIX_MAX = 9;

/** The standard format of a company number: a prefix every line shares,
 * then the 3-digit extension — so with 0703083, extension 370 is
 * 0703083370. Admin only (PATCH /settings/number-format). */
export function NumberFormatCard() {
  const { data, isLoading, error, refetch } = useNumberFormat();

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
  // Keyed on updated_at so a save remounts the form on the new baseline.
  return <NumberFormatForm key={data.data.updated_at} initial={data.data} />;
}

function NumberFormatForm({ initial }: { initial: NumberFormat }) {
  const update = useUpdateNumberFormat();
  const [prefix, setPrefix] = useState(initial.prefix);
  const [applyToExisting, setApplyToExisting] = useState(false);

  const valid = prefix.length >= PREFIX_MIN && prefix.length <= PREFIX_MAX;
  const dirty = prefix !== initial.prefix;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || (!dirty && !applyToExisting)) return;
    try {
      const result = await update.mutateAsync({
        prefix,
        apply_to_existing: applyToExisting,
      });
      toast.success(result.message ?? "Number format updated.");
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Couldn't save the number format.",
      );
    }
  }

  return (
    <SectionCard title={TITLE} description={DESCRIPTION}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="number-prefix">Number prefix</Label>
            <Input
              id="number-prefix"
              inputMode="numeric"
              autoComplete="off"
              className="font-tabular w-full sm:w-44"
              maxLength={PREFIX_MAX}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ""))}
              aria-invalid={!valid}
              aria-describedby="number-prefix-hint"
            />
          </div>
          <p className="text-sm" aria-live="polite">
            <span className="text-muted-foreground">
              Extension {EXAMPLE_EXTENSION} is{" "}
            </span>
            <span className="font-tabular font-medium break-all">
              {prefix}
              <span className="text-primary">{EXAMPLE_EXTENSION}</span>
            </span>
          </p>
        </div>
        <p
          id="number-prefix-hint"
          className={
            valid ? "text-muted-foreground text-xs" : "text-destructive text-xs"
          }
        >
          {PREFIX_MIN} to {PREFIX_MAX} digits — the part of the number before
          the extension. New SIMs registered with an extension get their number
          from this.
        </p>

        <div className="flex items-start gap-2.5">
          <Checkbox
            id="number-apply-existing"
            className="mt-0.5"
            checked={applyToExisting}
            onCheckedChange={(checked) => setApplyToExisting(checked === true)}
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="number-apply-existing">
              Also renumber existing SIMs
            </Label>
            <p className="text-muted-foreground text-xs">
              Rewrites the number of every SIM that has an extension to this
              prefix plus its extension. Leave off to keep the numbers already
              on record.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={
              !valid || update.isPending || (!dirty && !applyToExisting)
            }
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
          {!dirty ? (
            <span className="text-muted-foreground text-xs">
              Last updated {new Date(initial.updated_at).toLocaleString()}
            </span>
          ) : null}
        </div>
      </form>
    </SectionCard>
  );
}
