"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/data/section-card";
import { ErrorBanner } from "@/components/data/error-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/client";
import {
  useCreateTicketCategory,
  useDepartments,
  useTicketCategories,
  useUpdateTicketCategory,
} from "@/lib/api/hooks";
import type { Department, TicketCategory } from "@/lib/api/types";

const TITLE = "Ticket categories";
const DESCRIPTION =
  "What the desk can raise a ticket about, and which department each one goes to. Changing a department only affects new tickets.";

function failed(err: unknown, fallback: string) {
  toast.error(err instanceof ApiError ? err.message : fallback);
}

/** Admin: the categories the customer service desk picks from. */
export function TicketCategoriesCard() {
  const categories = useTicketCategories(true);
  const departments = useDepartments();
  const error = categories.error ?? departments.error;

  return (
    <SectionCard
      title={TITLE}
      description={DESCRIPTION}
      bodyClassName="px-0 pb-0"
    >
      {categories.isLoading || departments.isLoading ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error || !categories.data || !departments.data ? (
        <div className="p-4">
          <ErrorBanner
            error={error}
            onRetry={() => {
              void categories.refetch();
              void departments.refetch();
            }}
          />
        </div>
      ) : (
        <>
          <ul className="divide-border-subtle border-border-subtle divide-y border-t">
            {categories.data.data.map((category) => (
              <CategoryRow
                key={`${category.id}:${category.name}`}
                category={category}
                departments={departments.data.data}
              />
            ))}
          </ul>
          <NewCategoryForm departments={departments.data.data} />
        </>
      )}
    </SectionCard>
  );
}

function CategoryRow({
  category,
  departments,
}: {
  category: TicketCategory;
  departments: Department[];
}) {
  const update = useUpdateTicketCategory();
  const [name, setName] = useState(category.name);
  const dirty = name.trim() !== category.name && name.trim().length > 0;
  const prefix = `category-${category.id}`;

  async function save(body: Parameters<typeof update.mutateAsync>[0]["body"]) {
    try {
      await update.mutateAsync({ id: category.id, body });
      toast.success("Category updated.");
    } catch (err) {
      failed(err, "Couldn't update the category.");
    }
  }

  return (
    <li className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void save({ name: name.trim() });
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label
            htmlFor={`${prefix}-name`}
            className="text-muted-foreground text-xs"
          >
            Category
          </Label>
          <Input
            id={`${prefix}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoComplete="off"
          />
        </div>
        {dirty ? (
          <Button type="submit" size="sm" disabled={update.isPending}>
            Rename
          </Button>
        ) : null}
      </form>
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor={`${prefix}-department`}
          className="text-muted-foreground text-xs"
        >
          Goes to
        </Label>
        <SelectNative
          id={`${prefix}-department`}
          value={category.department_id}
          disabled={update.isPending}
          onChange={(e) => void save({ department_id: e.target.value })}
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectNative>
      </div>
      <div className="flex h-9 items-center gap-2.5">
        <Switch
          id={`${prefix}-active`}
          checked={category.is_active}
          onCheckedChange={(checked) => void save({ is_active: checked })}
        />
        <Label htmlFor={`${prefix}-active`} className="text-sm font-normal">
          In use
        </Label>
      </div>
    </li>
  );
}

function NewCategoryForm({ departments }: { departments: Department[] }) {
  const create = useCreateTicketCategory();
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !departmentId) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        department_id: departmentId,
      });
      toast.success(`Added ${name.trim()}.`);
      setName("");
      setDepartmentId("");
    } catch (err) {
      failed(err, "Couldn't add the category.");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="border-border-subtle grid gap-3 border-t px-4 py-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
    >
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="category-new-name"
          className="text-muted-foreground text-xs"
        >
          New category
        </Label>
        <Input
          id="category-new-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="e.g. Special assistance"
          autoComplete="off"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="category-new-department"
          className="text-muted-foreground text-xs"
        >
          Goes to
        </Label>
        <SelectNative
          id="category-new-department"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
        >
          <option value="" disabled>
            Choose a department
          </option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectNative>
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={!name.trim() || !departmentId || create.isPending}
      >
        <Plus aria-hidden="true" />
        Add
      </Button>
    </form>
  );
}
