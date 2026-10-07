"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { SelectNative } from "@/components/ui/select-native";
import type { UsageEvent } from "@/lib/api/types";
import { useUsage, useUsageMonths } from "@/lib/api/hooks";
import { callDuration, monthLabel } from "@/lib/format";

const CLASSIFICATION_TONE: Record<string, "secondary" | "outline" | "default"> =
  {
    Internal: "secondary",
    External: "outline",
    International: "default",
    Unknown: "outline",
  };

// The API caps a page at 100 rows (Pagination.MaxPageSize).
const PAGE_SIZES = [25, 50, 100];

export default function UsagePage() {
  // "" = every month.
  const [month, setMonth] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  // The search runs on the server, across every call rather than just the
  // page on screen — `search` is what's typed, `appliedSearch` what's been
  // sent once typing pauses.
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const months = useUsageMonths();
  const usage = useUsage({
    month: month || undefined,
    search: appliedSearch || undefined,
    page,
    limit,
  });

  const total = usage.data?.meta?.total ?? 0;
  const pages = Math.max(1, usage.data?.meta?.pages ?? 1);
  const allMonthsTotal = months.data?.data.reduce((sum, m) => sum + m.count, 0);
  const firstRow = total === 0 ? 0 : (page - 1) * limit + 1;
  const lastRow = Math.min(page * limit, total);

  // The server orders and pages the rows, so sorting only the page on
  // screen would be misleading — every column is left unsortable.
  const columns = useMemo<ColumnDef<UsageEvent, unknown>[]>(
    () => [
      {
        accessorKey: "occured_at",
        header: "When",
        enableSorting: false,
        cell: (c) => new Date(c.getValue<string>()).toLocaleString("en-KE"),
      },
      { accessorKey: "msisdn_pbx", header: "Extension", enableSorting: false },
      {
        accessorKey: "destination",
        header: "Destination",
        enableSorting: false,
      },
      {
        accessorKey: "duration_minutes",
        header: "Duration",
        enableSorting: false,
        cell: (c) => callDuration(c.getValue<number>()),
      },
      {
        accessorKey: "call_classification",
        header: "Type",
        enableSorting: false,
        cell: (c) => {
          const value = c.getValue<string>();
          return (
            <Badge variant={CLASSIFICATION_TONE[value] ?? "outline"}>
              {value}
            </Badge>
          );
        },
      },
      {
        accessorKey: "attribution_state",
        header: "Attribution",
        enableSorting: false,
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Usage events"
        description="Every answered call placed from an extension, most recent first. Duration runs from pickup to hang-up."
      />
      <div className="flex flex-wrap items-end gap-3 px-6 pt-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Month</span>
          <SelectNative
            className="min-w-48"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setPage(1);
            }}
          >
            <option value="">
              All months
              {allMonthsTotal === undefined
                ? ""
                : ` (${allMonthsTotal.toLocaleString("en-KE")})`}
            </option>
            {months.data?.data.map((m) => (
              <option key={m.month} value={m.month}>
                {monthLabel(m.month)} ({m.count.toLocaleString("en-KE")})
              </option>
            ))}
          </SelectNative>
        </label>
        <InputGroup className="max-w-xs">
          <InputGroupAddon>
            <Search aria-hidden="true" className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search by extension or destination…"
            aria-label="Search by extension or destination"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
      </div>
      <DataTable
        columns={columns}
        data={usage.data?.data}
        isLoading={usage.isLoading}
        error={usage.error}
        onRetry={() => usage.refetch()}
        searchable={false}
        emptyIcon={Activity}
        emptyTitle={
          appliedSearch ? "No calls match your search" : "No usage events yet"
        }
        emptyDescription={
          appliedSearch
            ? `Nothing has an extension or destination containing "${appliedSearch}"${month ? ` in ${monthLabel(month)}` : ""}.`
            : "Events appear here once CDR data has been ingested."
        }
        getRowId={(row) => row.id}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {firstRow.toLocaleString("en-KE")}–
              {lastRow.toLocaleString("en-KE")} of{" "}
              {total.toLocaleString("en-KE")} calls
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Rows per page</span>
                <SelectNative
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </SelectNative>
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1 || usage.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Button>
              <span className="text-sm tabular-nums">
                Page {page.toLocaleString("en-KE")} of{" "}
                {pages.toLocaleString("en-KE")}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={page >= pages || usage.isFetching}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        }
      />
    </>
  );
}
