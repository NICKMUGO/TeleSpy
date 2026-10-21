"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  ErrorDialog,
  type ErrorDialogContent,
} from "@/components/feedback/error-dialog";
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
import { EmployeePicker } from "@/features/employees/employee-form-dialog";
import {
  EMPTY_REMOVAL,
  RemovalFields,
  removalComplete,
  type RemovalState,
} from "@/features/employees/handover-fields";
import { ApiError } from "@/lib/api/client";
import {
  describeLine,
  lineHeldBy,
  lineRuleError,
  stepUpError,
} from "@/lib/api/line-rules";
import type { Department, Employee, SimCard } from "@/lib/api/types";
import { useRemoveEmployee } from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";

/** "Remove (left company)" — Admin only. Pick the leaver, then confirm:
 * their line goes back to the pool, their login is turned off and they
 * drop out of every list, while their past calls and bills are kept.
 * Because that stops their line being tracked against them, it takes a
 * reason, their name typed out, the Admin's password and an emailed code,
 * and the HR manager and Admins are told. */
export function RemoveEmployeeDialog({
  employees,
  departments,
  sims,
  onClose,
}: {
  employees: Employee[];
  departments: Department[];
  sims: SimCard[];
  onClose: () => void;
}) {
  const ownEmployeeId = useSession((state) => state.user?.employee_id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = employees.find((e) => e.id === selectedId) ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {selected ? (
          <RemoveForm
            key={selected.id}
            employee={selected}
            sims={sims}
            onBack={() => setSelectedId(null)}
            onClose={onClose}
          />
        ) : (
          <EmployeePicker
            // Another Admin has to remove you.
            employees={employees.filter((e) => e.id !== ownEmployeeId)}
            departments={departments}
            onPick={(employee) => setSelectedId(employee.id)}
            title="Remove an employee"
            description="Find the person who left the company."
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RemoveForm({
  employee,
  sims,
  onBack,
  onClose,
}: {
  employee: Employee;
  sims: SimCard[];
  onBack: () => void;
  onClose: () => void;
}) {
  const removeEmployee = useRemoveEmployee();
  const [removal, setRemoval] = useState<RemovalState>(EMPTY_REMOVAL);
  const [confirmName, setConfirmName] = useState("");
  const [ruleError, setRuleError] = useState<ErrorDialogContent | null>(null);
  const [retryError, setRetryError] = useState<ErrorDialogContent | null>(null);

  const heldLine = lineHeldBy(employee.id, sims);
  const line =
    heldLine || employee.extension_code
      ? describeLine(
          heldLine?.extension ?? employee.extension_code,
          heldLine?.msisdn,
        )
      : null;
  const nameMatches =
    confirmName.trim().toLowerCase() ===
    employee.full_name.trim().toLowerCase();
  const ready = nameMatches && removalComplete(removal) && removal.reason;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !removal.reason) return;
    try {
      await removeEmployee.mutateAsync({
        id: employee.id,
        body: {
          removal_reason: removal.reason,
          confirm_name: confirmName.trim(),
          password: removal.password,
          code: removal.code.trim(),
        },
      });
      toast.success(
        `${employee.full_name} was removed. HR and the Admins were emailed.`,
      );
      onClose();
    } catch (error) {
      const retry = stepUpError(error);
      if (retry) {
        setRemoval((r) => ({ ...r, code: "" }));
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
          : "Couldn't remove this employee.",
      );
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Remove {employee.full_name}?</DialogTitle>
        <DialogDescription>
          For someone who has left the company.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div
          role="note"
          className="border-destructive/40 bg-destructive/5 flex gap-2 rounded-lg border p-3 text-sm"
        >
          <TriangleAlert
            aria-hidden="true"
            className="text-destructive mt-0.5 size-4 shrink-0"
          />
          <ul className="flex list-none flex-col gap-1">
            <li>
              {line
                ? `Their ${line} goes back to the pool. Any calls on it are reported to HR and the Admins until it's given to someone.`
                : "They hold no line."}
            </li>
            <li>
              Their login is turned off and they disappear from every list.
            </li>
            <li>Their past calls, bills and invoices are kept.</li>
          </ul>
        </div>

        <RemovalFields
          idPrefix="remove-employee"
          value={removal}
          onChange={setRemoval}
        />

        <div className="flex flex-col gap-2">
          <Label htmlFor="remove-employee-confirm-name">
            Type <span className="font-semibold">{employee.full_name}</span> to
            confirm
          </Label>
          <Input
            id="remove-employee-confirm-name"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoComplete="off"
            aria-invalid={confirmName.length > 0 && !nameMatches}
            required
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="sm:mr-auto"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" />
            Choose someone else
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={!ready || removeEmployee.isPending}
          >
            {removeEmployee.isPending ? "Removing…" : "Remove employee"}
          </Button>
        </DialogFooter>
      </form>

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
