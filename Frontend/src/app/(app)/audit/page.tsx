"use client";

import { useMemo } from "react";
import { Lock } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import type { AuditLogEntry } from "@/lib/api/types";
import { useAuditLog } from "@/lib/api/hooks";

export default function AuditPage() {
  const audit = useAuditLog();

  const columns = useMemo<ColumnDef<AuditLogEntry, unknown>[]>(
    () => [
      {
        accessorKey: "occured_at",
        header: "When",
        cell: (c) => new Date(c.getValue<string>()).toLocaleString("en-KE"),
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: (c) => <Badge variant="outline">{c.getValue<string>()}</Badge>,
      },
      {
        accessorKey: "resource",
        header: "Resource",
        cell: (c) => c.getValue<string | null>() ?? "—",
      },
      {
        accessorKey: "actor_role",
        header: "Actor role",
        cell: (c) => c.getValue<string | null>() ?? "system",
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every recorded action across the system — admin visibility only."
      />
      <DataTable
        columns={columns}
        data={audit.data?.data}
        isLoading={audit.isLoading}
        error={audit.error}
        onRetry={() => audit.refetch()}
        searchPlaceholder="Search audit entries…"
        emptyIcon={Lock}
        emptyTitle="No audit entries yet"
        getRowId={(row) => row.id}
      />
    </>
  );
}
