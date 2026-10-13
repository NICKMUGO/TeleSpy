"use client";

import { useMemo, useState } from "react";
import { Pencil, UserPlus, Users } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmployeeFormDialog } from "@/features/employees/employee-form-dialog";
import type { Employee } from "@/lib/api/types";
import { useDepartments, useEmployees, useSims } from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";

export default function EmployeesPage() {
  const employees = useEmployees();
  const departments = useDepartments();
  const sims = useSims();
  // Only an Admin may add an employee or change one (POST/PATCH
  // /employees) — including who holds which extension.
  const isAdmin = useSession((state) => state.user?.role) === "Admin";
  // Which dialog is open: adding someone, or finding someone to edit.
  const [dialog, setDialog] = useState<"add" | "edit" | null>(null);

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
      ...(isAdmin
        ? [
            {
              accessorKey: "msisdn",
              header: "Number",
              cell: (c) => (
                <span className="font-tabular">
                  {c.getValue<string | undefined>() ?? "—"}
                </span>
              ),
            } satisfies ColumnDef<Employee, unknown>,
          ]
        : []),
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
    [deptNameById, isAdmin],
  );

  return (
    <>
      <PageHeader
        title="Employees"
        description="Every employee with an HR record, their department and PBX extension."
        actions={
          isAdmin ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog("edit")}
              >
                <Pencil aria-hidden="true" />
                Edit employee
              </Button>
              <Button type="button" onClick={() => setDialog("add")}>
                <UserPlus aria-hidden="true" />
                Add employee
              </Button>
            </>
          ) : undefined
        }
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
        emptyDescription="Employees appear here once an Admin adds them."
        getRowId={(row) => row.id}
      />
      {dialog ? (
        <EmployeeFormDialog
          key={dialog}
          mode={dialog}
          employees={employees.data?.data ?? []}
          departments={departments.data?.data ?? []}
          sims={sims.data?.data ?? []}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
