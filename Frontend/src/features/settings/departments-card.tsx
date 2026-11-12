"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/data/section-card";
import { ErrorBanner } from "@/components/data/error-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/client";
import { useDepartments, useUpdateDepartment } from "@/lib/api/hooks";
import type { Department } from "@/lib/api/types";

const TITLE = "Departments";
const DESCRIPTION =
  "Rename a department, and choose which one is the customer service desk — its people raise tickets for the other departments. Only one department can be the desk.";

/** Admin: department names, and the customer service desk switch. */
export function DepartmentsCard() {
  const { data, isLoading, error, refetch } = useDepartments();

  return (
    <SectionCard
      title={TITLE}
      description={DESCRIPTION}
      bodyClassName="px-0 pb-0"
    >
      {isLoading ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error || !data ? (
        <div className="p-4">
          <ErrorBanner error={error} onRetry={() => refetch()} />
        </div>
      ) : (
        <ul className="divide-border-subtle border-border-subtle divide-y border-t">
          {data.data.map((department) => (
            // Keyed on the saved name so a save resets the row's draft.
            <DepartmentRow
              key={`${department.id}:${department.name}`}
              department={department}
            />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function DepartmentRow({ department }: { department: Department }) {
  const update = useUpdateDepartment();
  const [name, setName] = useState(department.name);
  const dirty = name.trim() !== department.name && name.trim().length > 0;
  const nameId = `department-name-${department.id}`;
  const deskId = `department-desk-${department.id}`;

  async function save(body: Parameters<typeof update.mutateAsync>[0]["body"]) {
    try {
      await update.mutateAsync({ id: department.id, body });
      toast.success("Department updated.");
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Couldn't update the department.",
      );
    }
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <form
        className="flex flex-1 items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void save({ name: name.trim() });
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor={nameId} className="text-muted-foreground text-xs">
            Name
            {department.cost_centre_code
              ? ` · ${department.cost_centre_code}`
              : ""}
          </Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoComplete="off"
          />
        </div>
        {dirty ? (
          <Button type="submit" size="sm" disabled={update.isPending}>
            Rename
          </Button>
        ) : null}
      </form>
      <div className="flex items-center gap-2.5">
        <Switch
          id={deskId}
          checked={department.handles_customer_service}
          onCheckedChange={(checked) =>
            void save({ handles_customer_service: checked })
          }
        />
        <Label htmlFor={deskId} className="text-sm font-normal">
          Customer service desk
        </Label>
      </div>
    </li>
  );
}
