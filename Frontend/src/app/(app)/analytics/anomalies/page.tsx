"use client";

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiError } from "@/lib/api/client";
import type { AnomalyFlag } from "@/lib/api/types";
import { useAnomalies, useResolveAnomaly } from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";

export default function AnomaliesPage() {
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const anomalies = useAnomalies(
    filter === "all" ? undefined : filter === "resolved",
  );
  const resolveAnomaly = useResolveAnomaly();
  const role = useSession((state) => state.user?.role);

  async function handleResolve(flagId: string) {
    try {
      await resolveAnomaly.mutateAsync(flagId);
      toast.success("Anomaly resolved.");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't resolve this anomaly.",
      );
    }
  }

  const columns = useMemo<ColumnDef<AnomalyFlag, unknown>[]>(() => {
    const base: ColumnDef<AnomalyFlag, unknown>[] = [
      {
        accessorFn: (row) => row.employee?.full_name ?? "Unattributed",
        id: "employee",
        header: "Employee",
      },
      {
        accessorKey: "anomaly_score",
        header: "Score",
        cell: (c) => (
          <span className="font-mono">{c.getValue<number>().toFixed(4)}</span>
        ),
      },
      {
        accessorFn: (row) =>
          (row.contributing_features?.reason as string) ?? "—",
        id: "reason",
        header: "Reason",
      },
      {
        accessorKey: "resolved",
        header: "Status",
        cell: (c) => (
          <Badge variant={c.getValue() ? "secondary" : "destructive"}>
            {c.getValue() ? "Resolved" : "Open"}
          </Badge>
        ),
      },
    ];
    if (role !== "Admin") return base;
    return [
      ...base,
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: (c) =>
          c.row.original.resolved ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleResolve(c.row.original.id)}
            >
              Resolve
            </Button>
          ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleResolve is stable per render
  }, [role]);

  return (
    <>
      <PageHeader
        title="Anomalies"
        description="Isolation Forest flags, scored against each event's features."
      />
      <div className="px-6 pt-4">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as typeof filter)}
        >
          <ToggleGroupItem value="open">Open</ToggleGroupItem>
          <ToggleGroupItem value="resolved">Resolved</ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <DataTable
        columns={columns}
        data={anomalies.data?.data}
        isLoading={anomalies.isLoading}
        error={anomalies.error}
        onRetry={() => anomalies.refetch()}
        searchPlaceholder="Search anomalies…"
        emptyIcon={TriangleAlert}
        emptyTitle="No anomalies to show"
        emptyDescription="Isolation Forest hasn't flagged anything in this view yet."
        getRowId={(row) => row.id}
      />
    </>
  );
}
