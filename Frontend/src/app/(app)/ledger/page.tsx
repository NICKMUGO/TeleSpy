"use client";

import { useMemo } from "react";
import { BookOpen } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/data/error-banner";
import { EmptyState } from "@/components/data/empty-state";
import type { UsageSummary } from "@/lib/api/types";
import { useMyUsage, useUsageSummary } from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";

function kes(value: number) {
  return `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}

const columns: ColumnDef<UsageSummary, unknown>[] = [
  { accessorKey: "month", header: "Month" },
  {
    accessorKey: "extension_code",
    header: "Extension",
    cell: (c) => c.getValue<string | null>() ?? "—",
  },
  {
    accessorKey: "total_cost",
    header: "Amount",
    cell: (c) => (
      <span className="font-mono font-medium">{kes(c.getValue<number>())}</span>
    ),
  },
  {
    accessorKey: "updated_at",
    header: "Last costed",
    cell: (c) => new Date(c.getValue<string>()).toLocaleDateString("en-KE"),
  },
];

/** The spend ledger: what each employee's calls cost per month. An
 * Employee sees their own months, with whether each was within their
 * limit; Admins and Managers see everyone's. */
export default function LedgerPage() {
  const role = useSession((state) => state.user?.role);
  return role === "Employee" ? <MyLedger /> : <OrgLedger />;
}

function MyLedger() {
  const myUsage = useMyUsage();
  const rows = myUsage.data?.data.cost_summaries ?? [];
  const limitKshs = myUsage.data?.data.limit_kshs ?? null;

  // Month is sorted newest-first here (unlike the shared `columns`, which
  // leaves ordering to whatever the API returned) — this is specifically
  // "track previous months you went over," so the most useful order is
  // most-recent-first, not insertion order.
  const myColumns = useMemo<ColumnDef<UsageSummary, unknown>[]>(
    () => [
      { accessorKey: "month", header: "Month", sortDescFirst: true },
      {
        accessorKey: "extension_code",
        header: "Extension",
        cell: (c) => c.getValue<string | null>() ?? "—",
      },
      {
        accessorKey: "total_cost",
        header: "Amount",
        cell: (c) => (
          <span className="font-mono font-medium">
            {kes(c.getValue<number>())}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: (c) => {
          if (limitKshs === null) return null;
          const overBy = c.row.original.total_cost - limitKshs;
          return overBy > 0 ? (
            <Badge variant="destructive">Over by {kes(overBy)}</Badge>
          ) : (
            <Badge variant="secondary">Within limit</Badge>
          );
        },
      },
      {
        accessorKey: "updated_at",
        header: "Last costed",
        cell: (c) => new Date(c.getValue<string>()).toLocaleDateString("en-KE"),
      },
    ],
    [limitKshs],
  );

  return (
    <>
      <PageHeader
        title="Your spend ledger"
        description={
          limitKshs !== null
            ? `What your calls cost each month. Your limit is ${kes(limitKshs)} a month; you are only invoiced for a month you go over it.`
            : "What your calls cost each month."
        }
      />
      {myUsage.isLoading ? (
        <div className="flex flex-col gap-2 p-4 sm:p-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : myUsage.error ? (
        <ErrorBanner error={myUsage.error} onRetry={() => myUsage.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Nothing in your ledger yet"
          description="Your first month appears here once billing has run."
        />
      ) : (
        <DataTable
          columns={myColumns}
          data={rows}
          searchPlaceholder="Search by month…"
          emptyIcon={BookOpen}
          emptyTitle="Nothing in your ledger yet"
          getRowId={(row) => row.id}
        />
      )}
    </>
  );
}

function OrgLedger() {
  const usageSummary = useUsageSummary();

  const orgColumns = useMemo<ColumnDef<UsageSummary, unknown>[]>(
    () => [
      { accessorKey: "full_name", header: "Employee" } as ColumnDef<
        UsageSummary,
        unknown
      >,
      ...columns,
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Spend ledger"
        description="What each employee's calls cost, month by month, after the contract discount. Invoices for anyone over their limit are on the Invoices page."
      />
      <DataTable
        columns={orgColumns}
        data={usageSummary.data?.data}
        isLoading={usageSummary.isLoading}
        error={usageSummary.error}
        onRetry={() => usageSummary.refetch()}
        searchPlaceholder="Search by employee or month…"
        emptyIcon={BookOpen}
        emptyTitle="Nothing in the ledger yet"
        emptyDescription="Run ML/training/billing.py to cost this month's calls."
        getRowId={(row) => row.id}
      />
    </>
  );
}
