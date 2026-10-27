"use client";

import { useState, type FormEvent } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { ErrorBanner } from "@/components/data/error-banner";
import { StatCard } from "@/components/data/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  useReconciliation,
  useSetMonthlyInvoice,
  useUnassignedUsage,
} from "@/lib/api/hooks";
import type { ReconciliationMonth } from "@/lib/api/types";
import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** To the cent — reconciliation is the one place the exact figure matters. */
function kesExact(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `KES ${value.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isPartial(row: ReconciliationMonth) {
  return row.days_covered < row.days_in_month;
}

/** Within 2% either way counts as agreeing with the invoice. */
function differenceTone(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  return Math.abs(pct) <= 2 ? "text-success" : "text-destructive";
}

export default function ReconciliationPage() {
  const reconciliation = useReconciliation();
  const months = reconciliation.data?.data.months ?? [];
  // The headline is the latest fully covered month that has an invoice —
  // the fairest single measure of how well the rates match the contract.
  const headline = months.find(
    (m) => !isPartial(m) && m.difference_pct !== null,
  );

  return (
    <>
      <PageHeader title="Bill reconciliation" />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {reconciliation.error ? (
          <ErrorBanner
            error={reconciliation.error}
            onRetry={() => reconciliation.refetch()}
          />
        ) : reconciliation.isLoading || !reconciliation.data ? (
          <Skeleton className="h-64 w-full" />
        ) : months.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="Nothing to reconcile yet"
            description="Months appear here once the billing job has costed some calls."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              <StatCard
                label={
                  headline
                    ? `Rebuilt bill · ${monthLabel(headline.month)}`
                    : "Rebuilt bill"
                }
                value={kesExact(headline?.rebuilt_total_kes)}
                hint="Calls after discount + fixed charge"
              />
              <StatCard
                label={
                  headline
                    ? `Telco invoice · ${monthLabel(headline.month)}`
                    : "Telco invoice"
                }
                value={kesExact(headline?.invoice_total_kes)}
                hint="As entered below"
              />
              <StatCard
                label="Difference"
                value={
                  headline?.difference_pct === null ||
                  headline?.difference_pct === undefined
                    ? "—"
                    : `${headline.difference_pct > 0 ? "+" : ""}${headline.difference_pct.toFixed(1)}%`
                }
                tone={
                  headline?.difference_pct === null ||
                  headline?.difference_pct === undefined
                    ? "default"
                    : Math.abs(headline.difference_pct) <= 2
                      ? "success"
                      : "destructive"
                }
                hint={
                  headline
                    ? `${kesExact(headline.difference_kes)} against the invoice`
                    : "Enter an invoice total for a full month"
                }
              />
            </div>

            <div className="border-border overflow-x-auto rounded-lg border">
              <table data-stack className="w-full text-sm">
                <caption className="sr-only">
                  Rebuilt bill and telco invoice by month
                </caption>
                <thead className="border-border bg-muted/40 border-b">
                  <tr>
                    {[
                      "Month of calls",
                      "Calls at list price",
                      "Contract discount",
                      "Calls after discount",
                      "Fixed charge",
                      "Rebuilt bill",
                      "Telco invoice",
                      "Difference",
                    ].map((heading, i) => (
                      <th
                        key={heading}
                        scope="col"
                        className={cn(
                          "text-muted-foreground px-4 py-2.5 font-medium whitespace-nowrap",
                          i === 0 || i === 6 ? "text-left" : "text-right",
                        )}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {months.map((row) => (
                    <tr
                      key={row.month}
                      className="border-border border-b align-top last:border-b-0"
                    >
                      <th
                        scope="row"
                        className="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                      >
                        {monthLabel(row.month)}
                        {row.rebuilt_total_kes !== null && isPartial(row) ? (
                          <span className="text-muted-foreground block text-xs font-normal">
                            Partial: {row.days_covered} of {row.days_in_month}{" "}
                            days of call data
                          </span>
                        ) : null}
                      </th>
                      <Money value={row.calls_list_cost_kes} />
                      <Money value={-row.discount_kes} />
                      <td className="font-tabular px-4 py-2.5 text-right whitespace-nowrap">
                        {kesExact(row.calls_cost_kes)}
                        {row.unassigned_lines_cost_kes > 0 ? (
                          <span className="text-destructive block text-xs">
                            incl. {kesExact(row.unassigned_lines_cost_kes)} on
                            unassigned lines
                          </span>
                        ) : null}
                      </td>
                      <Money
                        value={
                          row.rebuilt_total_kes === null
                            ? null
                            : row.fixed_charge_kes
                        }
                      />
                      <Money value={row.rebuilt_total_kes} strong />
                      <td className="px-4 py-2">
                        <InvoiceInput
                          // Remount on a saved change so the box shows the
                          // stored figure.
                          key={`${row.month}-${row.invoice_total_kes}`}
                          row={row}
                        />
                      </td>
                      <td
                        className={cn(
                          "font-tabular px-4 py-2.5 text-right whitespace-nowrap",
                          differenceTone(row.difference_pct),
                        )}
                      >
                        {row.difference_pct === null ? (
                          "—"
                        ) : (
                          <>
                            {row.difference_pct > 0 ? "+" : ""}
                            {row.difference_pct.toFixed(1)}%
                            <span className="block text-xs">
                              {kesExact(row.difference_kes)}
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <UnassignedLines />

            <div className="text-muted-foreground flex flex-col gap-2 text-sm">
              <p>
                Each row is the month the calls were made in. The telco&rsquo;s
                invoice for those calls is dated the 1st of the following month,
                so July&rsquo;s calls are on the invoice dated 1 August.
              </p>
              <p>
                The rebuilt bill is every employee&rsquo;s call costs after the
                contract discount, plus the line&rsquo;s fixed monthly charge of{" "}
                {kesExact(reconciliation.data.data.fixed_monthly_charge_kes)}{" "}
                with {reconciliation.data.data.excise_rate_pct}% excise and{" "}
                {reconciliation.data.data.vat_rate_pct}% VAT (
                {kesExact(
                  reconciliation.data.data.fixed_monthly_charge_with_tax_kes,
                )}
                ). Rates, discounts and the fixed charge are set under Settings,
                Call rates.
              </p>
              <p>
                A partial month has call data for only some of its days, so its
                rebuilt bill will come out below the invoice. Judge the rates by
                the full months.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Spend on lines nobody held — a SIM in the pool that someone kept
 * using. It's on the telco's bill (and in the rebuilt bill above) but
 * billed to no employee, so it's listed here to be chased up. */
function UnassignedLines() {
  const usage = useUnassignedUsage();
  const rows = usage.data?.data ?? [];
  if (rows.length === 0) return null;
  return (
    <section
      aria-labelledby="unassigned-lines-heading"
      className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4"
    >
      <div>
        <h2 id="unassigned-lines-heading" className="font-semibold">
          Calls on unassigned lines
        </h2>
        <p className="text-muted-foreground text-sm">
          These lines had no holder but were still used. Find out who has the
          SIM and give it to them under SIM cards — until then nobody is billed
          for this spend.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table data-stack className="w-full text-sm">
          <caption className="sr-only">Spend on unassigned lines</caption>
          <thead>
            <tr className="border-border border-b">
              {["Month", "Extension", "Calls", "Cost"].map((heading, i) => (
                <th
                  key={heading}
                  scope="col"
                  className={cn(
                    "text-muted-foreground py-2 pr-4 font-medium",
                    i < 2 ? "text-left" : "text-right",
                  )}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-border border-b last:border-b-0"
              >
                <td className="py-2 pr-4">{monthLabel(row.month)}</td>
                <td className="font-tabular py-2 pr-4">{row.extension_code}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {row.calls.toLocaleString("en-KE")}
                </td>
                <td className="font-tabular py-2 pr-4 text-right">
                  {kesExact(row.total_cost_kes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Money({
  value,
  strong,
}: {
  value: number | null | undefined;
  strong?: boolean;
}) {
  return (
    <td
      className={cn(
        "font-tabular px-4 py-2.5 text-right whitespace-nowrap",
        strong && "font-semibold",
      )}
    >
      {kesExact(value)}
    </td>
  );
}

/** The invoice total for one month: type the figure and save, or clear it. */
function InvoiceInput({ row }: { row: ReconciliationMonth }) {
  const setInvoice = useSetMonthlyInvoice();
  const [value, setValue] = useState(
    row.invoice_total_kes === null ? "" : String(row.invoice_total_kes),
  );
  const parsed = value.trim() === "" ? null : Number(value);
  const valid = parsed === null || (Number.isFinite(parsed) && parsed > 0);
  const dirty = parsed !== row.invoice_total_kes;
  const label = `Telco invoice total for ${monthLabel(row.month)}, in KES`;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !dirty) return;
    try {
      await setInvoice.mutateAsync({
        month: row.month,
        invoiceTotalKes: parsed,
      });
      toast.success(
        parsed === null
          ? `Invoice cleared for ${monthLabel(row.month)}.`
          : `Invoice saved for ${monthLabel(row.month)}.`,
      );
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't save the invoice.",
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <Input
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        placeholder="Enter total"
        aria-label={label}
        aria-invalid={!valid}
        className="font-tabular w-36"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={!dirty || !valid || setInvoice.isPending}
      >
        {setInvoice.isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
