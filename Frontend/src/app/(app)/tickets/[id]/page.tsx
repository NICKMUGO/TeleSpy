"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CircleCheckBig,
  Hand,
  MessageSquare,
  Send,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { ErrorBanner } from "@/components/data/error-banner";
import { SectionCard } from "@/components/data/section-card";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  PRIORITY_LABELS,
  PriorityBadge,
  SlaBadge,
  slaSummary,
  TicketStatusBadge,
} from "@/features/tickets/ticket-status";
import { ApiError } from "@/lib/api/client";
import {
  useAddTicketNote,
  useClaimTicket,
  useDepartments,
  useResendTicket,
  useResolveTicket,
  useReturnTicket,
  useTicket,
  useTicketAccess,
  useTicketCategories,
} from "@/lib/api/hooks";
import type { Ticket, TicketEvent } from "@/lib/api/types";
import { useSession } from "@/lib/auth/session-store";
import { dateTime, duration } from "@/lib/format";

const EVENT_LABELS: Record<TicketEvent["kind"], string> = {
  raised: "raised the ticket",
  assigned: "assigned the ticket",
  claimed: "took the ticket",
  note: "added a note",
  returned: "sent it back to the desk",
  resent: "sent it again",
  resolved: "resolved it",
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const ticket = useTicket(id);
  const access = useTicketAccess();
  const user = useSession((s) => s.user);

  if (ticket.error) {
    return (
      <>
        <PageHeader title="Ticket" />
        <div className="p-4 sm:p-6">
          <ErrorBanner error={ticket.error} onRetry={() => ticket.refetch()} />
        </div>
      </>
    );
  }
  if (ticket.isLoading || !ticket.data || !access.data) {
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const t = ticket.data.data;
  const me = access.data.data;
  const onTeam = !!me.department_id && me.department_id === t.department_id;
  const canClose =
    onTeam && (t.claimed_by_id === user?.id || user?.role === "Manager");
  const isRaiser = t.raised_by_id === user?.id;
  const canResend = isRaiser || me.desk_manager || me.is_admin;
  const backToTeam = onTeam && !isRaiser;
  const deskLabel = me.on_desk || me.is_admin ? "Ticket desk" : "My tickets";

  return (
    <>
      <PageHeader
        title={t.subject}
        meta={`${t.number} · ${t.category_name} · raised by ${t.raised_by_name ?? "the desk"} ${dateTime(t.created_at)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={t.priority} />
            <SlaBadge ticket={t} />
            <TicketStatusBadge status={t.status} />
          </div>
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <Button asChild variant="ghost" size="sm" className="w-fit">
          <Link href={backToTeam ? "/tickets/team" : "/tickets"}>
            <ArrowLeft aria-hidden="true" />
            {backToTeam ? "Team tickets" : deskLabel}
          </Link>
        </Button>

        {t.status === "resolved" ? (
          <Alert variant={t.sla_status === "met" ? "success" : "warning"}>
            <CircleCheckBig aria-hidden="true" />
            <AlertTitle>
              Resolved by {t.resolved_by_name}
              {t.resolved_at ? ` · ${dateTime(t.resolved_at)}` : ""}
              {t.resolution_minutes !== null
                ? ` · took ${duration(t.resolution_minutes)}`
                : ""}
              {t.sla_status === "met" ? " · within SLA" : " · missed SLA"}
            </AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">
              {t.resolution_note}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <SectionCard
              title={
                t.customer_name ? "What the customer needs" : "What's needed"
              }
            >
              <p className="text-sm whitespace-pre-wrap">{t.description}</p>
            </SectionCard>

            <TicketActions
              ticket={t}
              onTeam={onTeam}
              canClose={canClose}
              canResend={canResend}
            />

            <SectionCard title="History" bodyClassName="px-0 pb-0">
              <ol className="divide-border-subtle border-border-subtle divide-y border-t">
                {(t.events ?? []).map((event) => (
                  <li key={event.id} className="flex flex-col gap-1 px-4 py-3">
                    <p className="text-sm">
                      <span className="font-medium">
                        {event.actor_name ?? "Someone"}
                      </span>{" "}
                      {EVENT_LABELS[event.kind]}
                      <span className="text-muted-foreground">
                        {" "}
                        · {dateTime(event.created_at)}
                      </span>
                    </p>
                    {event.body ? (
                      <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                        {event.body}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
              <NoteComposer ticketId={t.id} />
            </SectionCard>
          </div>

          <SectionCard title={t.customer_name ? "Customer" : "Details"}>
            <dl className="grid gap-3 text-sm">
              {t.customer_name ? (
                <Detail label="Name">{t.customer_name}</Detail>
              ) : (
                <Detail label="Customer">None (internal ticket)</Detail>
              )}
              {t.customer_phone ? (
                <Detail label="Phone">
                  <a
                    href={`tel:${t.customer_phone}`}
                    className="font-tabular underline-offset-2 hover:underline"
                  >
                    {t.customer_phone}
                  </a>
                </Detail>
              ) : null}
              {t.customer_email ? (
                <Detail label="Email">
                  <a
                    href={`mailto:${t.customer_email}`}
                    className="break-all underline-offset-2 hover:underline"
                  >
                    {t.customer_email}
                  </a>
                </Detail>
              ) : null}
              {t.booking_reference ? (
                <Detail label="Booking reference">
                  <span className="font-tabular">{t.booking_reference}</span>
                </Detail>
              ) : null}
              <Detail label="Priority">{PRIORITY_LABELS[t.priority]}</Detail>
              <Detail label="Resolve by (SLA)">
                {dateTime(t.due_at)}
                {t.status === "resolved" ? null : (
                  <span className="text-muted-foreground block text-xs">
                    {slaSummary(t)}
                  </span>
                )}
              </Detail>
              {t.resolution_minutes !== null ? (
                <Detail label="Time to resolve">
                  {duration(t.resolution_minutes)}
                </Detail>
              ) : null}
              <Detail label="Handled by">
                {t.department_name}
                {t.claimed_by_name ? ` · ${t.claimed_by_name}` : ""}
              </Detail>
              {t.return_count > 0 ? (
                <Detail label="Sent back">
                  {t.return_count === 1 ? "Once" : `${t.return_count} times`}
                </Detail>
              ) : null}
            </dl>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The next step for whoever is looking: take it, resolve or return it
 * (handling team), or fix and resend it (the desk, once returned). */
function TicketActions({
  ticket,
  onTeam,
  canClose,
  canResend,
}: {
  ticket: Ticket;
  onTeam: boolean;
  canClose: boolean;
  canResend: boolean;
}) {
  const claim = useClaimTicket();
  const [mode, setMode] = useState<"resolve" | "return" | null>(null);

  if (ticket.status === "returned" && canResend) {
    return <ResendForm ticket={ticket} />;
  }
  if (!onTeam || ticket.status === "resolved" || ticket.status === "returned") {
    return null;
  }

  const open = ticket.status === "open";
  const canAct = open || canClose;
  if (!canAct) {
    return (
      <p className="text-muted-foreground text-sm">
        {ticket.claimed_by_name} is working this ticket.
      </p>
    );
  }

  async function take() {
    try {
      await claim.mutateAsync(ticket.id);
      toast.success(`You've taken ${ticket.number}.`);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't take the ticket."));
    }
  }

  return (
    <SectionCard title={open ? "Take this ticket" : "Finish this ticket"}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {open ? (
            <Button
              type="button"
              onClick={() => void take()}
              disabled={claim.isPending}
            >
              <Hand aria-hidden="true" />
              {claim.isPending ? "Taking…" : "Take it"}
            </Button>
          ) : null}
          {canClose || open ? (
            <>
              <Button
                type="button"
                variant={mode === "resolve" ? "default" : "outline"}
                onClick={() => setMode(mode === "resolve" ? null : "resolve")}
                aria-expanded={mode === "resolve"}
              >
                <CircleCheckBig aria-hidden="true" />
                Resolve
              </Button>
              <Button
                type="button"
                variant={mode === "return" ? "default" : "outline"}
                onClick={() => setMode(mode === "return" ? null : "return")}
                aria-expanded={mode === "return"}
              >
                <Undo2 aria-hidden="true" />
                Send back to the desk
              </Button>
            </>
          ) : null}
        </div>
        {mode === "resolve" ? (
          <CloseForm
            ticket={ticket}
            kind="resolve"
            onDone={() => setMode(null)}
          />
        ) : null}
        {mode === "return" ? (
          <CloseForm
            ticket={ticket}
            kind="return"
            onDone={() => setMode(null)}
          />
        ) : null}
      </div>
    </SectionCard>
  );
}

function CloseForm({
  ticket,
  kind,
  onDone,
}: {
  ticket: Ticket;
  kind: "resolve" | "return";
  onDone: () => void;
}) {
  const resolve = useResolveTicket();
  const giveBack = useReturnTicket();
  const [text, setText] = useState("");
  const pending = resolve.isPending || giveBack.isPending;
  const id = `ticket-${kind}-text`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    try {
      if (kind === "resolve") {
        await resolve.mutateAsync({ id: ticket.id, note: text.trim() });
        toast.success(`${ticket.number} resolved. The desk has been told.`);
      } else {
        await giveBack.mutateAsync({ id: ticket.id, reason: text.trim() });
        toast.success(`${ticket.number} sent back to the desk.`);
      }
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't save that."));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {kind === "resolve"
          ? "How was it resolved?"
          : "Why is it going back? (wrong department, or what's missing)"}
      </Label>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={4000}
        required
        placeholder={
          kind === "resolve"
            ? "e.g. Rebooked on KQ100 tomorrow 10:25, seat 14C, no fare difference. Customer confirmed by phone."
            : undefined
        }
      />
      <Button
        type="submit"
        className="w-fit"
        disabled={!text.trim() || pending}
        variant={kind === "return" ? "outline" : "default"}
      >
        {pending
          ? "Saving…"
          : kind === "resolve"
            ? "Resolve ticket"
            : "Send back"}
      </Button>
    </form>
  );
}

/** The resend form's "What is it about?" choice for a reason of its own. */
const RESEND_OTHER = "__other__";

function ResendForm({ ticket }: { ticket: Ticket }) {
  const resend = useResendTicket();
  const categories = useTicketCategories();
  const departments = useDepartments();
  const [categoryId, setCategoryId] = useState(
    ticket.category_id ?? RESEND_OTHER,
  );
  const [customReason, setCustomReason] = useState(ticket.custom_reason ?? "");
  const custom = categoryId === RESEND_OTHER;
  const [departmentId, setDepartmentId] = useState(ticket.department_id);
  const [note, setNote] = useState("");
  const lastReturn = [...(ticket.events ?? [])]
    .reverse()
    .find((e) => e.kind === "returned");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (custom && !customReason.trim()) return;
    try {
      await resend.mutateAsync({
        id: ticket.id,
        body: {
          category_id: custom ? undefined : categoryId,
          custom_reason: custom ? customReason.trim() : undefined,
          department_id: departmentId,
          note: note.trim() || undefined,
        },
      });
      toast.success(`${ticket.number} sent again.`);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't send it again."));
    }
  }

  return (
    <SectionCard title="Fix and send again" className="border-warning/50">
      <form onSubmit={submit} className="flex flex-col gap-3">
        {lastReturn ? (
          <Alert>
            <Undo2 aria-hidden="true" />
            <AlertTitle>
              {lastReturn.actor_name ?? "The team"} sent it back
            </AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">
              {lastReturn.body}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="resend-category">What is it about?</Label>
            <SelectNative
              id="resend-category"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                const routed = categories.data?.data.find(
                  (c) => c.id === e.target.value,
                )?.department_id;
                if (routed) setDepartmentId(routed);
              }}
            >
              <option value={RESEND_OTHER}>Other (describe it)</option>
              {categories.data?.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectNative>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="resend-department">Send to</Label>
            <SelectNative
              id="resend-department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              {departments.data?.data.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectNative>
          </div>
        </div>
        {custom ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="resend-custom-reason">Short description</Label>
            <Input
              id="resend-custom-reason"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              maxLength={80}
              required
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="resend-note">What changed?</Label>
          <Textarea
            id="resend-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="e.g. Added the booking reference and the customer's new travel date."
          />
        </div>
        <Button
          type="submit"
          className="w-fit"
          disabled={resend.isPending || (custom && !customReason.trim())}
        >
          <Send aria-hidden="true" />
          {resend.isPending ? "Sending…" : "Send again"}
        </Button>
      </form>
    </SectionCard>
  );
}

function NoteComposer({ ticketId }: { ticketId: string }) {
  const addNote = useAddTicketNote();
  const [body, setBody] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const note = body.trim();
    if (!note) return;
    // The note appears on the ticket at once; it comes back into the box
    // only if the server refuses it.
    setBody("");
    try {
      await addNote.mutateAsync({ id: ticketId, body: note });
    } catch (error) {
      setBody(note);
      toast.error(errorMessage(error, "Couldn't add the note."));
    }
  }

  return (
    <form
      onSubmit={submit}
      className="border-border-subtle flex flex-col gap-2 border-t p-4"
    >
      <Label htmlFor="ticket-note" className="sr-only">
        Add a note
      </Label>
      <Textarea
        id="ticket-note"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="Add a note for everyone on this ticket…"
      />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={!body.trim()}
      >
        <MessageSquare aria-hidden="true" />
        Add note
      </Button>
    </form>
  );
}
