// One person, one line: an employee holds at most one SIM — so one
// extension and one company number — and a SIM has at most one holder.
// Lines are fixed (seeded from the CSV, with the odd spare). Moving onto a
// free spare releases the mover's old line; giving away a line someone
// holds needs a choice about them — swap lines (a change of position) or
// remove them (they left; needs a reason and the Admin's step-up). The API
// enforces all of this (AllocationService, plus database indexes); these
// helpers let the UI explain it and any refusal clearly.
import type { ErrorDialogContent } from "@/components/feedback/error-dialog";
import { ApiError } from "@/lib/api/client";
import type { Employee, SimCard } from "@/lib/api/types";

const LINE_ERROR_TITLES: Record<string, string> = {
  employee_already_has_line: "This employee already has a line",
  sim_already_held: "This SIM is already taken",
  sim_not_active: "This SIM can't be given out",
  employee_removed: "This employee has been removed",
  displaced_holder_required: "Choose what happens to the current holder",
  swap_needs_a_line: "There's no line to swap",
  removal_reason_required: "Say why they're leaving",
  cannot_remove_self: "You can't remove yourself",
};

const STEP_UP_ERROR_TITLES: Record<string, string> = {
  step_up_password_invalid: "Wrong password",
  step_up_code_invalid: "That code didn't work",
};

/** Whether the employee already answers on a line — a SIM, or at least an
 * extension code — and so can't be given anyone else's. */
export function hasLine(employee: Employee): boolean {
  return Boolean(employee.sim_id || employee.extension_code);
}

/** "extension 236 · 0703083236", for whatever parts are known. */
export function describeLine(
  extension: string | null | undefined,
  msisdn: string | null | undefined,
): string {
  return (
    [extension ? `extension ${extension}` : null, msisdn]
      .filter(Boolean)
      .join(" · ") || "their line"
  );
}

/** The SIM an employee holds right now, if any. */
export function lineHeldBy(
  employeeId: string | null | undefined,
  sims: SimCard[],
): SimCard | null {
  if (!employeeId) return null;
  return sims.find((sim) => sim.employee_id === employeeId) ?? null;
}

/** Popup content for a failed step-up (wrong password or code) — the
 * form stays open so the Admin can try again — or null. */
export function stepUpError(error: unknown): ErrorDialogContent | null {
  if (!(error instanceof ApiError)) return null;
  const title = STEP_UP_ERROR_TITLES[error.errorType];
  if (!title) return null;
  return { title, message: error.message, hint: error.hint };
}

/** Popup content for an API refusal that breaks the one-line rule, or
 * null for any other error (which stays a toast). */
export function lineRuleError(error: unknown): ErrorDialogContent | null {
  if (!(error instanceof ApiError)) return null;
  const title = LINE_ERROR_TITLES[error.errorType];
  if (!title) return null;
  return { title, message: error.message, hint: error.hint };
}
