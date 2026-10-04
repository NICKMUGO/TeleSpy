"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import type { UsageEvent } from "@/lib/api/types";
import { useUsage } from "@/lib/api/hooks";

const CLASSIFICATION_TONE: Record<string, "secondary" | "outline" | "default"> =
  {
    Internal: "secondary",
    External: "outline",
    International: "default",
    Unknown: "outline",
  };

export default function UsagePage() {
  const usage = useUsage({ limit: 200 });

  const columns = useMemo<ColumnDef<UsageEvent, unknown>[]>(
    () => [
      {
        accessorKey: "occured_at",
        header: "When",
        cell: (c) => new Date(c.getValue<string>()).toLocaleString("en-KE"),
      },
      { accessorKey: "msisdn_pbx", header: "Extension" },
      { accessorKey: "destination", header: "Destination" },
      {
        accessorKey: "duration_minutes",
        header: "Duration",
        cell: (c) => `${c.getValue<number>().toFixed(1)} min`,
      },
      {
        accessorKey: "call_classification",
        header: "Type",
        cell: (c) => {
          const value = c.getValue<string>();
          return (
            <Badge variant={CLASSIFICATION_TONE[value] ?? "outline"}>
              {value}
            </Badge>
          );
        },
      },
      { accessorKey: "attribution_state", header: "Attribution" },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Usage events"
        description="Every ingested call record, most recent first."
      />
      <DataTable
        columns={columns}
        data={usage.data?.data}
        isLoading={usage.isLoading}
        error={usage.error}
        onRetry={() => usage.refetch()}
        searchPlaceholder="Search by extension or destination…"
        emptyIcon={Activity}
        emptyTitle="No usage events yet"
        emptyDescription="Events appear here once CDR data has been ingested."
        getRowId={(row) => row.id}
      />
    </>
  );
}
