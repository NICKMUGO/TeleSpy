"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import type { Employee } from "@/lib/api/types";
import { useDepartments, useEmployees } from "@/lib/api/hooks";

export default function EmployeesPage() {
  const employees = useEmployees();
  const departments = useDepartments();
  const deptNameById = useMemo(
    () => new Map((departments.data?.data ?? []).map((d) => [d.id, d.name])),
    [departments.data],
  );

  const columns = useMemo<ColumnDef<Employee, unknown>[]>(
    () => [
      { accessorKey: "full_name", header: "Name" },
      {
        accessorKey: "staff_number",
        header: "Staff #",
        cell: (c) => c.getValue<string | null>() ?? "—",
      },
      {
        accessorKey: "department_id",
        header: "Department",
        cell: (c) => deptNameById.get(c.getValue<string | null>() ?? "") ?? "—",
      },
      {
        accessorKey: "extension_code",
        header: "Extension",
        cell: (c) => c.getValue<string | null>() ?? "—",
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: (c) =>
          c.getValue() ? (
            <Badge variant="outline">{String(c.getValue())}</Badge>
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "is_active",
        header: "Status",
        cell: (c) => (
          <Badge variant={c.getValue() ? "secondary" : "destructive"}>
            {c.getValue() ? "Active" : "Inactive"}
          </Badge>
        ),
      },
    ],
    [deptNameById],
  );

  return (
    <>
      <PageHeader
        title="Employees"
        description="Every employee with an HR record, their department and PBX extension."
      />
      <DataTable
        columns={columns}
        data={employees.data?.data}
        isLoading={employees.isLoading}
        error={employees.error}
        onRetry={() => employees.refetch()}
        searchPlaceholder="Search employees…"
        emptyIcon={Users}
        emptyTitle="No employees yet"
        emptyDescription="Employees appear here once HR records are created."
        getRowId={(row) => row.id}
      />
    </>
  );
}
