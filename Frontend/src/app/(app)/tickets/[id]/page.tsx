"use client";

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  Check,
  CheckCheck,
  CircleCheckBig,
  CircleX,
  CornerUpLeft,
  Forward,
  Hand,
  Lock,
  MoveRight,
  Camera,
  Paperclip,
  RotateCcw,
  Send,
  Undo2,
  Users,
  X,
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
import { SearchSelect } from "@/components/ui/search-select";
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
import { AttachmentPhoto, isPhoto } from "@/features/tickets/attachment-photo";
import { CameraDialog, canUseCamera } from "@/features/tickets/camera-capture";
import { useTicketLive } from "@/features/tickets/use-ticket-live";
import { SLA_WINDOWS } from "@/features/tickets/new-ticket-dialog";
import { ApiError } from "@/lib/api/client";
import { ticketsApi } from "@/lib/api/resources";
import {
  useAddTicketNote,
  useClaimTicket,
  useCloseTicket,
  useDepartments,
  useForwardTicket,
  useRecallForward,
  useRejectTicket,
  useReleaseTicket,
  useReopenTicket,
  useResendTicket,
  useResolveTicket,
  useReturnForward,
  useTicket,
  useTicketAccess,
  useTicketAssignees,
  useTicketCategories,
  useTransferTicket,
  useUploadAttachment,
  useWithdrawTicket,
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
  withdrawn: "withdrew it",
  reopened: "reopened it",
  closed: "closed it",
  escalated: "escalated it to the Manager",
  forward_overdue: "flagged an overdue reply",
  attachment: "attached a file",
};

/** In the conversation: messages and files. Everything else is history. */
const inChat = (e: TicketEvent) => e.kind === "note" || e.kind === "attachment";

/** What the 📎 button accepts (the API's TicketFiles.Extensions). */
const ATTACH_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,.heic,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt";
const MAX_FILES = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** A file waiting above the message box; `url` previews a photo. */
interface Staged {
  key: string;
  file: File;
  url: string | null;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** How long after it's resolved the raiser can reopen it (the API's
 * TicketsController.ReopenDays). */
const REOPEN_DAYS = 14;

/** How long whoever a ticket is forwarded to has to send it back. */
const REPLY_WINDOWS: { hours: number; label: string }[] = [
  { hours: 1, label: "1 hour" },
  { hours: 2, label: "2 hours" },
  { hours: 4, label: "4 hours" },
  { hours: 8, label: "8 hours" },
  { hours: 24, label: "1 day" },
  { hours: 48, label: "2 days" },
  { hours: 72, label: "3 days" },
];

const isActive = (t: Ticket) =>
  t.status === "open" || t.status === "in_progress";

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

        {t.status === "withdrawn" || t.status === "closed" ? (
          <Alert>
            <Archive aria-hidden="true" />
            <AlertTitle>
              {t.status === "withdrawn" ? "Withdrawn" : "Closed by an Admin"}
              {t.closed_by_name ? ` · ${t.closed_by_name}` : ""}
              {t.closed_at ? ` · ${dateTime(t.closed_at)}` : ""}
            </AlertTitle>
            {t.close_note ? (
              <AlertDescription className="whitespace-pre-wrap">
                {t.close_note}
              </AlertDescription>
            ) : null}
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

            {canResend ? <RaiserActions ticket={t} /> : null}

            <TicketActions
              ticket={t}
              onTeam={onTeam}
              canClose={canClose}
              isRaiser={isRaiser}
            />

            {me.is_admin ? <AdminClose ticket={t} /> : null}

            <Conversation
              ticketId={t.id}
              messages={(t.events ?? []).filter(inChat)}
              reads={t.reads ?? []}
              myId={user?.id}
              live={live}
              closedReason={
                t.status === "resolved"
                  ? canResend
                    ? "This ticket is resolved, so its messages and files were deleted. Reopen it above if it isn't fixed; it starts a new conversation."
                    : "This ticket is resolved, so its messages and files were deleted."
                  : t.status === "withdrawn"
                    ? "This ticket was withdrawn, so its messages and files were deleted."
                    : t.status === "closed"
                      ? "An Admin closed this ticket, so its messages and files were deleted."
                      : null
              }
            />

            <SectionCard title="History" bodyClassName="px-0 pb-0">
              <ol className="divide-border-subtle border-border-subtle divide-y border-t">
                {(t.events ?? [])
                  .filter((e) => !inChat(e))
                  .map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-col gap-1 px-4 py-3"
                    >
                      <p className="text-sm">
                        <span className="font-medium">
                          {event.actor_name ??
                            (event.actor_user_id ? "Someone" : "TeleSpy")}
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
                {!isActive(t) && t.status !== "returned" ? null : (
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
              {t.escalated_at && isActive(t) ? (
                <Detail label="Escalated">
                  <span className="text-destructive">Manager alerted</span>
                  <span className="text-muted-foreground block text-xs">
                    {dateTime(t.escalated_at)}
                  </span>
                </Detail>
              ) : null}
              {t.reopen_count > 0 ? (
                <Detail label="Reopened">
                  {t.reopen_count === 1 ? "Once" : `${t.reopen_count} times`}
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
                    {f.due_at ? (
                      <span
                        className={cn(
                          "block text-xs",
                          f.overdue
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {f.overdue ? "Overdue · was due" : "Due back"}{" "}
                        {dateTime(f.due_at)}
                      </span>
                    ) : null}
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
  isRaiser,
}: {
  ticket: Ticket;
  onTeam: boolean;
  canClose: boolean;
  isRaiser: boolean;
}) {
  const claim = useClaimTicket();
  const release = useReleaseTicket();
  const [mode, setMode] = useState<
    "resolve" | "return" | "transfer" | "forward" | null
  >(null);

  if (!onTeam || !isActive(ticket)) {
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
  const [replyHours, setReplyHours] = useState("");
  const assignees = useTicketAssignees(departmentId);
  const myId = useSession((s) => s.user?.id);
  const pending = forward.isPending || transfer.isPending;
  const isForward = kind === "forward";
  const ready =
    !!departmentId && (!isForward || (!!note.trim() && !!replyHours));
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
      reply_hours: isForward ? Number(replyHours) : undefined,
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
          <SearchSelect
            id={`pass-${kind}-person`}
            value={assigneeId}
            onChange={setAssigneeId}
            disabled={!departmentId}
            isLoading={assignees.isLoading}
            placeholder="—"
            emptyText={`No one in ${department?.name ?? "that department"} by that name.`}
            options={[
              {
                value: "",
                label: department ? `Everyone in ${department.name}` : "—",
              },
              ...(assignees.data?.data ?? [])
                .filter((p) => !isForward || p.user_id !== myId)
                .map((p) => ({ value: p.user_id, label: p.name })),
            ]}
          />
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
      {isForward ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="pass-forward-reply">Send back within</Label>
          <SelectNative
            id="pass-forward-reply"
            value={replyHours}
            onChange={(e) => setReplyHours(e.target.value)}
            required
            className="sm:w-48"
            aria-describedby="pass-forward-reply-note"
          >
            <option value="" disabled>
              Choose a time
            </option>
            {REPLY_WINDOWS.map((w) => (
              <option key={w.hours} value={String(w.hours)}>
                {w.label}
              </option>
            ))}
          </SelectNative>
          <p
            id="pass-forward-reply-note"
            className="text-muted-foreground text-xs"
          >
            Your SLA clock stops while it&apos;s with them. If they miss this,
            you and their Manager are told.
          </p>
        </div>
      ) : null}
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
              {f.due_at ? (
                <span
                  className={cn(
                    "block text-xs",
                    f.overdue ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {f.overdue
                    ? `Overdue: was due back ${dateTime(f.due_at)}. Their Manager has been told.`
                    : `Due back ${dateTime(f.due_at)}`}
                </span>
              ) : null}
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
      description={
        forward.overdue
          ? "This is overdue. Send it back as soon as you can."
          : undefined
      }
      className={forward.overdue ? "border-destructive/50" : "border-info/50"}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Alert>
          <Forward aria-hidden="true" />
          <AlertTitle>
            Forwarded to {forwardTarget(forward)} ·{" "}
            {dateTime(forward.created_at)}
            {forward.due_at
              ? ` · send back by ${dateTime(forward.due_at)}`
              : ""}
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
      <div className="border-border-subtle mt-4 border-t pt-4">
        <WithdrawForm ticket={ticket} />
      </div>
    </SectionCard>
  );
}

/** What the raiser (or the desk Manager, or an Admin) can do once a ticket
 * is back with them: fix and resend a rejected one (or withdraw it),
 * withdraw one nobody has taken yet, or reopen a resolved one. */
function RaiserActions({ ticket }: { ticket: Ticket }) {
  // When the page opened is close enough for a 14-day window.
  const [now] = useState(() => Date.now());
  if (ticket.status === "returned") return <ResendForm ticket={ticket} />;
  if (ticket.status === "open") {
    return (
      <SectionCard
        title="No longer needed?"
        description="Nobody has taken it yet, so you can still withdraw it."
      >
        <WithdrawForm ticket={ticket} />
      </SectionCard>
    );
  }
  if (
    ticket.status === "resolved" &&
    ticket.resolved_at &&
    now - new Date(ticket.resolved_at).getTime() < REOPEN_DAYS * 86_400_000
  ) {
    return <ReopenForm ticket={ticket} />;
  }
  return null;
}

function WithdrawForm({ ticket }: { ticket: Ticket }) {
  const withdraw = useWithdrawTicket();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await withdraw.mutateAsync({
        id: ticket.id,
        note: note.trim() || undefined,
      });
      toast.success(`${ticket.number} withdrawn.`);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't withdraw it."));
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={() => setOpen(true)}
      >
        <Archive aria-hidden="true" />
        Withdraw ticket
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor="withdraw-note">Why? (optional)</Label>
      <Textarea
        id="withdraw-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="e.g. The customer sorted it out at the airport."
      />
      <p className="text-muted-foreground text-xs">
        A withdrawn ticket is closed for good. Raise a new one if it&apos;s
        needed again.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="destructive"
          disabled={withdraw.isPending}
        >
          <Archive aria-hidden="true" />
          {withdraw.isPending ? "Withdrawing…" : "Withdraw it"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** It wasn't actually fixed: back to the department's queue, with a reason
 * and a new deadline the raiser sets. */
function ReopenForm({ ticket }: { ticket: Ticket }) {
  const reopen = useReopenTicket();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("");
  const ready = !!reason.trim() && !!hours;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    try {
      await reopen.mutateAsync({
        id: ticket.id,
        body: { reason: reason.trim(), sla_hours: Number(hours) },
      });
      toast.success(
        `${ticket.number} reopened and sent back to ${ticket.department_name ?? "the team"}.`,
      );
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't reopen it."));
    }
  }

  return (
    <SectionCard
      title="Not actually fixed?"
      description={`You can reopen it for up to ${REOPEN_DAYS} days after it was resolved. It goes back to ${ticket.department_name ?? "the team"}'s queue.`}
    >
      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="reopen-reason">What&apos;s still wrong?</Label>
            <Textarea
              id="reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={4000}
              required
              placeholder="e.g. The refund still hasn't reached the customer's card."
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reopen-window">New deadline</Label>
            <SelectNative
              id="reopen-window"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
              className="sm:w-56"
            >
              <option value="" disabled>
                Choose a deadline…
              </option>
              {SLA_WINDOWS.map((w) => (
                <option key={w.hours} value={String(w.hours)}>
                  {w.label}
                </option>
              ))}
            </SelectNative>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!ready || reopen.isPending}>
              <RotateCcw aria-hidden="true" />
              {reopen.isPending ? "Reopening…" : "Reopen ticket"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => setOpen(true)}
        >
          <RotateCcw aria-hidden="true" />
          Reopen ticket
        </Button>
      )}
    </SectionCard>
  );
}

/** Admin: close a ticket that's still going, for good. */
function AdminClose({ ticket }: { ticket: Ticket }) {
  const close = useCloseTicket();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!isActive(ticket) && ticket.status !== "returned") return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    try {
      await close.mutateAsync({ id: ticket.id, note: note.trim() });
      toast.success(`${ticket.number} closed.`);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't close it."));
    }
  }

  return (
    <SectionCard
      title="Admin"
      description="Close it for good: a duplicate nobody rejected, raised in error, or gone stale. The raiser is emailed."
    >
      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Label htmlFor="admin-close-note">Why close it?</Label>
          <Textarea
            id="admin-close-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={4000}
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="destructive"
              disabled={!note.trim() || close.isPending}
            >
              <Lock aria-hidden="true" />
              {close.isPending ? "Closing…" : "Close ticket"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => setOpen(true)}
        >
          <Lock aria-hidden="true" />
          Close ticket
        </Button>
      )}
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
  closedReason,
}: {
  ticketId: string;
  messages: TicketEvent[];
  reads: TicketRead[];
  myId: string | undefined;
  live: ReturnType<typeof useTicketLive>;
  /** Set once the ticket is finished: no more messages, just this. */
  closedReason: string | null;
}) {
  const addNote = useAddTicketNote();
  const upload = useUploadAttachment();
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [body, setBody] = useState("");
  // Files picked or photos taken, waiting above the box until Send.
  const [staged, setStaged] = useState<Staged[]>([]);
  const [sending, setSending] = useState(false);
  const sentCount = messages.filter((m) => m.kind === "attachment").length;
  const fileCount = sentCount + staged.length;

  // Free the previews if the page closes with files still waiting.
  const stagedRef = useRef(staged);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);
  useEffect(
    () => () =>
      stagedRef.current.forEach((s) => s.url && URL.revokeObjectURL(s.url)),
    [],
  );

  /** Puts files above the box, saying why any can't go. */
  function stage(files: File[]) {
    let room = MAX_FILES - fileCount;
    const added: Staged[] = [];
    for (const file of files) {
      if (room <= 0) {
        toast.error(`This ticket can only have ${MAX_FILES} files`, {
          description: `${file.name} wasn't added: that's the most a ticket can hold. Describe the rest in a message instead.`,
        });
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is too large`, {
          description: `It's ${fileSize(file.size)}; the limit is 20 MB per file. Compress it or send a smaller one.`,
        });
        continue;
      }
      room -= 1;
      added.push({
        key: `${Date.now()}-${Math.random()}`,
        file,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      });
    }
    if (added.length) setStaged((current) => [...current, ...added]);
  }

  /** A screenshot (or a copied file) pasted into the message box is
   * attached, the same as choosing it with the paperclip. Pasted text is
   * left to paste as normal. */
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    if (refuseWhenFull()) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    stage(
      files.map((file, i) =>
        // Screenshots arrive named just "image.png"; give each its own name.
        /^image\.\w+$/.test(file.name)
          ? new File(
              [file],
              `screenshot-${stamp}${files.length > 1 ? `-${i + 1}` : ""}.${file.name.split(".").pop()}`,
              { type: file.type },
            )
          : file,
      ),
    );
  }

  function unstage(key: string) {
    setStaged((current) => {
      const gone = current.find((s) => s.key === key);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return current.filter((s) => s.key !== key);
    });
  }

  /** Says why, and returns true, when the ticket can't take more files. */
  function refuseWhenFull() {
    if (fileCount < MAX_FILES) return false;
    toast.error(`This ticket already has ${MAX_FILES} files`, {
      description:
        "That's the most a ticket can hold, so no more can be attached. Describe the rest in a message instead.",
    });
    return true;
  }

  function openCamera() {
    if (refuseWhenFull()) return;
    // The camera inside the page where the browser allows it; otherwise the
    // phone's own camera app.
    if (canUseCamera()) setCameraOpen(true);
    else photoInput.current?.click();
  }

  /** A file in the chat: name and size; tap to download. */
  function fileBubble(message: TicketEvent, mine: boolean) {
    return (
      <button
        type="button"
        onClick={() => void download(message)}
        className={cn(
          "flex max-w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          mine
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted rounded-bl-sm",
        )}
        title={`Download ${message.attachment!.file_name}`}
      >
        <Paperclip aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0">
          <span className="block truncate font-medium underline-offset-2 hover:underline">
            {message.attachment!.file_name}
          </span>
          <span className="block text-xs opacity-80">
            {fileSize(message.attachment!.size_bytes)}
          </span>
        </span>
      </button>
    );
  }

  async function download(message: TicketEvent) {
    if (!message.attachment) return;
    try {
      await ticketsApi.downloadAttachment(ticketId, message.attachment);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't download the file."));
    }
  }
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
    if ((!text && staged.length === 0) || sending) return;
    setSending(true);
    try {
      // Files first, in order, then the words under them. A file the
      // server refuses stays above the box (with the message) to retry.
      for (const item of staged) {
        try {
          await upload.mutateAsync({ id: ticketId, file: item.file });
          unstage(item.key);
        } catch (error) {
          toast.error(errorMessage(error, `Couldn't send ${item.file.name}.`));
          return;
        }
      }
      if (!text) return;
      // The message appears at once; it comes back into the box only if
      // the server refuses it.
      setBody("");
      try {
        await addNote.mutateAsync({ id: ticketId, body: text });
      } catch (error) {
        setBody(text);
        toast.error(errorMessage(error, "Couldn't send the message."));
      }
    } finally {
      setSending(false);
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
      {closedReason && messages.length === 0 ? null : (
        <div
          className="border-border-subtle flex max-h-[28rem] flex-col gap-3 overflow-y-auto border-t px-4 py-4"
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {messages.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No messages yet. Ask a question or give an update — everyone on
              this ticket sees it straight away.
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
                  {message.kind === "attachment" &&
                  message.attachment &&
                  isPhoto(message.attachment) ? (
                    <AttachmentPhoto
                      ticketId={ticketId}
                      attachment={message.attachment}
                      mine={mine}
                      onDownload={() => void download(message)}
                      fallback={fileBubble(message, mine)}
                    />
                  ) : message.kind === "attachment" && message.attachment ? (
                    fileBubble(message, mine)
                  ) : (
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
                  )}
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>
      )}
      {closedReason ? (
        <p className="border-border-subtle text-muted-foreground flex items-center gap-2 border-t p-4 text-sm">
          <Lock aria-hidden="true" className="size-4 shrink-0" />
          {closedReason}
        </p>
      ) : (
        <>
          <p
            className="text-muted-foreground h-5 px-4 text-xs"
            aria-live="polite"
          >
            {live.typingName ? `${live.typingName} is typing…` : ""}
          </p>
          {staged.length > 0 ? (
            <ul
              className="border-border-subtle flex gap-2 overflow-x-auto border-t px-4 pt-3"
              aria-label="Files to send"
            >
              {staged.map((item) => (
                <li key={item.key} className="relative shrink-0">
                  {item.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local preview
                    <img
                      src={item.url}
                      alt={item.file.name}
                      className="size-16 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="bg-muted flex h-16 w-36 flex-col justify-center rounded-lg px-2 text-xs">
                      <span className="flex items-center gap-1 truncate font-medium">
                        <Paperclip
                          aria-hidden="true"
                          className="size-3 shrink-0"
                        />
                        <span className="truncate">{item.file.name}</span>
                      </span>
                      <span className="text-muted-foreground">
                        {fileSize(item.file.size)}
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => unstage(item.key)}
                    disabled={sending}
                    className="bg-foreground text-background focus-visible:ring-ring absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
                    aria-label={`Remove ${item.file.name}`}
                    title="Remove"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            onSubmit={send}
            className={cn(
              "border-border-subtle flex items-end gap-2 p-4",
              staged.length === 0 && "border-t",
            )}
          >
            <input
              ref={fileInput}
              type="file"
              accept={ATTACH_ACCEPT}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                stage(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={sending}
              onClick={() => {
                if (!refuseWhenFull()) fileInput.current?.click();
              }}
              aria-label={
                fileCount >= MAX_FILES
                  ? `Attach a file (limit of ${MAX_FILES} reached)`
                  : "Attach a file"
              }
              title={
                fileCount >= MAX_FILES
                  ? `A ticket can have up to ${MAX_FILES} files`
                  : `Attach a photo, PDF, Word or Excel file (up to 20 MB, ${MAX_FILES - fileCount} of ${MAX_FILES} left)`
              }
            >
              <Paperclip
                aria-hidden="true"
                className={cn(sending && "animate-pulse")}
              />
            </Button>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                stage(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={sending}
              onClick={openCamera}
              aria-label="Take a photo"
              title="Take a photo with your camera"
            >
              <Camera aria-hidden="true" />
            </Button>
            <CameraDialog
              open={cameraOpen}
              onOpenChange={setCameraOpen}
              onSend={(file) => stage([file])}
            />
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
              onPaste={onPaste}
              rows={2}
              maxLength={4000}
              placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
              className="min-h-11 flex-1"
            />
            <Button
              type="submit"
              size="lg"
              disabled={sending || (!body.trim() && staged.length === 0)}
              aria-label="Send message"
            >
              <Send aria-hidden="true" />
            </Button>
          </form>
          <p className="text-muted-foreground px-4 pb-3 text-xs">
            {fileCount >= MAX_FILES
              ? `File limit reached: this ticket has ${MAX_FILES} of ${MAX_FILES} files.`
              : `Files: ${fileCount} of ${MAX_FILES} used · up to 20 MB each.`}
          </p>
        </>
      )}
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
