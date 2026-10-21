"use client";

import { useMemo, useState } from "react";
import { Send, UsersRound, Wallet } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/api/client";
import type { OverLimitEntry } from "@/lib/api/types";
import {
  useOverLimit,
  useReportOverLimitToHr,
  useSendMonthlyInvoices,
  useUsageSummary,
} from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";
import { monthLabel } from "@/lib/format";

function kes(value: number) {
  return `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}

/** Who gets invoiced for a month, and for how much: the employees whose
 * call costs went over their role's monthly limit, each for the amount
 * over. Nobody within their limit appears here or is emailed. */
export default function InvoicesPage() {
  // /budgets/over-limit only checks one month at a time, defaulting to the
  // *current calendar month* server-side — which has no data until this
  // month's ML billing run, even though usage_summaries already has real
  // history for past months. Deriving the month list from that real data
  // (via /analytics/usage-summary, already fetched org-wide) instead of
  // hardcoding a calendar picker means every option shown actually has
  // something to check.
  const allSummaries = useUsageSummary();
  const availableMonths = useMemo(() => {
    const months = new Set((allSummaries.data?.data ?? []).map((s) => s.month));
    return Array.from(months).sort().reverse(); // most recent first
  }, [allSummaries.data]);

  const [explicitMonth, setMonth] = useState<string | null>(null);
  const month = explicitMonth ?? availableMonths[0] ?? null;

  const overLimit = useOverLimit(month ?? undefined);
  const sendInvoices = useSendMonthlyInvoices();
  const reportToHr = useReportOverLimitToHr();
  const isAdmin = useSession((state) => state.user?.role) === "Admin";
  const invoiced = overLimit.data?.data ?? [];
  const totalOver = invoiced.reduce((sum, row) => sum + row.overage_kshs, 0);

  async function handleSend() {
    if (!month) return;
    try {
      const response = await sendInvoices.mutateAsync(month);
      toast.success(
        response.message ?? `Sent ${response.data.sent} invoice(s).`,
      );
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Couldn't send invoices.",
      );
    }
  }

  async function handleReportToHr() {
    if (!month) return;
    try {
      const response = await reportToHr.mutateAsync(month);
      toast.success(response.message ?? "Emailed the HR manager.");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't email the HR manager.",
      );
    }
  }

  const columns = useMemo<ColumnDef<OverLimitEntry, unknown>[]>(
    () => [
      { accessorKey: "full_name", header: "Employee" },
      {
        accessorKey: "total_cost",
        header: "Spent",
        cell: (c) => (
          <span className="font-mono">{kes(c.getValue<number>())}</span>
        ),
      },
      {
        accessorKey: "limit_kshs",
        header: "Limit",
        cell: (c) => (
          <span className="font-mono">{kes(c.getValue<number>())}</span>
        ),
      },
      {
        accessorKey: "overage_kshs",
        header: "Invoiced (over by)",
        cell: (c) => (
          <span className="text-destructive font-mono font-medium">
            {kes(c.getValue<number>())}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Employees whose call costs went over their monthly limit, each invoiced for the amount over. Anyone within their limit is not invoiced."
      />
      <div className="px-4 pt-4 sm:px-6">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={availableMonths.length === 0}
            >
              <Wallet aria-hidden="true" />
              {month ? monthLabel(month) : "No months with data"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {availableMonths.map((m) => (
              <DropdownMenuItem key={m} onSelect={() => setMonth(m)}>
                {monthLabel(m)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {month && invoiced.length > 0 ? (
          <p className="text-muted-foreground mt-3 text-sm" aria-live="polite">
            {invoiced.length} {invoiced.length === 1 ? "employee" : "employees"}{" "}
            over their limit in {monthLabel(month)}, {kes(totalOver)} over in
            total.
          </p>
        ) : null}
      </div>
      <DataTable
        columns={columns}
        data={overLimit.data?.data}
        isLoading={overLimit.isLoading || allSummaries.isLoading}
        error={overLimit.error}
        onRetry={() => overLimit.refetch()}
        searchPlaceholder="Search employees…"
        emptyIcon={Wallet}
        emptyTitle="Nobody to invoice"
        emptyDescription={
          month
            ? `Everyone stayed within their limit in ${monthLabel(month)}.`
            : "Run ML/training/billing.py to generate usage data first."
        }
        getRowId={(row) => row.employee_id}
        toolbarEnd={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleReportToHr}
                disabled={
                  reportToHr.isPending || !month || invoiced.length === 0
                }
                title={
                  invoiced.length === 0
                    ? "Nobody is over their limit this month."
                    : undefined
                }
              >
                <UsersRound aria-hidden="true" />
                {reportToHr.isPending
                  ? "Emailing…"
                  : "Email list to HR manager"}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSend}
                disabled={sendInvoices.isPending}
              >
                <Send aria-hidden="true" />
                {sendInvoices.isPending ? "Sending…" : "Email these invoices"}
              </Button>
            </div>
          ) : undefined
        }
      />
    </>
  );
}
