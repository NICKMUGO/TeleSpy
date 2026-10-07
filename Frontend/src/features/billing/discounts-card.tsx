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
import { kes } from "@/lib/format";

const TITLE = "Network, contract discount and fixed charge";
const DESCRIPTION =
  "Which telco your line is with, the discount it takes off each call type, and the line's monthly rental. All of it comes from the telco's contract and invoice.";

// Comma-separated 3-digit prefixes or ranges of them, e.g. "700-729, 748".
const PREFIX_LIST =
  /^\s*\d{3}(\s*-\s*\d{3})?(\s*,\s*\d{3}(\s*-\s*\d{3})?)*\s*$/;

type DiscountField =
  | "discount_on_net_peak_pct"
  | "discount_on_net_off_peak_pct"
  | "discount_off_net_peak_pct"
  | "discount_off_net_off_peak_pct"
  | "discount_international_pct";

/** `network` is the home network's name, as entered above the discounts. */
const discounts = (
  network: string,
): { field: DiscountField; label: string; hint: string }[] => [
  {
    field: "discount_on_net_peak_pct",
    label: `${network} numbers, peak`,
    hint: `Calls to ${network} numbers in peak hours.`,
  },
  {
    field: "discount_on_net_off_peak_pct",
    label: `${network} numbers, off-peak`,
    hint: `Calls to ${network} numbers outside peak hours.`,
  },
  {
    field: "discount_off_net_peak_pct",
    label: "Other networks, peak",
    hint: "Other Kenyan mobile networks and fixed lines, peak hours.",
  },
  {
    field: "discount_off_net_off_peak_pct",
    label: "Other networks, off-peak",
    hint: "Other Kenyan mobile networks and fixed lines, outside peak hours.",
  },
  {
    field: "discount_international_pct",
    label: "International",
    hint: "Calls to any other country.",
  },
];

const DISCOUNT_FIELDS = discounts("").map((d) => d.field);

const NUMERIC = [
  ...DISCOUNT_FIELDS,
  "fixed_monthly_charge_kes",
  "excise_rate_pct",
  "vat_rate_pct",
] as const;
const TEXT = ["home_network_name", "on_net_prefixes"] as const;
const EDITABLE = [...NUMERIC, ...TEXT] as const;

/** The home network, the contract discount per call type and the line's fixed monthly charge
 * with its taxes — the parts of the telco's bill that the list rates alone
 * don't capture. Saved through the same PATCH /call-rates/local as the
 * rates; ML/training/billing.py applies the discounts on its next run, and
 * the fixed charge is added on the Bill reconciliation page. */
export function DiscountsCard() {
  const { data, isLoading, error, refetch } = useLocalCallRate();

  if (isLoading) {
    return (
      <SectionCard title={TITLE} description={DESCRIPTION}>
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
      <SectionCard title={TITLE} description={DESCRIPTION}>
        <ErrorBanner error={error} onRetry={() => refetch()} />
      </SectionCard>
    );
  }

  // Keyed on updated_at so a save remounts the form on the new values.
  return <DiscountsForm key={data.data.updated_at} initial={data.data} />;
}

function DiscountsForm({ initial }: { initial: LocalCallRateSettings }) {
  const updateLocalRate = useUpdateLocalCallRate();
  const [form, setForm] = useState(initial);

  const dirty = EDITABLE.some((field) => form[field] !== initial[field]);
  const networkName = form.home_network_name.trim() || "Home network";
  const prefixesValid = PREFIX_LIST.test(form.on_net_prefixes);
  const percentagesValid = [
    ...DISCOUNT_FIELDS.map((field) => form[field]),
    form.excise_rate_pct,
    form.vat_rate_pct,
  ].every((value) => value >= 0 && value <= 100);
  const valid =
    percentagesValid &&
    prefixesValid &&
    form.home_network_name.trim().length > 0 &&
    form.fixed_monthly_charge_kes >= 0;

  // Excise is charged on the rental, then VAT on rental + excise.
  const fixedWithTax =
    form.fixed_monthly_charge_kes *
    (1 + form.excise_rate_pct / 100) *
    (1 + form.vat_rate_pct / 100);

  function setField(field: (typeof EDITABLE)[number], value: number | string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    try {
      await updateLocalRate.mutateAsync(
        Object.fromEntries(EDITABLE.map((field) => [field, form[field]])),
      );
      toast.success(
        "Saved. Discounts take effect the next time billing is run.",
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Couldn't save the changes.",
      );
    }
  }

  return (
    <SectionCard title={TITLE} description={DESCRIPTION}>
      <h3 className="mb-3 text-sm font-medium">Your network</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="home-network-name">Telco</Label>
          <Input
            id="home-network-name"
            maxLength={60}
            value={form.home_network_name}
            onChange={(e) => setField("home_network_name", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="on-net-prefixes">{networkName} number prefixes</Label>
          <Input
            id="on-net-prefixes"
            className="font-mono"
            aria-describedby="on-net-prefixes-hint"
            aria-invalid={!prefixesValid}
            value={form.on_net_prefixes}
            onChange={(e) => setField("on_net_prefixes", e.target.value)}
          />
          <p
            id="on-net-prefixes-hint"
            className="text-muted-foreground text-xs"
          >
            The first three digits of a number after its leading 0, singly or as
            ranges, separated by commas: 722 for 0722…, or 700-729. Calls to
            these count as {networkName}; every other local number counts as
            another network.
          </p>
        </div>
      </div>

      <h3 className="mt-6 mb-3 text-sm font-medium">
        Discount off the list rate (%)
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {discounts(networkName).map(({ field, label, hint }) => (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={field}>{label}</Label>
            <p id={`${field}-hint`} className="text-muted-foreground text-xs">
              {hint}
            </p>
            <Input
              id={field}
              type="number"
              step="0.1"
              min="0"
              max="100"
              className="max-w-40"
              aria-describedby={`${field}-hint`}
              value={form[field]}
              onChange={(e) => setField(field, Number(e.target.value))}
            />
          </div>
        ))}
      </div>

      <h3 className="mt-6 mb-3 text-sm font-medium">Fixed monthly charge</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fixed-monthly-charge">
            Line rental before tax (KES/month)
          </Label>
          <Input
            id="fixed-monthly-charge"
            type="number"
            step="0.01"
            min="0"
            value={form.fixed_monthly_charge_kes}
            onChange={(e) =>
              setField("fixed_monthly_charge_kes", Number(e.target.value))
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="excise-rate">Excise duty (%)</Label>
          <Input
            id="excise-rate"
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={form.excise_rate_pct}
            onChange={(e) =>
              setField("excise_rate_pct", Number(e.target.value))
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vat-rate">VAT (%)</Label>
          <Input
            id="vat-rate"
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={form.vat_rate_pct}
            onChange={(e) => setField("vat_rate_pct", Number(e.target.value))}
          />
        </div>
      </div>
      <p className="text-muted-foreground mt-3 text-xs" aria-live="polite">
        With tax the rental comes to {kes(fixedWithTax)} a month. It is a
        company-level cost: it is added on the Bill reconciliation page and is
        not charged to any employee or department.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={!dirty || !valid || updateLocalRate.isPending}
        >
          {updateLocalRate.isPending ? "Saving…" : "Save changes"}
        </Button>
        {!valid ? (
          <span role="alert" className="text-destructive text-xs">
            Check the telco name and prefix list; percentages must be between 0
            and 100, and the rental can&rsquo;t be negative.
          </span>
        ) : null}
      </div>
    </SectionCard>
  );
}
