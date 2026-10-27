"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  /** False hides the search box — for a list the server pages through,
   * where filtering only the rows on screen would mislead. */
  searchable?: boolean;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription?: string;
  toolbarEnd?: ReactNode;
  /** Rendered under the table, e.g. page controls. */
  footer?: ReactNode;
  getRowId?: (row: TData) => string;
  /** Show this many rows at a time, with page controls underneath — or
   * "fit": as many as fit in the window without scrolling, recounted when
   * the window resizes. Paging runs after search and sort, so a search
   * still covers every row. */
  pageSize?: number | "fit";
  /** Phones: the column whose value titles each card (default: the first). */
  phoneTitleColumn?: string;
  /** Spotlight anchor for the guided tour (TutorialContent.cs Target). */
  tourId?: string;
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
  searchable = true,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  toolbarEnd,
  footer,
  getRowId,
  pageSize,
  phoneTitleColumn,
  tourId,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const tableRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [fitRows, setFitRows] = useState(10);
  const [windowHeight, setWindowHeight] = useState(0);

  useEffect(() => {
    if (pageSize !== "fit") return;
    const onResize = () => setWindowHeight(window.innerHeight);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pageSize]);

  // Count the rows that fit between the table's top and the bottom of the
  // window, leaving room for the page controls. Measured again once the
  // rows have rendered (after loading) and whenever the window resizes.
  useLayoutEffect(() => {
    // Whichever layout is on screen: the table, or the cards on a phone.
    const box = [tableRef.current, listRef.current].find(
      (el) => el && el.offsetParent !== null,
    );
    if (pageSize !== "fit" || !box || !windowHeight) return;
    const top = box.getBoundingClientRect().top + window.scrollY;
    // On phones the tab bar covers the bottom of the window.
    const tabBar = document.querySelector<HTMLElement>("[data-tab-bar]");
    const bottom =
      tabBar && tabBar.offsetParent !== null
        ? windowHeight - tabBar.getBoundingClientRect().height
        : windowHeight;
    const head =
      box.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const row =
      box.querySelector("tbody tr, li")?.getBoundingClientRect().height || 41;
    // Page controls (28) + gap (12) + bottom padding (24) + borders and a
    // possible sideways scrollbar (20).
    const reserved = 84;
    const count = Math.max(
      3,
      Math.floor((bottom - top - head - reserved) / row),
    );
    setFitRows(count);
  }, [pageSize, windowHeight, isLoading, error, data]);

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
    onSortingChange: (updater: unknown) => {
      setSorting(updater as never);
      setPageIndex(0);
    },
    onGlobalFilterChange: (value: string) => {
      setGlobalFilter(value);
      setPageIndex(0);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: getRowId ? (row: TData) => getRowId(row) : undefined,
  });

  if (error) return <ErrorBanner error={error} onRetry={onRetry} />;

  if (isLoading) {
    return (
      // Shaped like what's coming: a search box over the table (or the
      // cards on a phone), so nothing jumps when the rows arrive.
      <div className="flex flex-col gap-3 p-4 sm:p-6" aria-busy="true">
        {searchable ? (
          <Skeleton className="h-8 w-full rounded-lg sm:w-80" />
        ) : null}
        <div className="bg-card shadow-panel overflow-hidden rounded-xl">
          <div className="border-border-subtle flex gap-6 border-b px-4 py-3 max-sm:hidden">
            {columns.slice(0, 5).map((_, i) => (
              <Skeleton key={i} className="h-3 flex-1" />
            ))}
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border-border-subtle flex gap-6 border-b px-4 py-3.5 last:border-b-0 max-sm:flex-col max-sm:gap-2"
            >
              {columns.slice(0, 5).map((_, j) => (
                <Skeleton
                  key={j}
                  className={
                    j === 0
                      ? "h-4 flex-1 max-sm:w-1/2"
                      : "h-4 flex-1 max-sm:h-3 max-sm:w-3/4 max-sm:flex-none"
                  }
                />
              ))}
            </div>
          ))}
        </div>
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

  const allRows = table.getRowModel().rows;
  const rowsPerPage = pageSize === "fit" ? fitRows : pageSize;
  const pageCount = rowsPerPage
    ? Math.max(1, Math.ceil(allRows.length / rowsPerPage))
    : 1;
  // Clamp: a refetch or a removal can leave fewer pages than before.
  const page = Math.min(pageIndex, pageCount - 1);
  const rows = rowsPerPage
    ? allRows.slice(page * rowsPerPage, (page + 1) * rowsPerPage)
    : allRows;

  return (
    <div data-tour={tourId} className="flex flex-col gap-3 p-4 sm:p-6">
      {searchable || toolbarEnd ? (
        <div className="flex flex-wrap items-center gap-2">
          {searchable ? (
            <InputGroup className="w-full sm:w-80">
              <InputGroupAddon>
                <Search aria-hidden="true" className="size-4" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder={searchPlaceholder}
                value={globalFilter}
                onChange={(e) => {
                  setGlobalFilter(e.target.value);
                  setPageIndex(0);
                }}
                aria-label={searchPlaceholder}
              />
            </InputGroup>
          ) : null}
          {toolbarEnd ? (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              {toolbarEnd}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        ref={tableRef}
        className="bg-card shadow-panel relative overflow-x-auto rounded-xl max-sm:hidden"
      >
        <table className="w-full text-sm">
          <thead className="border-border-subtle border-b">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sortState = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className="text-muted-foreground px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap"
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
            {rows.map((row, i) => (
              <tr
                key={row.id}
                style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}
                className="border-border-subtle hover:bg-muted/50 animate-rise border-b transition-colors last:border-b-0"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: each row as a card — the first column as its title, the
          last (usually a status) beside it, the rest as label/value pairs. */}
      <ul
        ref={listRef}
        className="bg-card shadow-panel divide-border-subtle divide-y overflow-hidden rounded-xl sm:hidden"
      >
        {rows.map((row, i) => {
          const all = row.getVisibleCells();
          const titleAt = Math.max(
            0,
            all.findIndex((cell) => cell.column.id === phoneTitleColumn),
          );
          const cells = [all[titleAt], ...all.filter((_, j) => j !== titleAt)];
          const [first, ...rest] = cells;
          const last = rest.length > 1 ? rest[rest.length - 1] : undefined;
          const middle = last ? rest.slice(0, -1) : rest;
          return (
            <li
              key={row.id}
              style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}
              className="animate-rise flex flex-col gap-1.5 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-base font-semibold">
                  {first
                    ? flexRender(
                        first.column.columnDef.cell,
                        first.getContext(),
                      )
                    : null}
                </div>
                {last ? (
                  <div className="shrink-0">
                    {flexRender(last.column.columnDef.cell, last.getContext())}
                  </div>
                ) : null}
              </div>
              {middle.length ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                  {middle.map((cell) => {
                    const header = cell.column.columnDef.header;
                    return typeof header === "string" && header ? (
                      <div key={cell.id} className="contents">
                        <dt className="text-muted-foreground">
                          {String(header)}
                        </dt>
                        <dd className="min-w-0 truncate">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </dd>
                      </div>
                    ) : (
                      <div key={cell.id} className="col-span-2 pt-1">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </div>
                    );
                  })}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>

      {allRows.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No rows match &ldquo;{globalFilter}&rdquo;.
        </p>
      ) : null}

      {rowsPerPage && allRows.length > rowsPerPage ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground" aria-live="polite">
            {page * rowsPerPage + 1}–
            {Math.min((page + 1) * rowsPerPage, allRows.length)} of{" "}
            {allRows.length.toLocaleString("en-KE")}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPageIndex(page - 1)}
            >
              <ChevronLeft aria-hidden="true" />
              Previous
            </Button>
            <span className="text-muted-foreground">
              Page {page + 1} of {pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPageIndex(page + 1)}
            >
              Next
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}

      {footer}
    </div>
  );
}
