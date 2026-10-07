"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Pencil, Users } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import type { Employee } from "@/lib/api/types";
import {
  useDepartments,
  useEmployees,
  useUpdateEmployee,
} from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";

export default function EmployeesPage() {
  const employees = useEmployees();
  const departments = useDepartments();
  const updateEmployee = useUpdateEmployee();
  // Only an Admin may edit an employee (PATCH /employees/{id}).
  const canEdit = useSession((state) => state.user?.role) === "Admin";
  const [editing, setEditing] = useState<Employee | null>(null);
  const [name, setName] = useState("");

  const deptNameById = useMemo(
    () => new Map((departments.data?.data ?? []).map((d) => [d.id, d.name])),
    [departments.data],
  );

  // Names are unique across employees (the API enforces it too) — catch a
  // clash here, ignoring case, before the request is even sent.
  const nameTaken = useMemo(() => {
    const wanted = name.trim().toLowerCase();
    if (!editing || !wanted) return false;
    return (employees.data?.data ?? []).some(
      (e) => e.id !== editing.id && e.full_name.trim().toLowerCase() === wanted,
    );
  }, [name, editing, employees.data]);

  function startEditing(employee: Employee) {
    setEditing(employee);
    setName(employee.full_name);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const fullName = name.trim();
    if (!editing || !fullName || nameTaken) return;
    try {
      await updateEmployee.mutateAsync({
        id: editing.id,
        body: { full_name: fullName },
      });
      toast.success("Name updated.");
      setEditing(null);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Couldn't update the name.",
      );
    }
  }

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
      ...(canEdit
        ? [
            {
              id: "actions",
              header: "",
              enableSorting: false,
              cell: (c) => (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => startEditing(c.row.original)}
                >
                  <Pencil aria-hidden="true" />
                  Edit name
                  <span className="sr-only">
                    {" "}
                    of {c.row.original.full_name}
                  </span>
                </Button>
              ),
            } satisfies ColumnDef<Employee, unknown>,
          ]
        : []),
    ],
    [deptNameById, canEdit],
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
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit name</DialogTitle>
            <DialogDescription>
              {editing?.extension_code
                ? `The employee on extension ${editing.extension_code}.`
                : "Change how this employee's name appears across TeleSpy."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-full-name">Full name</Label>
              <Input
                id="employee-full-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                required
                aria-invalid={nameTaken}
                aria-describedby={
                  nameTaken ? "employee-full-name-error" : undefined
                }
              />
              {nameTaken ? (
                <p
                  id="employee-full-name-error"
                  role="alert"
                  className="text-destructive text-sm"
                >
                  Another employee already has that name. Names must be unique —
                  add a middle name or initial.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  updateEmployee.isPending ||
                  !name.trim() ||
                  nameTaken ||
                  name.trim() === editing?.full_name
                }
              >
                {updateEmployee.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
