"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/data/section-card";
import { ErrorBanner } from "@/components/data/error-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  useDepartments,
  useRoles,
  useUpdateDepartment,
  useUpdateRole,
} from "@/lib/api/hooks";

const TITLE = "Spending limits";
const DESCRIPTION =
  "Monthly ceilings on call costs after the contract discount: per person by role, and per department. The line's fixed charge is not counted against either.";

/** The monthly call-cost ceilings: one per role (what each Employee or
 * Manager may spend before they are invoiced for the excess) and one per
 * department (the line on the Forecasts chart). Each row saves on its own. */
export function SpendingLimitsCard() {
  const roles = useRoles();
  const departments = useDepartments();
  const updateRole = useUpdateRole();
  const updateDepartment = useUpdateDepartment();

  const error = roles.error ?? departments.error;
  if (error) {
    return (
      <SectionCard title={TITLE} description={DESCRIPTION}>
        <ErrorBanner
          error={error}
          onRetry={() => {
            roles.refetch();
            departments.refetch();
          }}
        />
      </SectionCard>
    );
  }
  if (roles.isLoading || departments.isLoading) {
    return (
      <SectionCard title={TITLE} description={DESCRIPTION}>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </SectionCard>
    );
  }

  // Admin has no personal ceiling, so only the other roles are listed.
  const limitedRoles = (roles.data?.data ?? []).filter(
    (role) => role.role_name !== "Admin",
  );

  return (
    <SectionCard title={TITLE} description={DESCRIPTION}>
      <h3 className="mb-3 text-sm font-medium">Per person, by role</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {limitedRoles.map((role) => (
          <LimitField
            key={`${role.id}-${role.call_limit_kshs}`}
            id={`role-limit-${role.id}`}
            label={`${role.role_name} limit (KES/month)`}
            initial={role.call_limit_kshs}
            onSave={(value) =>
              updateRole.mutateAsync({
                id: role.id,
                body: { call_limit_kshs: value },
              })
            }
            savedMessage={`${role.role_name} limit updated.`}
          />
        ))}
      </div>

      <h3 className="mt-6 mb-3 text-sm font-medium">Per department</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {(departments.data?.data ?? []).map((dept) => (
          <LimitField
            key={`${dept.id}-${dept.budget_ceiling}`}
            id={`dept-budget-${dept.id}`}
            label={`${dept.name} budget (KES/month)`}
            initial={dept.budget_ceiling}
            onSave={(value) =>
              updateDepartment.mutateAsync({
                id: dept.id,
                body: { budget_ceiling: value },
              })
            }
            savedMessage={`${dept.name} budget updated.`}
          />
        ))}
      </div>
    </SectionCard>
  );
}

/** One KES amount with its own Save button. */
function LimitField({
  id,
  label,
  initial,
  onSave,
  savedMessage,
}: {
  id: string;
  label: string;
  initial: number | null;
  onSave: (value: number) => Promise<unknown>;
  savedMessage: string;
}) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const [saving, setSaving] = useState(false);
  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
  const dirty = valid && parsed !== initial;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave(parsed);
      toast.success(savedMessage);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Couldn't save the limit.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          step="1"
          min="1"
          inputMode="decimal"
          className="max-w-40"
          aria-invalid={value.trim() !== "" && !valid}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
