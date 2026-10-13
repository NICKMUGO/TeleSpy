"use client";

import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { ApiError } from "@/lib/api/client";
import type { Employee, SimCard } from "@/lib/api/types";
import { useAllocateSim, useUnassignSim } from "@/lib/api/hooks";

const NOBODY = "";

/** Changes who holds a SIM — Admin only. The extension goes with the SIM,
 * so this is how a line is handed over when someone leaves: pick the
 * colleague taking it, or "Nobody" to put it back in the pool. */
export function SimHolderDialog({
  sim,
  employees,
  onClose,
}: {
  sim: SimCard;
  employees: Employee[];
  onClose: () => void;
}) {
  const allocate = useAllocateSim();
  const unassign = useUnassignSim();
  const pending = allocate.isPending || unassign.isPending;
  const [employeeId, setEmployeeId] = useState(sim.employee_id ?? NOBODY);

  const options = useMemo(
    () =>
      employees
        .filter((e) => e.is_active !== false || e.id === sim.employee_id)
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [employees, sim.employee_id],
  );
  const chosen = options.find((e) => e.id === employeeId);
  const line = sim.extension ? `extension ${sim.extension}` : "this SIM";
  const unchanged = employeeId === (sim.employee_id ?? NOBODY);

  let note = "";
  if (!unchanged) {
    if (!chosen) {
      note = `${sim.employee_name ?? "The current holder"} gives up ${line}; it stays free until it's given to someone.`;
    } else {
      note = sim.employee_id
        ? `${line.charAt(0).toUpperCase()}${line.slice(1)} moves from ${sim.employee_name ?? "the current holder"} to ${chosen.full_name}.`
        : `${chosen.full_name} gets ${line}.`;
      if (chosen.extension_code && chosen.extension_code !== sim.extension) {
        note += ` Their current extension ${chosen.extension_code} becomes free.`;
      }
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (unchanged) return;
    try {
      if (employeeId === NOBODY) {
        await unassign.mutateAsync(sim.id);
        toast.success("SIM unassigned.");
      } else {
        await allocate.mutateAsync({ simId: sim.id, employeeId });
        toast.success(`SIM given to ${chosen?.full_name ?? "the employee"}.`);
      }
      onClose();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't change who holds this SIM.",
      );
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {sim.employee_id ? "Change holder" : "Assign SIM"}
          </DialogTitle>
          <DialogDescription>
            {[
              sim.msisdn,
              sim.extension ? `extension ${sim.extension}` : null,
              sim.employee_id
                ? `held by ${sim.employee_name ?? "an employee"}`
                : "not allocated",
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
              onChange={(e) => setEmployeeId(e.target.value)}
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
              {note ||
                "The extension and company number stay with the SIM and go to whoever holds it."}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || unchanged}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
