"use client";

import { useMemo } from "react";
import { Building2 } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import type { Department } from "@/lib/api/types";
import { useDepartments } from "@/lib/api/hooks";

function kes(value: number | null) {
  if (value === null) return "—";
  return `KES ${value.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

export default function DepartmentsPage() {
  const departments = useDepartments();

  const columns = useMemo<ColumnDef<Department, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Department" },
      {
        accessorKey: "cost_centre_code",
        header: "Cost centre",
        cell: (c) => c.getValue<string | null>() ?? "—",
      },
      {
        accessorKey: "budget_ceiling",
        header: "Monthly budget ceiling",
        cell: (c) => (
          <span className="font-mono">{kes(c.getValue<number | null>())}</span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Departments"
        description="Cost centres and monthly budget ceilings for call spend after the contract discount."
      />
      <DataTable
        columns={columns}
        data={departments.data?.data}
        isLoading={departments.isLoading}
        error={departments.error}
        onRetry={() => departments.refetch()}
        searchPlaceholder="Search departments…"
        emptyIcon={Building2}
        emptyTitle="No departments yet"
        getRowId={(row) => row.id}
      />
    </>
  );
}
