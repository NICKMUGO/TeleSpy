"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
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
import { SelectNative } from "@/components/ui/select-native";
import { ApiError } from "@/lib/api/client";
import type { Department, Employee, Role, SimCard } from "@/lib/api/types";
import { useCreateEmployee, useUpdateEmployee } from "@/lib/api/hooks";

const ROLES: Role[] = ["Employee", "Manager", "Admin"];

interface EmployeeFormDialogProps {
  /** "add" opens an empty form; "edit" first asks who to edit. */
  mode: "add" | "edit";
  employees: Employee[];
  departments: Department[];
  sims: SimCard[];
  onClose: () => void;
}

interface EmployeeFormProps extends Omit<EmployeeFormDialogProps, "mode"> {
  /** The employee being edited, or null to add a new one. */
  employee: Employee | null;
  /** Edit only: back to the list to pick someone else. */
  onChooseAnother?: () => void;
}

/** Add or edit an employee — Admin only. Adding one is the only way an
 * account comes to exist: the new employee is emailed a link to set their
 * own password. Editing starts with a search — by name, extension or staff
 * number — for the person to change. The extension field is where a line
 * changes hands: picking one that someone else holds moves it, and its
 * SIM, to this employee. */
export function EmployeeFormDialog({
  mode,
  ...props
}: EmployeeFormDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = props.employees.find((e) => e.id === selectedId) ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {mode === "add" ? (
          <EmployeeForm {...props} employee={null} />
        ) : selected ? (
          <EmployeeForm
            key={selected.id}
            {...props}
            employee={selected}
            onChooseAnother={() => setSelectedId(null)}
          />
        ) : (
          <EmployeePicker
            employees={props.employees}
            departments={props.departments}
            onPick={(employee) => setSelectedId(employee.id)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The first step of an edit: find the employee by typing part of their
 * name, their extension code or their staff number. */
function EmployeePicker({
  employees,
  departments,
  onPick,
}: {
  employees: Employee[];
  departments: Department[];
  onPick: (employee: Employee) => void;
}) {
  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );
  const sorted = useMemo(
    () => [...employees].sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [employees],
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit employee</DialogTitle>
        <DialogDescription>
          Search for the employee to edit by name or extension code.
        </DialogDescription>
      </DialogHeader>
      <Command className="border-border h-auto rounded-lg! border">
        <CommandInput
          autoFocus
          placeholder="Name, extension or staff number…"
          aria-label="Search employees by name, extension or staff number"
        />
        <CommandList>
          <CommandEmpty>No employee matches that.</CommandEmpty>
          {sorted.map((employee) => (
            <CommandItem
              key={employee.id}
              // What the search matches on; the id keeps two people who
              // share every other detail apart.
              value={`${employee.full_name} ${employee.extension_code ?? ""} ${employee.staff_number ?? ""} ${employee.id}`}
              onSelect={() => onPick(employee)}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{employee.full_name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {[
                    deptNameById.get(employee.department_id ?? ""),
                    employee.staff_number,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No department"}
                </span>
              </span>
              <CommandShortcut className="font-mono text-sm tracking-normal">
                {employee.extension_code ?? "No ext."}
              </CommandShortcut>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </>
  );
}

function EmployeeForm({
  employee,
  employees,
  departments,
  sims,
  onClose,
  onChooseAnother,
}: EmployeeFormProps) {
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const pending = createEmployee.isPending || updateEmployee.isPending;

  const [fullName, setFullName] = useState(employee?.full_name ?? "");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(employee?.role ?? "Employee");
  const [departmentId, setDepartmentId] = useState(
    employee?.department_id ?? "",
  );
  const [staffNumber, setStaffNumber] = useState(employee?.staff_number ?? "");
  const [extension, setExtension] = useState(employee?.extension_code ?? "");

  // Every extension that can be given out: one per in-service SIM, plus
  // this employee's own code if no SIM carries it.
  const extensionOptions = useMemo(() => {
    const options = new Map<string, { holder: string | null }>();
    for (const sim of sims) {
      if (!sim.extension || sim.lifecycle_state !== "active") continue;
      const heldByOther = sim.employee_id && sim.employee_id !== employee?.id;
      options.set(sim.extension, {
        holder: heldByOther ? (sim.employee_name ?? "someone else") : null,
      });
    }
    if (employee?.extension_code && !options.has(employee.extension_code)) {
      options.set(employee.extension_code, { holder: null });
    }
    return [...options.entries()]
      .map(([code, option]) => ({ code, ...option }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [sims, employee]);

  const currentHolder =
    extensionOptions.find((option) => option.code === extension)?.holder ??
    null;
  const previousExtension = employee?.extension_code ?? "";

  // Names are unique across employees (the API enforces it too) — catch a
  // clash here, ignoring case, before the request is even sent.
  const wantedName = fullName.trim().toLowerCase();
  const nameTaken =
    wantedName.length > 0 &&
    employees.some(
      (e) =>
        e.id !== employee?.id &&
        e.full_name.trim().toLowerCase() === wantedName,
    );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = fullName.trim();
    if (!name || nameTaken) return;
    try {
      if (employee) {
        const body: Parameters<typeof updateEmployee.mutateAsync>[0]["body"] =
          {};
        if (name !== employee.full_name) body.full_name = name;
        if (role !== (employee.role ?? "")) body.role = role;
        if (departmentId && departmentId !== (employee.department_id ?? ""))
          body.department_id = departmentId;
        if (
          staffNumber.trim() &&
          staffNumber.trim() !== (employee.staff_number ?? "")
        )
          body.staff_number = staffNumber.trim();
        // Also sent when the code is unchanged but its SIM sits with
        // someone else — saving then brings the line back to them.
        if (extension !== previousExtension || (extension && currentHolder))
          body.extension_code = extension || null;
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        await updateEmployee.mutateAsync({ id: employee.id, body });
        toast.success(`${name} updated.`);
      } else {
        await createEmployee.mutateAsync({
          full_name: name,
          email: email.trim(),
          role,
          department_id: departmentId || undefined,
          staff_number: staffNumber.trim() || undefined,
          extension: extension || undefined,
        });
        toast.success(
          `${name} added. They've been emailed a link to set their password.`,
        );
      }
      onClose();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't save this employee.",
      );
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{employee ? "Edit employee" : "Add employee"}</DialogTitle>
        <DialogDescription>
          {employee
            ? "Change this employee's details, or the extension they answer on."
            : "Creates their account. They get an email with a link to set their own password."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="employee-full-name">Full name</Label>
            <Input
              id="employee-full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
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

          {employee ? null : (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="employee-email">Work email</Label>
              <Input
                id="employee-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-role">Role</Label>
            <SelectNative
              id="employee-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectNative>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-department">Department</Label>
            <SelectNative
              id="employee-department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              {employee?.department_id ? null : (
                <option value="">No department</option>
              )}
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectNative>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-staff-number">Staff number</Label>
            <Input
              id="employee-staff-number"
              value={staffNumber}
              onChange={(e) => setStaffNumber(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-extension">Extension</Label>
            <SelectNative
              id="employee-extension"
              value={extension}
              onChange={(e) => setExtension(e.target.value)}
              aria-describedby="employee-extension-note"
            >
              <option value="">No extension</option>
              {extensionOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code}
                  {option.holder
                    ? ` — held by ${option.holder}`
                    : option.code === previousExtension
                      ? " — current"
                      : " — free"}
                </option>
              ))}
            </SelectNative>
          </div>

          <p
            id="employee-extension-note"
            className="text-muted-foreground text-xs sm:col-span-2"
          >
            {extension === previousExtension
              ? currentHolder
                ? `Extension ${extension} is on this employee's record, but its SIM is with ${currentHolder} — that's why no number shows. Saving moves the SIM here; ${currentHolder} keeps any other line they hold.`
                : "The extension comes with its SIM card and company number."
              : [
                  extension
                    ? currentHolder
                      ? `Extension ${extension} and its SIM move from ${currentHolder} to ${fullName.trim() || "this employee"}; ${currentHolder} is left without a line.`
                      : `Extension ${extension} and its SIM go to ${fullName.trim() || "this employee"}.`
                    : "",
                  previousExtension
                    ? `Extension ${previousExtension} becomes free for someone else.`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
          </p>
        </div>

        <DialogFooter>
          {onChooseAnother ? (
            <Button
              type="button"
              variant="ghost"
              className="sm:mr-auto"
              onClick={onChooseAnother}
            >
              <ArrowLeft aria-hidden="true" />
              Choose someone else
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={pending || !fullName.trim() || nameTaken}
          >
            {pending ? "Saving…" : employee ? "Save changes" : "Add employee"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
