"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CircleCheckBig,
  CircleX,
  CornerUpLeft,
  Forward,
  Hand,
  MoveRight,
  Send,
  Undo2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ErrorBanner } from "@/components/data/error-banner";
import { SectionCard } from "@/components/data/section-card";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
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
import { useTicketLive } from "@/features/tickets/use-ticket-live";
import { ApiError } from "@/lib/api/client";
import { ticketsApi } from "@/lib/api/resources";
import {
  useAddTicketNote,
  useClaimTicket,
  useDepartments,
  useForwardTicket,
  useRecallForward,
  useRejectTicket,
  useReleaseTicket,
  useResendTicket,
  useResolveTicket,
  useReturnForward,
  useTicket,
  useTicketAccess,
  useTicketAssignees,
  useTicketCategories,
  useTransferTicket,
} from "@/lib/api/hooks";
import {
  REJECT_REASON_LABELS,
  type Ticket,
  type TicketEvent,
  type TicketForward,
  type TicketRead,
  type TicketRejectReason,
} from "@/lib/api/types";
import { useSession } from "@/lib/auth/session-store";
import { dateTime, duration } from "@/lib/format";
import { cn } from "@/lib/utils";

const EVENT_LABELS: Record<TicketEvent["kind"], string> = {
  raised: "raised the ticket",
  assigned: "assigned the ticket",
  claimed: "took the ticket",
  note: "added a note",
  returned: "rejected it",
  released: "handed it back to the team",
  resent: "sent it again",
  resolved: "resolved it",
  transferred: "transferred it",
  forwarded: "forwarded it",
  forward_returned: "sent it back",
  forward_recalled: "recalled it",
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const ticket = useTicket(id);
  const access = useTicketAccess();
  const user = useSession((s) => s.user);
  const live = useTicketLive(id);

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
  // The team queue, or (forwarded here) where "Forwarded to you" lists it.
  const sentToMe = t.forwards.some(
    (f) =>
      f.to_user_id === user?.id ||
      (!!me.department_id && f.to_department_id === me.department_id),
  );
  const backToTeam = (onTeam || sentToMe) && !isRaiser;
  const deskLabel = me.on_desk || me.is_admin ? "Ticket desk" : "My tickets";
  // Forwarded here for something to be done: to me, to my whole
  // department, or (as its Manager) to anyone in my department.
  const forMe = t.forwards.filter(
    (f) =>
      f.status === "pending" &&
      (f.to_user_id === user?.id ||
        (!!me.department_id &&
          f.to_department_id === me.department_id &&
          (f.to_user_id === null || user?.role === "Manager"))),
  );

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

            {forMe.map((f) => (
              <SendBackForm key={f.id} ticket={t} forward={f} />
            ))}

            <TicketActions
              ticket={t}
              onTeam={onTeam}
              canClose={canClose}
              canResend={canResend}
              isRaiser={isRaiser}
            />

            <Conversation
              ticketId={t.id}
              messages={(t.events ?? []).filter((e) => e.kind === "note")}
              reads={t.reads ?? []}
              myId={user?.id}
              live={live}
            />

            <SectionCard title="History" bodyClassName="px-0 pb-0">
              <ol className="divide-border-subtle border-border-subtle divide-y border-t">
                {(t.events ?? [])
                  .filter((e) => e.kind !== "note")
                  .map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-col gap-1 px-4 py-3"
                    >
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
              {t.forwards
                .filter((f) => f.status === "pending")
                .map((f) => (
                  <Detail key={f.id} label="Forwarded to">
                    {forwardTarget(f)}
                    <span className="text-muted-foreground block text-xs">
                      Since {dateTime(f.created_at)}
                    </span>
                  </Detail>
                ))}
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

/** The next step for whoever is looking: take it, resolve, reject or hand
 * it back (handling team), or fix and resend it (the desk, once rejected).
 * Missing details aren't a reason to reject — they're asked in the chat. */
function TicketActions({
  ticket,
  onTeam,
  canClose,
  canResend,
  isRaiser,
}: {
  ticket: Ticket;
  onTeam: boolean;
  canClose: boolean;
  canResend: boolean;
  isRaiser: boolean;
}) {
  const claim = useClaimTicket();
  const release = useReleaseTicket();
  const [mode, setMode] = useState<
    "resolve" | "return" | "transfer" | "forward" | null
  >(null);

  if (ticket.status === "returned" && canResend) {
    return <ResendForm ticket={ticket} />;
  }
  if (!onTeam || ticket.status === "resolved" || ticket.status === "returned") {
    return null;
  }

  const open = ticket.status === "open";
  const canAct = open || canClose;
  if (canAct && ticket.forwarded) {
    return <OutWithOthers ticket={ticket} />;
  }
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

  async function handBack() {
    try {
      await release.mutateAsync(ticket.id);
      toast.success(`${ticket.number} is back in the team's queue.`);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't hand the ticket back."));
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
                <CircleX aria-hidden="true" />
                Reject
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant={mode === "forward" ? "default" : "outline"}
            onClick={() => setMode(mode === "forward" ? null : "forward")}
            aria-expanded={mode === "forward"}
          >
            <Forward aria-hidden="true" />
            Forward
          </Button>
          <Button
            type="button"
            variant={mode === "transfer" ? "default" : "outline"}
            onClick={() => setMode(mode === "transfer" ? null : "transfer")}
            aria-expanded={mode === "transfer"}
          >
            <MoveRight aria-hidden="true" />
            Transfer
          </Button>
          {!open && canClose ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handBack()}
              disabled={release.isPending}
            >
              <Users aria-hidden="true" />
              {release.isPending ? "Handing back…" : "Hand back to team"}
            </Button>
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
        {mode === "forward" || mode === "transfer" ? (
          <PassForm
            key={mode}
            ticket={ticket}
            kind={mode}
            stillSees={isRaiser}
            onDone={() => setMode(null)}
          />
        ) : null}
      </div>
    </SectionCard>
  );
}

function forwardTarget(f: TicketForward) {
  return f.to_user_name
    ? `${f.to_user_name} (${f.to_department_name ?? "another team"})`
    : `Everyone in ${f.to_department_name ?? "another team"}`;
}

/** Forward: it goes to someone for something to be done and comes back to
 * you to resolve. Transfer: it's theirs from now on. */
function PassForm({
  ticket,
  kind,
  stillSees,
  onDone,
}: {
  ticket: Ticket;
  kind: "forward" | "transfer";
  /** The sender can still open it after a transfer (they raised it). */
  stillSees: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const departments = useDepartments();
  const forward = useForwardTicket();
  const transfer = useTransferTicket();
  const [departmentId, setDepartmentId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [note, setNote] = useState("");
  const assignees = useTicketAssignees(departmentId);
  const myId = useSession((s) => s.user?.id);
  const pending = forward.isPending || transfer.isPending;
  const isForward = kind === "forward";
  const ready = !!departmentId && (!isForward || !!note.trim());
  const department = departments.data?.data.find((d) => d.id === departmentId);
  const person = assignees.data?.data.find((p) => p.user_id === assigneeId);
  const to = person
    ? person.name
    : department
      ? `everyone in ${department.name}`
      : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const body = {
      department_id: departmentId,
      assigned_to_user_id: assigneeId || undefined,
      note: note.trim() || undefined,
    };
    try {
      if (isForward) {
        await forward.mutateAsync({ id: ticket.id, body });
        toast.success(`${ticket.number} forwarded to ${to}.`);
        onDone();
      } else {
        await transfer.mutateAsync({ id: ticket.id, body });
        toast.success(`${ticket.number} transferred to ${to}.`);
        // It's theirs now: unless it's still ours to follow, leave it.
        if (!stillSees) router.push("/tickets/team");
        else onDone();
      }
    } catch (error) {
      toast.error(
        errorMessage(
          error,
          isForward ? "Couldn't forward it." : "Couldn't transfer it.",
        ),
      );
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {isForward
          ? "Send it to someone for something you need done. They do it and send it back to you, and you resolve it."
          : "Hand it over for good: they own it from now on and resolve it."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`pass-${kind}-department`}>Department</Label>
          <SelectNative
            id={`pass-${kind}-department`}
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setAssigneeId("");
            }}
            required
          >
            <option value="" disabled>
              Choose a department
            </option>
            {departments.data?.data.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`pass-${kind}-person`}>Person</Label>
          <SelectNative
            id={`pass-${kind}-person`}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            disabled={!departmentId}
          >
            <option value="">
              {department ? `Everyone in ${department.name}` : "—"}
            </option>
            {assignees.data?.data
              .filter((p) => !isForward || p.user_id !== myId)
              .map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name}
                </option>
              ))}
          </SelectNative>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`pass-${kind}-note`}>
          {isForward ? "What do you need them to do?" : "Note (optional)"}
        </Label>
        <Textarea
          id={`pass-${kind}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={4000}
          required={isForward}
          placeholder={
            isForward
              ? "e.g. Please change the booking to KQ100 tomorrow and confirm the new e-ticket number."
              : "e.g. This is a refund, Finance handles it from here."
          }
        />
      </div>
      <Button
        type="submit"
        className="w-fit"
        disabled={!ready || pending}
        variant={isForward ? "default" : "outline"}
      >
        {isForward ? (
          <Forward aria-hidden="true" />
        ) : (
          <MoveRight aria-hidden="true" />
        )}
        {pending
          ? isForward
            ? "Forwarding…"
            : "Transferring…"
          : to
            ? `${isForward ? "Forward" : "Transfer"} to ${to}`
            : isForward
              ? "Forward"
              : "Transfer"}
      </Button>
    </form>
  );
}

/** For the handler while the ticket is out with someone: who has it, what
 * was asked, and a way to take it back. */
function OutWithOthers({ ticket }: { ticket: Ticket }) {
  const recall = useRecallForward();
  const out = ticket.forwards.filter((f) => f.status === "pending");

  async function takeBack(f: TicketForward) {
    try {
      await recall.mutateAsync({ id: ticket.id, forwardId: f.id });
      toast.success(`${ticket.number} is back with you.`);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't recall it."));
    }
  }

  return (
    <SectionCard
      title="Waiting for it to come back"
      description="You can resolve it once it's back with you."
    >
      <ul className="flex flex-col gap-3">
        {out.map((f) => (
          <li key={f.id} className="flex flex-col gap-2">
            <p className="text-sm">
              <span className="font-medium">With {forwardTarget(f)}</span>
              <span className="text-muted-foreground">
                {" "}
                · since {dateTime(f.created_at)}
              </span>
            </p>
            <p className="text-muted-foreground text-sm whitespace-pre-wrap">
              {f.message}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void takeBack(f)}
              disabled={recall.isPending}
            >
              <Undo2 aria-hidden="true" />
              Recall
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/** For whoever it was forwarded to: what's needed, and sending it back
 * once done. */
function SendBackForm({
  ticket,
  forward,
}: {
  ticket: Ticket;
  forward: TicketForward;
}) {
  const sendBack = useReturnForward();
  const [note, setNote] = useState("");
  const id = `send-back-${forward.id}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    try {
      await sendBack.mutateAsync({
        id: ticket.id,
        forwardId: forward.id,
        note: note.trim(),
      });
      toast.success(
        `${ticket.number} sent back to ${forward.from_name ?? "them"}.`,
      );
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't send it back."));
    }
  }

  return (
    <SectionCard
      title={`${forward.from_name ?? "Someone"} needs something from you`}
      className="border-info/50"
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Alert>
          <Forward aria-hidden="true" />
          <AlertTitle>
            Forwarded to {forwardTarget(forward)} ·{" "}
            {dateTime(forward.created_at)}
          </AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">
            {forward.message}
          </AlertDescription>
        </Alert>
        <Label htmlFor={id}>What did you do?</Label>
        <Textarea
          id={id}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={4000}
          required
          placeholder="e.g. Changed to KQ100 tomorrow 10:25, new e-ticket 706-1234567890."
        />
        <Button
          type="submit"
          className="w-fit"
          disabled={!note.trim() || sendBack.isPending}
        >
          <CornerUpLeft aria-hidden="true" />
          {sendBack.isPending
            ? "Sending back…"
            : `Send back to ${forward.from_name ?? "them"}`}
        </Button>
      </form>
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
  const reject = useRejectTicket();
  const [text, setText] = useState("");
  const [reasonCode, setReasonCode] = useState<TicketRejectReason | "">("");
  const pending = resolve.isPending || reject.isPending;
  const id = `ticket-${kind}-text`;
  const ready = kind === "resolve" ? !!text.trim() : !!reasonCode;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    try {
      if (kind === "resolve") {
        await resolve.mutateAsync({ id: ticket.id, note: text.trim() });
        toast.success(`${ticket.number} resolved. The desk has been told.`);
      } else {
        await reject.mutateAsync({
          id: ticket.id,
          reasonCode: reasonCode as TicketRejectReason,
          reason: text.trim() || undefined,
        });
        toast.success(`${ticket.number} rejected.`);
      }
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't save that."));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {kind === "return" ? (
        <>
          <Label htmlFor="ticket-reject-reason">Why reject it?</Label>
          <SelectNative
            id="ticket-reject-reason"
            value={reasonCode}
            onChange={(e) =>
              setReasonCode(e.target.value as TicketRejectReason | "")
            }
            required
          >
            <option value="">Choose a reason</option>
            {Object.entries(REJECT_REASON_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </SelectNative>
          <p className="text-muted-foreground text-xs">
            Need more details? Ask in the conversation below instead of
            rejecting.
          </p>
        </>
      ) : null}
      <Label htmlFor={id}>
        {kind === "resolve"
          ? "How was it resolved?"
          : "Anything to add? (optional — e.g. which department it belongs to)"}
      </Label>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={kind === "resolve" ? 4 : 2}
        maxLength={4000}
        required={kind === "resolve"}
        placeholder={
          kind === "resolve"
            ? "e.g. Rebooked on KQ100 tomorrow 10:25, seat 14C, no fare difference. Customer confirmed by phone."
            : undefined
        }
      />
      <Button
        type="submit"
        className="w-fit"
        disabled={!ready || pending}
        variant={kind === "return" ? "outline" : "default"}
      >
        {pending
          ? "Saving…"
          : kind === "resolve"
            ? "Resolve ticket"
            : "Reject ticket"}
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
              {lastReturn.actor_name ?? "The team"} rejected it
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

/** The ticket's conversation: messages between the desk and the handling
 * team, live — a message shows up for everyone viewing the ticket at once
 * (useTicketLive), with "… is typing". Enter sends; Shift+Enter is a new
 * line. Stored as the ticket's notes, so it's also kept with the ticket. */
function Conversation({
  ticketId,
  messages,
  reads,
  myId,
  live,
}: {
  ticketId: string;
  messages: TicketEvent[];
  reads: TicketRead[];
  myId: string | undefined;
  live: ReturnType<typeof useTicketLive>;
}) {
  const addNote = useAddTicketNote();
  const [body, setBody] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as they arrive.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  // Read ticks: tell the others I've read up to the newest message — when
  // it arrives while I'm looking, or when I come back to this tab.
  const newestId = messages.at(-1)?.id;
  useEffect(() => {
    if (!newestId || newestId.startsWith("pending-")) return;
    const markRead = () => {
      if (document.visibilityState !== "visible") return;
      void ticketsApi.markRead(ticketId).catch(() => undefined);
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [ticketId, newestId]);

  /** Who other than the sender has read up to this message. */
  function seenBy(message: TicketEvent) {
    return reads
      .filter(
        (r) =>
          r.user_id !== message.actor_user_id &&
          Date.parse(r.read_at) >= Date.parse(message.created_at),
      )
      .map((r) => r.name ?? "Someone");
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = body.trim();
    if (!text) return;
    // The message appears at once; it comes back into the box only if the
    // server refuses it.
    setBody("");
    try {
      await addNote.mutateAsync({ id: ticketId, body: text });
    } catch (error) {
      setBody(text);
      toast.error(errorMessage(error, "Couldn't send the message."));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <SectionCard
      title="Conversation"
      description="Messages between the desk and the team working this ticket."
      bodyClassName="px-0 pb-0"
      action={
        <div className="flex items-center gap-3">
          <ViewingNow viewers={live.viewers} />
          <span
            className="text-muted-foreground flex items-center gap-1.5 text-xs"
            title={
              live.connected
                ? "Your connection is live: new messages appear by themselves."
                : "Reconnecting — refresh to see new messages."
            }
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full",
                live.connected ? "bg-success" : "bg-muted-foreground/40",
              )}
            />
            {live.connected ? "Live updates on" : "Live updates off"}
          </span>
        </div>
      }
    >
      <div
        className="border-border-subtle flex max-h-[28rem] flex-col gap-3 overflow-y-auto border-t px-4 py-4"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        {messages.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No messages yet. Ask a question or give an update — everyone on this
            ticket sees it straight away.
          </p>
        ) : (
          messages.map((message) => {
            const mine = !!myId && message.actor_user_id === myId;
            const pending = message.id.startsWith("pending-");
            return (
              <div
                key={message.id}
                className={cn(
                  "flex max-w-[85%] flex-col gap-1",
                  mine ? "items-end self-end" : "items-start self-start",
                )}
              >
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  {mine ? "You" : (message.actor_name ?? "Someone")} ·{" "}
                  {pending ? "sending…" : dateTime(message.created_at)}
                  {mine && !pending ? (
                    <ReadTicks seenBy={seenBy(message)} />
                  ) : null}
                </span>
                <p
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap",
                    mine
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted rounded-bl-sm",
                    pending && "opacity-70",
                  )}
                >
                  {message.body}
                </p>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      <p className="text-muted-foreground h-5 px-4 text-xs" aria-live="polite">
        {live.typingName ? `${live.typingName} is typing…` : ""}
      </p>
      <form
        onSubmit={send}
        className="border-border-subtle flex items-end gap-2 border-t p-4"
      >
        <Label htmlFor="ticket-message" className="sr-only">
          Message
        </Label>
        <Textarea
          id="ticket-message"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (e.target.value.trim()) live.sendTyping();
          }}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={4000}
          placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
          className="min-h-11 flex-1"
        />
        <Button
          type="submit"
          size="lg"
          disabled={!body.trim()}
          aria-label="Send message"
        >
          <Send aria-hidden="true" />
        </Button>
      </form>
    </SectionCard>
  );
}

function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Who else has this ticket open in front of them right now. */
function ViewingNow({
  viewers,
}: {
  viewers: ReturnType<typeof useTicketLive>["viewers"];
}) {
  if (viewers.length === 0) return null;
  const names = viewers.map((v) => v.name);
  const label =
    names.length === 1
      ? `${names[0]} is viewing`
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are viewing`;
  const shown = viewers.slice(0, 3);
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <AvatarGroup>
        {shown.map((v) => (
          <Avatar key={v.user_id} size="sm">
            <AvatarFallback className="text-[0.625rem]">
              {initials(v.name)}
            </AvatarFallback>
          </Avatar>
        ))}
        {viewers.length > shown.length ? (
          <AvatarGroupCount className="text-[0.625rem]">
            +{viewers.length - shown.length}
          </AvatarGroupCount>
        ) : null}
      </AvatarGroup>
      <span className="text-muted-foreground sr-only text-xs sm:not-sr-only">
        {viewers.length === 1
          ? `${names[0]} viewing`
          : `${viewers.length} viewing`}
      </span>
    </div>
  );
}

/** WhatsApp-style ticks on my own message: one grey tick = sent, two blue
 * ticks = someone else on the ticket has read it. */
function ReadTicks({ seenBy }: { seenBy: string[] }) {
  if (seenBy.length === 0) {
    return (
      <span title="Sent" className="inline-flex">
        <Check aria-hidden="true" className="size-3.5" />
        <span className="sr-only">Sent</span>
      </span>
    );
  }
  const label = `Seen by ${seenBy.join(", ")}`;
  return (
    <span title={label} className="text-info inline-flex">
      <CheckCheck aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
