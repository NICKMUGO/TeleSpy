"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { ApiError } from "@/lib/api/client";
import { useRequestStepUpCode } from "@/lib/api/hooks";
import type { HandoverFields, RemovalReason } from "@/lib/api/types";

export const REMOVAL_REASONS: { value: RemovalReason; label: string }[] = [
  { value: "resigned", label: "Resigned" },
  { value: "terminated", label: "Terminated" },
  { value: "contract_ended", label: "Contract ended" },
  { value: "retired", label: "Retired" },
  { value: "other", label: "Other" },
];

/** What an Admin fills in to remove someone: why they left, plus the
 * step-up — their own password and a code emailed to them. */
export interface RemovalState {
  reason: RemovalReason | "";
  password: string;
  code: string;
}

export const EMPTY_REMOVAL: RemovalState = {
  reason: "",
  password: "",
  code: "",
};

export function removalComplete(removal: RemovalState): boolean {
  return (
    removal.reason !== "" &&
    removal.password.length > 0 &&
    removal.code.trim().length > 0
  );
}

/** The request fields for a handover with the chosen outcome. */
export function handoverFields(
  choice: "swap" | "remove" | null,
  removal: RemovalState,
): HandoverFields | undefined {
  if (choice === "swap") return { displaced_holder: "swap" };
  if (choice === "remove" && removal.reason) {
    return {
      displaced_holder: "remove",
      removal_reason: removal.reason,
      password: removal.password,
      code: removal.code.trim(),
    };
  }
  return undefined;
}

/** The step-up every sensitive Admin action takes: the Admin's own
 * password plus a one-time code emailed to them. */
export function StepUpFields({
  idPrefix,
  password,
  code,
  onChange,
  note,
}: {
  idPrefix: string;
  password: string;
  code: string;
  onChange: (value: { password: string; code: string }) => void;
  /** Why this needs confirming; replaced by "code sent" once it is. */
  note: string;
}) {
  const requestCode = useRequestStepUpCode();
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function sendCode() {
    try {
      const result = await requestCode.mutateAsync();
      setSentTo(result.message ?? "A code was sent to your email.");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't send a confirmation code.",
      );
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-password`}>Your password</Label>
        <Input
          id={`${idPrefix}-password`}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => onChange({ password: e.target.value, code })}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-code`}>Confirmation code</Label>
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-code`}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => onChange({ password, code: e.target.value })}
            aria-describedby={`${idPrefix}-code-note`}
            required
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void sendCode()}
            disabled={requestCode.isPending}
          >
            {requestCode.isPending
              ? "Sending…"
              : sentTo
                ? "Send again"
                : "Email me a code"}
          </Button>
        </div>
        <p
          id={`${idPrefix}-code-note`}
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          {sentTo ? (
            <>
              <MailCheck aria-hidden="true" className="size-3.5 shrink-0" />
              {sentTo}
            </>
          ) : (
            note
          )}
        </p>
      </div>
    </>
  );
}

/** Reason + step-up fields for removing someone who left. */
export function RemovalFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: RemovalState;
  onChange: (value: RemovalState) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-reason`}>Why are they leaving?</Label>
        <SelectNative
          id={`${idPrefix}-reason`}
          value={value.reason}
          onChange={(e) =>
            onChange({ ...value, reason: e.target.value as RemovalReason })
          }
          required
        >
          <option value="" disabled>
            Choose a reason
          </option>
          {REMOVAL_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </SelectNative>
      </div>

      <StepUpFields
        idPrefix={idPrefix}
        password={value.password}
        code={value.code}
        onChange={(stepUp) => onChange({ ...value, ...stepUp })}
        note="Removing someone stops their line being tracked against them, so it needs your password and a one-time code. The HR manager and Admins are emailed."
      />
    </div>
  );
}

/** Asks what happens to the person holding a line that's being given to
 * someone else: they swap lines (a change of position) or they left the
 * company and are removed. A new hire has no line to swap, so only removal
 * is offered then. */
export function DisplacedHolderChoice({
  idPrefix,
  holderName,
  moverName,
  moverLine,
  choice,
  onChoice,
  removal,
  onRemoval,
}: {
  idPrefix: string;
  holderName: string;
  moverName: string;
  /** The mover's current line, e.g. "extension 236", or null if none. */
  moverLine: string | null;
  choice: "swap" | "remove" | null;
  onChoice: (choice: "swap" | "remove") => void;
  removal: RemovalState;
  onRemoval: (value: RemovalState) => void;
}) {
  return (
    <fieldset className="border-border flex flex-col gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">
        What happens to {holderName}?
      </legend>
      <label className="flex items-start gap-2 text-sm has-disabled:opacity-50">
        <input
          type="radio"
          name={`${idPrefix}-displaced`}
          className="accent-primary mt-1"
          checked={choice === "swap"}
          disabled={!moverLine}
          onChange={() => onChoice("swap")}
        />
        <span>
          <span className="font-medium">Swap lines</span> — a change of
          position.{" "}
          <span className="text-muted-foreground">
            {moverLine
              ? `${holderName} takes ${moverName}'s ${moverLine}. Nobody is removed.`
              : `${moverName} has no line to swap.`}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name={`${idPrefix}-displaced`}
          className="accent-primary mt-1"
          checked={choice === "remove"}
          onChange={() => onChoice("remove")}
        />
        <span>
          <span className="font-medium">{holderName} left the company</span>{" "}
          <span className="text-muted-foreground">
            — they&apos;re removed: login off, gone from every list, past calls
            and bills kept.
            {moverLine ? ` ${moverName}'s ${moverLine} goes to the pool.` : ""}
          </span>
        </span>
      </label>
      {choice === "remove" ? (
        <RemovalFields
          idPrefix={idPrefix}
          value={removal}
          onChange={onRemoval}
        />
      ) : null}
    </fieldset>
  );
}
