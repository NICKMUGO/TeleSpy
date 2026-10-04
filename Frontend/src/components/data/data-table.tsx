"use client";

import { useState, type ReactNode } from "react";
import { flexRender } from "@tanstack/react-table";
// TanStack Table v9 (9.1.2, what's installed) is a from-scratch rewrite —
// useReactTable/getCoreRowModel/etc. from the v8 API don't exist on the
// main entrypoint any more (it's now atom/store-based, see useTable.d.ts).
// The package ships a `/legacy` entrypoint specifically for v8-shaped
// call sites like this one — useLegacyTable + LegacyColumnDef give back
// the exact hooks API this component is written against.
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useLegacyTable as useReactTable,
  type LegacyColumnDef as ColumnDef,
} from "@tanstack/react-table/legacy";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/data/empty-state";
import { ErrorBanner } from "@/components/data/error-banner";
import type { LucideIcon } from "lucide-react";

interface DataTableProps<TData extends object> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  searchPlaceholder?: string;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription?: string;
  toolbarEnd?: ReactNode;
  getRowId?: (row: TData) => string;
}

/** One table implementation for every screen (employees, SIMs, usage,
 * anomalies, audit, …): headless TanStack Table v9 for sort/filter state,
 * a real <table> for semantics, horizontal scroll contained to the table
 * itself (not the page) so this stays usable at phone width without
 * breaking layout — the one thing allowed to scroll sideways. */
export function DataTable<TData extends object>({
  columns,
  data,
  isLoading,
  error,
  onRetry,
  searchPlaceholder = "Search…",
  emptyIcon,
  emptyTitle,
  emptyDescription,
  toolbarEnd,
  getRowId,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  // The legacy v9 generics don't propagate cleanly through a wrapper
  // component generic over TData (deeply nested LegacyFeatures/RowData
  // variance errors with no practical fix short of duplicating this
  // component per screen) — isolated to this one call so every screen's
  // own ColumnDef<Employee, ...> etc. stays fully typed; only this
  // internal wiring is loose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = useReactTable<any>({
    data: (data ?? []) as never[],
    columns: columns as never[],
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: getRowId ? (row: TData) => getRowId(row) : undefined,
  });

  if (error) return <ErrorBanner error={error} onRetry={onRetry} />;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="max-w-xs">
          <InputGroupAddon>
            <Search aria-hidden="true" className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            aria-label={searchPlaceholder}
          />
        </InputGroup>
        {toolbarEnd ? (
          <div className="ml-auto flex items-center gap-2">{toolbarEnd}</div>
        ) : null}
      </div>

      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-border bg-muted/40 border-b">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sortState = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="hover:text-foreground text-muted-foreground focus-visible:ring-ring flex items-center gap-1 rounded outline-none focus-visible:ring-2"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sortState === "asc" ? (
                            <ArrowUp aria-hidden="true" className="size-3.5" />
                          ) : sortState === "desc" ? (
                            <ArrowDown
                              aria-hidden="true"
                              className="size-3.5"
                            />
                          ) : (
                            <ArrowUpDown
                              aria-hidden="true"
                              className="size-3.5 opacity-40"
                            />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-border hover:bg-muted/30 border-b last:border-b-0"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2.5 whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {table.getRowModel().rows.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No rows match &ldquo;{globalFilter}&rdquo;.
        </p>
      ) : null}
    </div>
  );
}
