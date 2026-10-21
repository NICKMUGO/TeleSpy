"use client";

import { useState, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import {
  useCreateTicket,
  useDepartments,
  useTicketCategories,
} from "@/lib/api/hooks";

const EMPTY = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  bookingReference: "",
  categoryId: "",
  /** "" = the category's own department. */
  departmentId: "",
  subject: "",
  description: "",
};

/** Raising a ticket: who the customer is, what it's about (which decides
 * the department it goes to), and what they need. */
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
        {/* Remounted per open, so every ticket starts from a blank form. */}
        {open ? <NewTicketForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function NewTicketForm({ onDone }: { onDone: () => void }) {
  const categories = useTicketCategories();
  const departments = useDepartments();
  const createTicket = useCreateTicket();
  const [form, setForm] = useState(EMPTY);
  const [fieldError, setFieldError] = useState<{
    field: string;
    message: string;
  } | null>(null);

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const category = categories.data?.data.find((c) => c.id === form.categoryId);
  const routedTo =
    departments.data?.data.find(
      (d) => d.id === (form.departmentId || category?.department_id),
    )?.name ?? category?.department_name;
  const reachable =
    form.customerPhone.trim().length > 0 ||
    form.customerEmail.trim().length > 0;
  const ready =
    form.customerName.trim() &&
    reachable &&
    form.categoryId &&
    form.subject.trim() &&
    form.description.trim();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setFieldError(null);
    try {
      const result = await createTicket.mutateAsync({
        customer_name: form.customerName.trim(),
        customer_phone: form.customerPhone.trim() || undefined,
        customer_email: form.customerEmail.trim() || undefined,
        booking_reference: form.bookingReference.trim() || undefined,
        category_id: form.categoryId,
        department_id: form.departmentId || undefined,
        subject: form.subject.trim(),
        description: form.description.trim(),
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
          their queue, and you&apos;re emailed when it&apos;s resolved or sent
          back.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Customer</legend>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ticket-customer-name">Name</Label>
            <Input
              id="ticket-customer-name"
              value={form.customerName}
              onChange={(e) => set("customerName")(e.target.value)}
              autoComplete="off"
              required
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
            A phone number or an email, so the team can reach them.
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
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    categoryId: e.target.value,
                    departmentId: "",
                  }))
                }
                required
              >
                <option value="" disabled>
                  {categories.isLoading ? "Loading…" : "Choose a category"}
                </option>
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
                value={form.departmentId || category?.department_id || ""}
                onChange={(e) =>
                  set("departmentId")(
                    e.target.value === category?.department_id
                      ? ""
                      : e.target.value,
                  )
                }
                disabled={!category}
                aria-describedby="ticket-department-note"
              >
                {category ? null : <option value="">—</option>}
                {departments.data?.data.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </SelectNative>
            </div>
          </div>
          <p
            id="ticket-department-note"
            className="text-muted-foreground -mt-1 text-xs"
          >
            {routedTo
              ? `Goes to ${routedTo}'s queue${form.departmentId ? " (changed from the usual department)" : ""}.`
              : "The category decides which department handles it; you can change it."}
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
              What does the customer need?
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
