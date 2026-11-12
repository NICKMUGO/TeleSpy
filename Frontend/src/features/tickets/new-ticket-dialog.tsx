"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { SelectNative } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITY_LABELS } from "@/features/tickets/ticket-status";
import { ApiError } from "@/lib/api/client";
import {
  useCreateTicket,
  useDepartments,
  useSlaTargets,
  useTicketAccess,
  useTicketAssignees,
  useTicketCategories,
} from "@/lib/api/hooks";
import type { TicketPriority } from "@/lib/api/types";
import { dateTime, duration } from "@/lib/format";

/** The "What is it about?" choice for a reason the raiser writes
 * themselves instead of a quick category. It's the default: most tickets
 * don't fit a quick category. */
const OTHER = "__other__";

const EMPTY = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  bookingReference: "",
  /** A quick category's id, or OTHER. */
  categoryId: OTHER,
  customReason: "",
  /** "" = the category's own department. */
  departmentId: "",
  /** "" = the whole department. */
  assigneeId: "",
  subject: "",
  description: "",
  priority: "medium" as TicketPriority,
  /** How long until it breaches the SLA: "" = the priority's target, a
   * number of hours from SLA_WINDOWS, or CUSTOM for a picked time. */
  window: "",
  /** A datetime-local value, used when window is CUSTOM. */
  dueAt: "",
};

/** The "Breaches SLA after" choice for picking an exact date and time. */
const CUSTOM = "custom";

/** How long the handling team has before the ticket breaches its SLA. */
const SLA_WINDOWS: { hours: number; label: string }[] = [
  { hours: 4, label: "4 hours · high / emergency" },
  { hours: 8, label: "8 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 48, label: "2 days" },
  { hours: 72, label: "3 days" },
  { hours: 24 * 7, label: "1 week" },
  { hours: 24 * 14, label: "2 weeks" },
  { hours: 24 * 30, label: "1 month" },
];

/** "2026-11-02T14:30" for a datetime-local input, in the browser's time. */
function localInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Raising a ticket: who the customer is (the desk always; anyone else only
 * if it's for a customer), what it's about (a quick category, which picks
 * the department, or their own reason), who gets it, what's needed, and
 * how urgent it is — the priority sets the SLA deadline, unless the raiser
 * gives it one of their own. */
export function NewTicketDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {/* The content unmounts once closed, so every ticket starts from a
         * blank form, while the form stays put for the closing animation. */}
        <NewTicketForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewTicketForm({ onDone }: { onDone: () => void }) {
  const categories = useTicketCategories();
  const departments = useDepartments();
  const onDesk = useTicketAccess().data?.data.on_desk ?? false;
  const slaTargets = useSlaTargets().data?.data;
  const createTicket = useCreateTicket();
  const [form, setForm] = useState(EMPTY);
  const [fieldError, setFieldError] = useState<{
    field: string;
    message: string;
  } | null>(null);

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const targetHours = (p: TicketPriority) =>
    slaTargets ? slaTargets[`${p}_hours`] : undefined;
  // The chosen window, or else the priority's own SLA target.
  const hours =
    form.window && form.window !== CUSTOM
      ? Number(form.window)
      : targetHours(form.priority);
  // Re-read on each render so the deadline shown keeps up.
  const now = new Date();
  const due =
    form.window === CUSTOM
      ? form.dueAt
        ? new Date(form.dueAt)
        : null
      : hours === undefined
        ? null
        : new Date(now.getTime() + hours * 3_600_000);

  const custom = form.categoryId === OTHER;
  const category = categories.data?.data.find((c) => c.id === form.categoryId);
  const departmentId = form.departmentId || category?.department_id || "";
  const assignees = useTicketAssignees(departmentId);
  const assignee = assignees.data?.data.find(
    (p) => p.user_id === form.assigneeId,
  );
  const routedTo =
    departments.data?.data.find((d) => d.id === departmentId)?.name ??
    category?.department_name;
  const reachable =
    form.customerPhone.trim().length > 0 ||
    form.customerEmail.trim().length > 0;
  // The desk's tickets are always for a customer; anyone else's only once
  // they start filling the customer in.
  const forCustomer =
    onDesk ||
    reachable ||
    form.customerName.trim().length > 0 ||
    form.bookingReference.trim().length > 0;
  const ready =
    (!forCustomer || (form.customerName.trim() && reachable)) &&
    (custom ? form.customReason.trim() && departmentId : category) &&
    form.subject.trim() &&
    form.description.trim() &&
    (form.window !== CUSTOM || form.dueAt);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setFieldError(null);
    try {
      const result = await createTicket.mutateAsync({
        customer_name: form.customerName.trim() || undefined,
        customer_phone: form.customerPhone.trim() || undefined,
        customer_email: form.customerEmail.trim() || undefined,
        booking_reference: form.bookingReference.trim() || undefined,
        category_id: custom ? undefined : form.categoryId,
        custom_reason: custom ? form.customReason.trim() : undefined,
        department_id: form.departmentId || undefined,
        assigned_to_user_id: form.assigneeId || undefined,
        subject: form.subject.trim(),
        description: form.description.trim(),
        priority: form.priority,
        sla_hours:
          form.window && form.window !== CUSTOM
            ? Number(form.window)
            : undefined,
        due_at:
          form.window === CUSTOM && form.dueAt
            ? new Date(form.dueAt).toISOString()
            : undefined,
      });
      toast.success(result.message ?? "Ticket raised.");
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.field) {
        setFieldError({ field: error.field, message: error.message });
      } else {
        toast.error(
          error instanceof ApiError
            ? error.message
            : "Couldn't raise the ticket.",
        );
      }
    }
  }

  const errorFor = (field: string) =>
    fieldError?.field === field ? (
      <p role="alert" className="text-destructive text-sm">
        {fieldError.message}
      </p>
    ) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>New ticket</DialogTitle>
        <DialogDescription>
          For an issue another department has to handle. It goes straight to
          their queue, or to the person you choose, and you&apos;re emailed when
          it&apos;s resolved or rejected.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">
            Customer
            {onDesk ? null : (
              <span className="text-muted-foreground font-normal">
                {" "}
                (only if it&apos;s for a customer)
              </span>
            )}
          </legend>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ticket-customer-name">Name</Label>
            <Input
              id="ticket-customer-name"
              value={form.customerName}
              onChange={(e) => set("customerName")(e.target.value)}
              autoComplete="off"
              required={forCustomer}
            />
            {errorFor("customer_name")}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ticket-customer-phone">Phone</Label>
              <Input
                id="ticket-customer-phone"
                type="tel"
                value={form.customerPhone}
                onChange={(e) => set("customerPhone")(e.target.value)}
                autoComplete="off"
              />
              {errorFor("customer_phone")}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ticket-customer-email">Email</Label>
              <Input
                id="ticket-customer-email"
                type="email"
                value={form.customerEmail}
                onChange={(e) => set("customerEmail")(e.target.value)}
                autoComplete="off"
              />
              {errorFor("customer_email")}
            </div>
          </div>
          <p className="text-muted-foreground -mt-1 text-xs">
            {forCustomer
              ? "A phone number or an email, so the team can reach them."
              : "Leave these empty for an internal ticket."}
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ticket-booking-reference">
              Booking reference{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="ticket-booking-reference"
              value={form.bookingReference}
              onChange={(e) =>
                set("bookingReference")(e.target.value.toUpperCase())
              }
              maxLength={16}
              autoComplete="off"
              className="font-tabular uppercase sm:w-48"
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Issue</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ticket-category">What is it about?</Label>
              <SelectNative
                id="ticket-category"
                value={form.categoryId}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((f) => ({
                    ...f,
                    categoryId: value,
                    departmentId: "",
                    assigneeId: "",
                  }));
                  // Picking "Other" goes straight to describing it.
                  if (value === OTHER)
                    requestAnimationFrame(() =>
                      document.getElementById("ticket-custom-reason")?.focus(),
                    );
                }}
                required
              >
                <option value={OTHER}>Other (describe it)</option>
                {categories.data?.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectNative>
              {errorFor("category_id")}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ticket-department">Send to</Label>
              <SelectNative
                id="ticket-department"
                value={departmentId}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    departmentId:
                      e.target.value === category?.department_id
                        ? ""
                        : e.target.value,
                    assigneeId: "",
                  }))
                }
                disabled={!category && !custom}
                required={custom}
                aria-describedby="ticket-department-note"
              >
                {departmentId ? null : (
                  <option value="" disabled={custom}>
                    {custom ? "Choose a department" : "—"}
                  </option>
                )}
                {departments.data?.data.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </SelectNative>
              {errorFor("department_id")}
            </div>
          </div>
          {custom ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="ticket-custom-reason">Short description</Label>
              <Input
                id="ticket-custom-reason"
                value={form.customReason}
                onChange={(e) => set("customReason")(e.target.value)}
                maxLength={80}
                placeholder="e.g. Office printer not working"
                required
              />
              {errorFor("custom_reason")}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            {/* The search box is labelled through cmdk, which owns its id. */}
            <Label asChild>
              <span>Assign to</span>
            </Label>
            <AssigneePicker
              departmentName={routedTo ?? undefined}
              people={assignees.data?.data}
              isLoading={assignees.isLoading}
              value={form.assigneeId}
              onChange={set("assigneeId")}
            />
            {errorFor("assigned_to_user_id")}
          </div>
          <p
            id="ticket-department-note"
            className="text-muted-foreground -mt-1 text-xs"
          >
            {!routedTo
              ? custom
                ? "Choose the department that should handle it."
                : "The category decides which department handles it; you can change it."
              : assignee
                ? `Goes straight to ${assignee.name} in ${routedTo}.`
                : `Goes to ${routedTo}'s queue, where anyone there can take it${form.departmentId && !custom ? " (changed from the usual department)" : ""}.`}
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ticket-subject">Subject</Label>
            <Input
              id="ticket-subject"
              value={form.subject}
              onChange={(e) => set("subject")(e.target.value)}
              maxLength={160}
              placeholder="e.g. Rebook NBO–LHR after missed connection"
              required
            />
            {errorFor("subject")}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ticket-description">
              {forCustomer ? "What does the customer need?" : "What's needed?"}
            </Label>
            <Textarea
              id="ticket-description"
              value={form.description}
              onChange={(e) => set("description")(e.target.value)}
              rows={5}
              maxLength={4000}
              required
            />
            {errorFor("description")}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">
            Priority and deadline
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ticket-priority">Priority</Label>
              <SelectNative
                id="ticket-priority"
                value={form.priority}
                onChange={(e) => set("priority")(e.target.value)}
              >
                {(Object.keys(PRIORITY_LABELS) as TicketPriority[]).map((p) => {
                  const h = targetHours(p);
                  return (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                      {h === undefined ? "" : ` · within ${duration(h * 60)}`}
                    </option>
                  );
                })}
              </SelectNative>
              {errorFor("priority")}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ticket-window">Breaches SLA after</Label>
              <SelectNative
                id="ticket-window"
                value={form.window}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((f) => ({ ...f, window: value }));
                  if (value === CUSTOM)
                    requestAnimationFrame(() =>
                      document.getElementById("ticket-due")?.focus(),
                    );
                }}
                aria-describedby="ticket-due-note"
              >
                <option value="">
                  {PRIORITY_LABELS[form.priority]} priority target
                  {targetHours(form.priority) === undefined
                    ? ""
                    : ` · ${duration(targetHours(form.priority)! * 60)}`}
                </option>
                {SLA_WINDOWS.map((w) => (
                  <option key={w.hours} value={String(w.hours)}>
                    {w.label}
                  </option>
                ))}
                <option value={CUSTOM}>Pick a date and time…</option>
              </SelectNative>
              {errorFor("sla_hours")}
            </div>
          </div>
          {form.window === CUSTOM ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="ticket-due">Resolve by</Label>
              <Input
                id="ticket-due"
                type="datetime-local"
                value={form.dueAt}
                min={localInputValue(now)}
                max={localInputValue(new Date(now.getTime() + 30 * 86_400_000))}
                onChange={(e) => set("dueAt")(e.target.value)}
                aria-describedby="ticket-due-note"
                required
                className="sm:w-64"
              />
              {errorFor("due_at")}
            </div>
          ) : null}
          <p
            id="ticket-due-note"
            className="text-muted-foreground -mt-1 text-xs"
          >
            {due
              ? `Must be resolved by ${dateTime(due.toISOString())}; after that it breaches the SLA.`
              : form.window === CUSTOM
                ? "Pick when it must be resolved by (up to 30 days)."
                : "The priority sets how long they have to resolve it."}
          </p>
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || createTicket.isPending}>
            {createTicket.isPending ? "Sending…" : "Raise ticket"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** Who gets the ticket: the department's whole queue, or one person found
 * by typing their name — no scrolling a long dropdown. */
function AssigneePicker({
  departmentName,
  people,
  isLoading,
  value,
  onChange,
}: {
  departmentName: string | undefined;
  people: { user_id: string; name: string }[] | undefined;
  isLoading: boolean;
  value: string;
  onChange: (userId: string) => void;
}) {
  if (!departmentName) {
    return (
      <p className="border-input text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-sm">
        Choose where it&apos;s going first.
      </p>
    );
  }
  return (
    <Command
      label="Assign to"
      className="border-border h-auto rounded-lg! border"
    >
      <CommandInput
        placeholder="Type a name…"
        aria-describedby="ticket-department-note"
      />
      <CommandList className="max-h-44">
        <CommandEmpty>
          {isLoading ? "Loading…" : `No one in ${departmentName} by that name.`}
        </CommandEmpty>
        <CommandItem
          value={`everyone ${departmentName}`}
          data-checked={value === ""}
          onSelect={() => onChange("")}
        >
          Everyone in {departmentName}
        </CommandItem>
        {people?.map((p) => (
          <CommandItem
            key={p.user_id}
            // The id keeps two people with the same name apart.
            value={`${p.name} ${p.user_id}`}
            data-checked={value === p.user_id}
            onSelect={() => onChange(p.user_id)}
          >
            {p.name}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
