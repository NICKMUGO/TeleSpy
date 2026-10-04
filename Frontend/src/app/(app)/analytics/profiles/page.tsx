"use client";

import { useMemo } from "react";
import { FingerprintPattern } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import type { UsageProfile } from "@/lib/api/types";
import { useUsageProfiles } from "@/lib/api/hooks";

const CLUSTER_TONE: Record<string, "secondary" | "outline" | "destructive"> = {
  low_usage: "secondary",
  moderate_usage: "outline",
  high_usage: "destructive",
};

export default function ProfilesPage() {
  const profiles = useUsageProfiles();

  const columns = useMemo<ColumnDef<UsageProfile, unknown>[]>(
    () => [
      { accessorKey: "full_name", header: "Employee" },
      {
        accessorKey: "cluster_label",
        header: "Usage cluster",
        cell: (c) => {
          const value = c.getValue<string | null>();
          return value ? (
            <Badge variant={CLUSTER_TONE[value] ?? "outline"}>
              {value.replace("_", " ")}
            </Badge>
          ) : (
            <span className="text-muted-foreground">Not yet profiled</span>
          );
        },
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Usage profiles"
        description="KMeans clustering by calling behavior — low, moderate or high usage."
      />
      <DataTable
        columns={columns}
        data={profiles.data?.data}
        isLoading={profiles.isLoading}
        error={profiles.error}
        onRetry={() => profiles.refetch()}
        searchPlaceholder="Search employees…"
        emptyIcon={FingerprintPattern}
        emptyTitle="No usage profiles yet"
        emptyDescription="Run ML/training/usage_profiling.py to populate this view."
        getRowId={(row) => row.employee_id}
      />
    </>
  );
}
