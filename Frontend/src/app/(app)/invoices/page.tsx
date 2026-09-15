"use client";

import { useMemo } from "react";
import { FileText, Send } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/data/error-banner";
import { EmptyState } from "@/components/data/empty-state";
import { ApiError } from "@/lib/api/client";
import type { UsageSummary } from "@/lib/api/types";
import {
  useMyUsage,
  useSendMonthlyInvoices,
  useUsageSummary,
} from "@/lib/api/hooks";
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
    header: "Statement generated",
    cell: (c) => new Date(c.getValue<string>()).toLocaleDateString("en-KE"),
  },
];

export default function InvoicesPage() {
  const role = useSession((state) => state.user?.role);
  return role === "Employee" ? <MyInvoices /> : <OrgInvoices />;
}

function MyInvoices() {
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
        cell: (c) => <span className="font-mono font-medium">{kes(c.getValue<number>())}</span>,
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
        header: "Statement generated",
        cell: (c) => new Date(c.getValue<string>()).toLocaleDateString("en-KE"),
      },
    ],
    [limitKshs],
  );

  return (
    <>
      <PageHeader
        title="Your invoices"
        description={
          limitKshs !== null
            ? `Your monthly telecom usage statements — your role's limit is ${kes(limitKshs)}/month.`
            : "Your monthly telecom usage statements, sent to your email each billing cycle."
        }
      />
      {myUsage.isLoading ? (
        <div className="flex flex-col gap-2 p-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : myUsage.error ? (
        <ErrorBanner error={myUsage.error} onRetry={() => myUsage.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No invoices yet"
          description="Your first monthly statement appears here once billing has run for a full month of usage."
        />
      ) : (
        <DataTable
          columns={myColumns}
          data={rows}
          searchPlaceholder="Search by month…"
          emptyIcon={FileText}
          emptyTitle="No invoices yet"
          getRowId={(row) => row.id}
        />
      )}
    </>
  );
}

function OrgInvoices() {
  const usageSummary = useUsageSummary();
  const role = useSession((state) => state.user?.role);
  const sendMonthly = useSendMonthlyInvoices();

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

  async function handleSend() {
    try {
      const response = await sendMonthly.mutateAsync();
      toast.success(
        response.message ?? `Sent ${response.data.sent} invoice(s).`,
      );
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Couldn't send invoices.",
      );
    }
  }

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every employee's monthly usage statement, billed by the ML pipeline from the CDR dataset."
      />
      <DataTable
        columns={orgColumns}
        data={usageSummary.data?.data}
        isLoading={usageSummary.isLoading}
        error={usageSummary.error}
        onRetry={() => usageSummary.refetch()}
        searchPlaceholder="Search by employee or month…"
        emptyIcon={FileText}
        emptyTitle="No invoices yet"
        emptyDescription="Run ML/training/billing.py to generate this month's statements."
        getRowId={(row) => row.id}
        toolbarEnd={
          role === "Admin" ? (
            <Button
              type="button"
              size="sm"
              onClick={handleSend}
              disabled={sendMonthly.isPending}
            >
              <Send aria-hidden="true" />
              {sendMonthly.isPending
                ? "Sending…"
                : "Send this month's invoices"}
            </Button>
          ) : undefined
        }
      />
    </>
  );
}
