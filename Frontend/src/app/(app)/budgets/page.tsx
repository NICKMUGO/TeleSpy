"use client";

import { useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OverLimitEntry } from "@/lib/api/types";
import { useOverLimit, useUsageSummary } from "@/lib/api/hooks";

function kes(value: number) {
  return `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}

export default function BudgetsPage() {
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

  const columns = useMemo<ColumnDef<OverLimitEntry, unknown>[]>(
    () => [
      { accessorKey: "full_name", header: "Employee" },
      {
        accessorKey: "total_cost",
        header: "Spent",
        cell: (c) => <span className="font-mono">{kes(c.getValue<number>())}</span>,
      },
      {
        accessorKey: "limit_kshs",
        header: "Limit",
        cell: (c) => <span className="font-mono">{kes(c.getValue<number>())}</span>,
      },
      {
        accessorKey: "overage_kshs",
        header: "Over by",
        cell: (c) => (
          <span className="text-destructive font-mono font-medium">{kes(c.getValue<number>())}</span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Employees who've breached their role's monthly cost ceiling, by month."
      />
      <div className="px-6 pt-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="w-fit" disabled={availableMonths.length === 0}>
              <Wallet aria-hidden="true" />
              {month ?? "No months with data"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {availableMonths.map((m) => (
              <DropdownMenuItem key={m} onSelect={() => setMonth(m)}>
                {m}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <DataTable
        columns={columns}
        data={overLimit.data?.data}
        isLoading={overLimit.isLoading || allSummaries.isLoading}
        error={overLimit.error}
        onRetry={() => overLimit.refetch()}
        searchPlaceholder="Search employees…"
        emptyIcon={Wallet}
        emptyTitle="Everyone was within budget"
        emptyDescription={month ? `No employee breached their cost ceiling in ${month}.` : "Run ML/training/billing.py to generate usage data first."}
        getRowId={(row) => row.employee_id}
      />
    </>
  );
}
