"use client";

import { useMemo, useState, type FormEvent } from "react";
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
  useClosingDialog,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import {
  DisplacedHolderChoice,
  EMPTY_REMOVAL,
  handoverFields,
  removalComplete,
  type RemovalState,
} from "@/features/employees/handover-fields";
import { ApiError } from "@/lib/api/client";
import {
  describeLine,
  hasLine,
  lineRuleError,
  stepUpError,
} from "@/lib/api/line-rules";
import type { Employee, SimCard } from "@/lib/api/types";
import { useAllocateSim, useUnassignSim } from "@/lib/api/hooks";

const NOBODY = "";

/** Changes who holds a SIM — Admin only. The extension goes with the SIM.
 * A free spare moves whoever takes it onto it, and their old line goes to
 * the pool (confirmed first). A held SIM asks what happens to its holder:
 * they swap lines with the new person (a change of position), or they
 * left the company and are removed — with a reason and the Admin's
 * step-up. "Nobody" puts the line back in the pool. */
export function SimHolderDialog({
  sim,
  employees,
  onClose,
}: {
  sim: SimCard;
  employees: Employee[];
  onClose: () => void;
}) {
  const dialog = useClosingDialog(onClose);
  const close = dialog.close;
  const allocate = useAllocateSim();
  const unassign = useUnassignSim();
  const pending = allocate.isPending || unassign.isPending;
  const [employeeId, setEmployeeId] = useState(sim.employee_id ?? NOBODY);
  const [choice, setChoice] = useState<"swap" | "remove" | null>(null);
  const [removal, setRemoval] = useState<RemovalState>(EMPTY_REMOVAL);
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [ruleError, setRuleError] = useState<ErrorDialogContent | null>(null);
  const [retryError, setRetryError] = useState<ErrorDialogContent | null>(null);

  const held = Boolean(sim.employee_id);
  const holderName = sim.employee_name ?? "The current holder";
  const line = describeLine(sim.extension, sim.msisdn);

  const options = useMemo(
    () =>
      employees
        .filter((e) => e.is_active !== false || e.id === sim.employee_id)
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [employees, sim.employee_id],
  );
  const chosen = options.find((e) => e.id === employeeId);
  const unchanged = employeeId === (sim.employee_id ?? NOBODY);
  const moverLine =
    chosen && hasLine(chosen)
      ? describeLine(chosen.extension ?? chosen.extension_code, chosen.msisdn)
      : null;
  const needsChoice = held && Boolean(chosen) && !unchanged;
  const ready =
    !unchanged &&
    (!needsChoice ||
      choice === "swap" ||
      (choice === "remove" && removalComplete(removal)));

  function pick(id: string) {
    setEmployeeId(id);
    // A swap only makes sense with someone who has a line.
    const next = employees.find((e) => e.id === id);
    if (choice === "swap" && !(next && hasLine(next))) setChoice(null);
  }

  let note = held
    ? "Give it to a new hire replacing someone who left, or swap it with a colleague changing position."
    : "A free spare: whoever takes it gives up any line they have now.";
  if (!unchanged) {
    if (!chosen) {
      note = `${holderName} gives up ${line}; it stays free until it's given to someone. Any calls on it are reported to HR and the Admins.`;
    } else if (!held) {
      note = moverLine
        ? `${chosen.full_name} moves to ${line}; their ${moverLine} goes back to the pool.`
        : `${chosen.full_name} gets ${line}.`;
    } else {
      note = `${chosen.full_name} takes over ${line}.`;
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    if (!held && moverLine) {
      setConfirmingRelease(true);
      return;
    }
    void save();
  }

  async function save() {
    setConfirmingRelease(false);
    try {
      if (employeeId === NOBODY) {
        await unassign.mutateAsync(sim.id);
        toast.success("SIM unassigned.");
      } else {
        await allocate.mutateAsync({
          simId: sim.id,
          employeeId,
          handover: needsChoice ? handoverFields(choice, removal) : undefined,
        });
        toast.success(
          !needsChoice
            ? `SIM given to ${chosen?.full_name ?? "the employee"}.`
            : choice === "swap"
              ? `${chosen?.full_name} and ${holderName} swapped lines.`
              : `${chosen?.full_name} now holds ${line}; ${holderName} was removed and HR was emailed.`,
        );
      }
      close();
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
          : "Couldn't change who holds this SIM.",
      );
    }
  }

  return (
    <Dialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
      <DialogContent
        onExitComplete={dialog.onExitComplete}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{held ? "Change holder" : "Assign SIM"}</DialogTitle>
          <DialogDescription>
            {[
              sim.msisdn,
              sim.extension ? `extension ${sim.extension}` : null,
              held ? `held by ${sim.employee_name ?? "an employee"}` : "free",
            ]
              .filter(Boolean)
              .join(" · ")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="sim-holder">Held by</Label>
            <SelectNative
              id="sim-holder"
              value={employeeId}
              onChange={(e) => pick(e.target.value)}
              aria-describedby="sim-holder-note"
            >
              <option value={NOBODY}>Nobody — unallocated</option>
              {options.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                  {e.extension_code ? ` (ext. ${e.extension_code})` : ""}
                </option>
              ))}
            </SelectNative>
            <p id="sim-holder-note" className="text-muted-foreground text-xs">
              {note}
            </p>
          </div>

          {needsChoice && chosen ? (
            <DisplacedHolderChoice
              idPrefix="sim-holder"
              holderName={holderName}
              moverName={chosen.full_name}
              moverLine={moverLine}
              choice={choice}
              onChoice={setChoice}
              removal={removal}
              onRemoval={setRemoval}
            />
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={
                needsChoice && choice === "remove" ? "destructive" : "default"
              }
              disabled={pending || !ready}
            >
              {pending
                ? "Saving…"
                : needsChoice && choice === "remove"
                  ? `Remove ${holderName} and save`
                  : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <Dialog open={confirmingRelease} onOpenChange={setConfirmingRelease}>
        <DialogContent role="alertdialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {chosen?.full_name ?? "This employee"} already has a line
            </DialogTitle>
            <DialogDescription>
              A person can hold only one extension and company number. Moving
              them to {line} releases their {moverLine}, which goes back to the
              pool.
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
          close();
        }}
      />
    </Dialog>
  );
}
