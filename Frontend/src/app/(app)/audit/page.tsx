"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Lock, X } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import type { AuditLogEntry } from "@/lib/api/types";
import { useAuditLog } from "@/lib/api/hooks";

// The API caps a page at 100 rows (Pagination.MaxPageSize).
const PAGE_SIZE = 50;

/** "2026-07-14" (a date input's value) -> that day's local midnight. */
function localMidnight(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** A Date -> the "YYYY-MM-DD" a date input expects, in local time. */
function toInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toInputValue(date);
}

/** Clicking anywhere in a date box opens its calendar, not just the
 * little icon — the way date-of-birth pickers behave. */
function openCalendar(event: React.MouseEvent<HTMLInputElement>) {
  try {
    event.currentTarget.showPicker?.();
  } catch {
    // Some browsers refuse outside a direct user gesture; typing still works.
  }
}

const QUICK_RANGES = [
  { label: "Today", from: () => daysAgo(0) },
  { label: "Last 7 days", from: () => daysAgo(6) },
  { label: "Last 30 days", from: () => daysAgo(29) },
];

export default function AuditPage() {
  // Picked days, as the date inputs hold them ("" = no bound). Each day
  // is the viewer's own local day: `to` covers the whole of that day.
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [page, setPage] = useState(1);
  const today = toInputValue(new Date());
  const backwards = fromDay !== "" && toDay !== "" && fromDay > toDay;

  const range = useMemo(() => {
    if (backwards) return {};
    const to = toDay ? localMidnight(toDay) : null;
    to?.setDate(to.getDate() + 1); // exclusive: up to the end of that day
    return {
      from: fromDay ? localMidnight(fromDay).toISOString() : undefined,
      to: to ? to.toISOString() : undefined,
    };
  }, [fromDay, toDay, backwards]);

  const audit = useAuditLog({ ...range, page, limit: PAGE_SIZE });
  const total = audit.data?.meta?.total ?? 0;
  const pages = Math.max(1, audit.data?.meta?.pages ?? 1);
  const filtered = Boolean(fromDay || toDay);

  function pickFrom(value: string) {
    setFromDay(value);
    setPage(1);
  }
  function pickTo(value: string) {
    setToDay(value);
    setPage(1);
  }

  const columns = useMemo<ColumnDef<AuditLogEntry, unknown>[]>(
    () => [
      {
        accessorKey: "occured_at",
        header: "When",
        cell: (c) => new Date(c.getValue<string>()).toLocaleString("en-KE"),
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: (c) => <Badge variant="outline">{c.getValue<string>()}</Badge>,
      },
      {
        accessorKey: "resource",
        header: "Resource",
        cell: (c) => c.getValue<string | null>() ?? "—",
      },
      {
        accessorKey: "actor_role",
        header: "Actor role",
        cell: (c) => c.getValue<string | null>() ?? "system",
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader title="Audit log" />
      <div className="flex flex-wrap items-end gap-3 px-4 pt-4 sm:px-6">
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-from" className="text-muted-foreground">
            From
          </Label>
          <Input
            id="audit-from"
            type="date"
            className="w-44"
            value={fromDay}
            max={toDay || today}
            onChange={(e) => pickFrom(e.target.value)}
            onClick={openCalendar}
            aria-describedby="audit-range-note"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-to" className="text-muted-foreground">
            To
          </Label>
          <Input
            id="audit-to"
            type="date"
            className="w-44"
            value={toDay}
            min={fromDay || undefined}
            max={today}
            onChange={(e) => pickTo(e.target.value)}
            onClick={openCalendar}
            aria-invalid={backwards}
            aria-describedby="audit-range-note"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="audit-quick" className="text-muted-foreground">
            Quick range
          </Label>
          <SelectNative
            id="audit-quick"
            value=""
            onChange={(e) => {
              const quick = QUICK_RANGES.find(
                (q) => q.label === e.target.value,
              );
              if (!quick) return;
              setFromDay(quick.from());
              setToDay(today);
              setPage(1);
            }}
          >
            <option value="" disabled>
              Choose…
            </option>
            {QUICK_RANGES.map((q) => (
              <option key={q.label} value={q.label}>
                {q.label}
              </option>
            ))}
          </SelectNative>
        </div>
        {filtered ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFromDay("");
              setToDay("");
              setPage(1);
            }}
          >
            <X aria-hidden="true" />
            Clear dates
          </Button>
        ) : null}
        <p
          id="audit-range-note"
          className={
            backwards
              ? "text-destructive w-full text-sm"
              : "text-muted-foreground flex w-full items-center gap-1.5 text-sm"
          }
          aria-live="polite"
        >
          {backwards ? (
            "The “From” date is after the “To” date."
          ) : (
            <>
              <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
              {filtered
                ? `${total.toLocaleString("en-KE")} ${total === 1 ? "entry" : "entries"} ${
                    fromDay && toDay
                      ? fromDay === toDay
                        ? `on ${localMidnight(fromDay).toLocaleDateString("en-KE", { dateStyle: "long" })}`
                        : `from ${localMidnight(fromDay).toLocaleDateString("en-KE", { dateStyle: "long" })} to ${localMidnight(toDay).toLocaleDateString("en-KE", { dateStyle: "long" })}`
                      : fromDay
                        ? `since ${localMidnight(fromDay).toLocaleDateString("en-KE", { dateStyle: "long" })}`
                        : `up to ${localMidnight(toDay).toLocaleDateString("en-KE", { dateStyle: "long" })}`
                  }.`
                : "Pick a day or a range to see what happened then. Click a box to open the calendar."}
            </>
          )}
        </p>
      </div>
      <DataTable
        tourId="audit-table"
        columns={columns}
        data={audit.data?.data}
        isLoading={audit.isLoading}
        error={audit.error}
        onRetry={() => audit.refetch()}
        searchPlaceholder="Search these entries…"
        emptyIcon={Lock}
        emptyTitle={filtered ? "Nothing recorded then" : "No audit entries yet"}
        emptyDescription={
          filtered ? "No actions were recorded in that date range." : undefined
        }
        getRowId={(row) => row.id}
        footer={
          pages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-sm">
                Page {page} of {pages} · {total.toLocaleString("en-KE")}{" "}
                entries, newest first
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={page <= 1 || audit.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft aria-hidden="true" />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={page >= pages || audit.isFetching}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                >
                  Next
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : undefined
        }
      />
    </>
  );
}
