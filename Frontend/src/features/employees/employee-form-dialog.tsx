"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  ErrorDialog,
  type ErrorDialogContent,
} from "@/components/feedback/error-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  useClosingDialog,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import {
  DisplacedHolderChoice,
  EMPTY_REMOVAL,
  handoverFields,
  removalComplete,
  StepUpFields,
  type RemovalState,
} from "@/features/employees/handover-fields";
import { ApiError } from "@/lib/api/client";
import {
  describeLine,
  lineHeldBy,
  lineRuleError,
  stepUpError,
} from "@/lib/api/line-rules";
import type { Department, Employee, Role, SimCard } from "@/lib/api/types";
import { useCreateEmployee, useUpdateEmployee } from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";

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
 * changes hands. Lines are fixed: picking a free spare moves the employee
 * onto it (their old line goes to the pool, confirmed first); picking a
 * line someone else holds asks what happens to that person — swap lines
 * (a change of position) or remove them (they left; needs a reason and
 * the Admin's step-up). */
export function EmployeeFormDialog({
  mode,
  ...props
}: EmployeeFormDialogProps) {
  const dialog = useClosingDialog(props.onClose);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = props.employees.find((e) => e.id === selectedId) ?? null;

  return (
    <Dialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
      <DialogContent
        onExitComplete={dialog.onExitComplete}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        {mode === "add" ? (
          <EmployeeForm {...props} onClose={dialog.close} employee={null} />
        ) : selected ? (
          <EmployeeForm
            key={selected.id}
            {...props}
            onClose={dialog.close}
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

/** The first step of an edit (or a removal): find the employee by typing
 * part of their name, their extension code or their staff number. */
export function EmployeePicker({
  employees,
  departments,
  onPick,
  title = "Edit employee",
  description = "Search for the employee to edit by name or extension code.",
}: {
  employees: Employee[];
  departments: Department[];
  onPick: (employee: Employee) => void;
  title?: string;
  description?: string;
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
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
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
              <CommandShortcut className="font-tabular text-sm">
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
  const [email, setEmail] = useState(employee?.email ?? "");
  const [role, setRole] = useState<string>(employee?.role ?? "Employee");
  const [departmentId, setDepartmentId] = useState(
    employee?.department_id ?? "",
  );
  const [staffNumber, setStaffNumber] = useState(employee?.staff_number ?? "");
  const [extension, setExtension] = useState(employee?.extension_code ?? "");
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [choice, setChoice] = useState<"swap" | "remove" | null>(null);
  const [removal, setRemoval] = useState<RemovalState>(EMPTY_REMOVAL);
  const [adminStepUp, setAdminStepUp] = useState({ password: "", code: "" });
  const router = useRouter();
  const clearSession = useSession((state) => state.clear);
  const [ruleError, setRuleError] = useState<ErrorDialogContent | null>(null);
  const [retryError, setRetryError] = useState<ErrorDialogContent | null>(null);

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
  // A person holds one line (a SIM, or at least an extension code). Taking
  // a held line needs a choice about its holder; moving onto a free spare
  // releases the line they had.
  const heldLine = lineHeldBy(employee?.id, sims);
  const hasALine = heldLine !== null || previousExtension !== "";
  const heldLineLabel = describeLine(
    heldLine?.extension ?? previousExtension,
    heldLine?.msisdn,
  );
  const extensionChanged = extension !== previousExtension;
  const replacing = extensionChanged && currentHolder !== null;
  const releasesHeldLine = extensionChanged && hasALine && !replacing;
  const choiceReady =
    !replacing ||
    choice === "swap" ||
    (choice === "remove" && removalComplete(removal));

  // TeleSpy has exactly one Admin. Making someone else Admin hands the role
  // over — you (the Admin) become an Employee and are signed out — so it
  // takes the step-up. The Admin's own role can't be changed here.
  const isCurrentAdmin = employee?.role === "Admin";
  const handingOverAdmin = role === "Admin" && !isCurrentAdmin;
  // A line removal in the same save already asks for the step-up, and
  // one code covers the whole request.
  const removalCoversStepUp = replacing && choice === "remove";
  const adminReady =
    !handingOverAdmin ||
    removalCoversStepUp ||
    (adminStepUp.password.length > 0 && adminStepUp.code.trim().length > 0);
  const adminStepUpFields =
    handingOverAdmin && !removalCoversStepUp
      ? { password: adminStepUp.password, code: adminStepUp.code.trim() }
      : {};

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

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!fullName.trim() || nameTaken) return;
    if (!choiceReady || !adminReady) return;
    if (releasesHeldLine) {
      setConfirmingRelease(true);
      return;
    }
    void save();
  }

  // The Admin who just handed over is an Employee now and the server has
  // ended their session — sign them out here rather than let the next
  // request bounce them with a confusing "signed in elsewhere".
  function handedOver(name: string) {
    onClose();
    clearSession();
    toast.success(
      `${name} is now the Admin. You're an Employee now — sign in again to continue.`,
    );
    router.push("/login");
  }

  async function save() {
    setConfirmingRelease(false);
    const name = fullName.trim();
    const handover = replacing ? handoverFields(choice, removal) : undefined;
    try {
      if (employee) {
        const body: Parameters<typeof updateEmployee.mutateAsync>[0]["body"] =
          {};
        if (name !== employee.full_name) body.full_name = name;
        const trimmedEmail = email.trim().toLowerCase();
        if (employee.email !== undefined && trimmedEmail !== employee.email)
          body.email = trimmedEmail;
        if (role !== (employee.role ?? "")) body.role = role;
        if (departmentId && departmentId !== (employee.department_id ?? ""))
          body.department_id = departmentId;
        if (
          staffNumber.trim() &&
          staffNumber.trim() !== (employee.staff_number ?? "")
        )
          body.staff_number = staffNumber.trim();
        if (extensionChanged) {
          body.extension_code = extension || null;
          Object.assign(body, handover);
        }
        Object.assign(body, adminStepUpFields);
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        const result = await updateEmployee.mutateAsync({
          id: employee.id,
          body,
        });
        if (result.admin_handed_over) {
          handedOver(name);
          return;
        }
        toast.success(
          `${name} updated.${steppedDown(result.replaced_managers)}`,
        );
      } else {
        const result = await createEmployee.mutateAsync({
          full_name: name,
          email: email.trim(),
          role,
          department_id: departmentId || undefined,
          staff_number: staffNumber.trim() || undefined,
          extension: extension || undefined,
          ...handover,
          ...adminStepUpFields,
        });
        if (result.admin_handed_over) {
          handedOver(name);
          return;
        }
        toast.success(
          `${name} added. They've been emailed a link to set their password.${steppedDown(result.replaced_managers)}`,
        );
      }
      if (handover?.displaced_holder === "remove") {
        toast.success(`${currentHolder} was removed and HR was emailed.`);
      }
      onClose();
    } catch (error) {
      const retry = stepUpError(error);
      if (retry) {
        setRemoval((r) => ({ ...r, code: "" }));
        setAdminStepUp((s) => ({ ...s, code: "" }));
        setRetryError(retry);
        return;
      }
      const popup = lineRuleError(error);
      if (popup) {
        setRuleError(popup);
        return;
      }
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

          {/* No account behind the record (no email to show) → nothing to
           * edit here; every employee added through this form has one. */}
          {employee && employee.email === undefined ? null : (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="employee-email">Work email</Label>
              <Input
                id="employee-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                required
                aria-describedby={employee ? "employee-email-hint" : undefined}
              />
              {employee ? (
                <p
                  id="employee-email-hint"
                  className="text-muted-foreground text-xs"
                >
                  They sign in with this address. Changing it signs them out and
                  lets their old address know.
                </p>
              ) : null}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-role">Role</Label>
            <SelectNative
              id="employee-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={isCurrentAdmin}
              aria-describedby={
                isCurrentAdmin ? "employee-role-admin-note" : undefined
              }
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectNative>
            {isCurrentAdmin ? (
              <p
                id="employee-role-admin-note"
                className="text-muted-foreground text-xs"
              >
                TeleSpy always has one Admin. To hand over, edit the person
                taking over and make them Admin.
              </p>
            ) : null}
            {role === "Manager" ? (
              <p className="text-muted-foreground text-xs">
                A department has one Manager. Its current Manager, if any,
                becomes an Employee.
              </p>
            ) : null}
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
            {!extensionChanged
              ? "A person holds one line. Pick a free spare, or someone's line — then choose whether they swap or have left."
              : replacing
                ? `${fullName.trim() || "This employee"} takes over extension ${extension} from ${currentHolder}.`
                : [
                    extension
                      ? `Extension ${extension} and its SIM go to ${fullName.trim() || "this employee"}.`
                      : "",
                    hasALine
                      ? `${heldLineLabel.charAt(0).toUpperCase()}${heldLineLabel.slice(1)} goes back to the pool.`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
          </p>
        </div>

        {replacing && currentHolder ? (
          <DisplacedHolderChoice
            idPrefix="employee-handover"
            holderName={currentHolder}
            moverName={fullName.trim() || "This employee"}
            moverLine={hasALine ? heldLineLabel : null}
            choice={choice}
            onChoice={setChoice}
            removal={removal}
            onRemoval={setRemoval}
          />
        ) : null}

        {handingOverAdmin ? (
          <div className="flex flex-col gap-3">
            <Alert variant="destructive">
              <ShieldAlert aria-hidden="true" />
              <AlertTitle>This hands over the Admin role</AlertTitle>
              <AlertDescription>
                TeleSpy has one Admin at a time. When you save,{" "}
                {fullName.trim() || "this person"} becomes Admin and you become
                an Employee — you&apos;ll be signed out straight away. Both of
                you are emailed.
              </AlertDescription>
            </Alert>
            {removalCoversStepUp ? null : (
              <StepUpFields
                idPrefix="employee-admin-handover"
                password={adminStepUp.password}
                code={adminStepUp.code}
                onChange={setAdminStepUp}
                note="Handing over Admin needs your password and a one-time code."
              />
            )}
          </div>
        ) : null}

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
            variant={
              replacing && choice === "remove" ? "destructive" : "default"
            }
            disabled={
              pending ||
              !fullName.trim() ||
              nameTaken ||
              !choiceReady ||
              !adminReady
            }
          >
            {pending
              ? "Saving…"
              : replacing && choice === "remove"
                ? `Remove ${currentHolder} and save`
                : handingOverAdmin
                  ? "Hand over Admin and save"
                  : employee
                    ? "Save changes"
                    : "Add employee"}
          </Button>
        </DialogFooter>
      </form>

      <Dialog open={confirmingRelease} onOpenChange={setConfirmingRelease}>
        <DialogContent role="alertdialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {fullName.trim() || "This employee"} already has a line
            </DialogTitle>
            <DialogDescription>
              A person can hold only one extension and company number.{" "}
              {extension
                ? `Moving them to extension ${extension} releases ${heldLineLabel}`
                : `Saving with no extension releases ${heldLineLabel}`}
              , which goes back to the pool for someone else.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmingRelease(false)}
            >
              Keep their current line
            </Button>
            <Button type="button" onClick={() => void save()}>
              Release it and continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ErrorDialog error={retryError} onClose={() => setRetryError(null)} />
      <ErrorDialog
        error={ruleError}
        onClose={() => {
          setRuleError(null);
          onClose();
        }}
      />
    </>
  );
}

// Toast suffix for the people a new Manager replaced, if any.
function steppedDown(names: string[] | undefined) {
  if (!names?.length) return "";
  return ` ${names.join(", ")} ${names.length === 1 ? "is now an Employee" : "are now Employees"}.`;
}
