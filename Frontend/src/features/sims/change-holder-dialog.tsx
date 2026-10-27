"use client";

import { useMemo, useState } from "react";
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
  DialogHeader,
  DialogTitle,
  useClosingDialog,
} from "@/components/ui/dialog";
import { SimHolderDialog } from "@/features/sims/sim-holder-dialog";
import type { Employee, SimCard } from "@/lib/api/types";

/** Admin only: find a SIM by number, extension or holder, then change who
 * holds it (SimHolderDialog). One entry point in the page header instead of
 * a button on every row. */
export function ChangeHolderDialog({
  sims,
  employees,
  onClose,
}: {
  sims: SimCard[];
  employees: Employee[];
  onClose: () => void;
}) {
  const dialog = useClosingDialog(onClose);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sims.find((s) => s.id === selectedId) ?? null;

  // Held SIMs first, then free ones, each by extension.
  const sorted = useMemo(
    () =>
      [...sims].sort(
        (a, b) =>
          Number(!a.employee_id) - Number(!b.employee_id) ||
          (a.extension ?? "").localeCompare(b.extension ?? ""),
      ),
    [sims],
  );

  if (selected) {
    return (
      <SimHolderDialog
        key={selected.id}
        sim={selected}
        employees={employees}
        onClose={onClose}
      />
    );
  }

  return (
    <Dialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
      <DialogContent
        onExitComplete={dialog.onExitComplete}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Change holder</DialogTitle>
          <DialogDescription>
            Search for the SIM by number, extension or who holds it.
          </DialogDescription>
        </DialogHeader>
        <Command className="border-border h-auto rounded-lg! border">
          <CommandInput
            autoFocus
            placeholder="Number, extension or holder…"
            aria-label="Search SIMs by number, extension or holder"
          />
          <CommandList>
            <CommandEmpty>No SIM matches that.</CommandEmpty>
            {sorted.map((sim) => {
              const holder = sim.employee_id
                ? (sim.employee_name ?? "Name unavailable")
                : null;
              // A suspended or retired SIM can be taken back, but not
              // given to anyone.
              const locked =
                !sim.employee_id && sim.lifecycle_state !== "active";
              return (
                <CommandItem
                  key={sim.id}
                  // What the search matches on; the id keeps SIMs that
                  // share every other detail apart.
                  value={`${sim.msisdn ?? ""} ${sim.extension ?? ""} ${holder ?? "free"} ${sim.id}`}
                  disabled={locked}
                  onSelect={() => setSelectedId(sim.id)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-tabular truncate">
                      {sim.msisdn ?? sim.msisdn_masked ?? "No number"}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {holder ??
                        (locked
                          ? `Free · ${sim.lifecycle_state}`
                          : "Free — unallocated")}
                    </span>
                  </span>
                  <CommandShortcut className="font-tabular text-sm">
                    {sim.extension ? `ext. ${sim.extension}` : "No ext."}
                  </CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
