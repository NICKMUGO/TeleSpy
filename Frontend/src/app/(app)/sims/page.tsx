"use client";

import { useMemo, useState } from "react";
import { Smartphone } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimHolderDialog } from "@/features/sims/sim-holder-dialog";
import type { SimCard } from "@/lib/api/types";
import { useEmployees, useSims } from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";

const LIFECYCLE_TONE: Record<string, "secondary" | "outline" | "destructive"> =
  {
    active: "secondary",
    suspended: "outline",
    retired: "destructive",
  };

export default function SimsPage() {
  const sims = useSims();
  const employees = useEmployees();
  // Only an Admin may change who holds a SIM (and so its extension) — a
  // Manager can see the inventory but not reassign it.
  const isAdmin = useSession((state) => state.user?.role) === "Admin";
  const [changingHolder, setChangingHolder] = useState<SimCard | null>(null);

  const employeeNameById = useMemo(
    () => new Map((employees.data?.data ?? []).map((e) => [e.id, e.full_name])),
    [employees.data],
  );

  const columns = useMemo<ColumnDef<SimCard, unknown>[]>(() => {
    const base: ColumnDef<SimCard, unknown>[] = [
      {
        accessorKey: "provider",
        header: "Provider",
        cell: (c) => c.getValue<string | null>() ?? "—",
      },
      {
        id: "number",
        header: "Number",
        // An Admin gets the full number, everyone else a masked one —
        // whichever it is, it's the column's value, so search finds it.
        accessorFn: (sim) => sim.msisdn ?? sim.msisdn_masked ?? "",
        cell: (c) => (
          <span className="font-tabular">{c.getValue<string>() || "—"}</span>
        ),
      },
      {
        accessorKey: "extension",
        header: "Extension",
        cell: (c) => c.getValue<string | null>() ?? "—",
      },
      {
        id: "allocated_to",
        header: "Allocated to",
        // The holder's name comes with the SIM itself; the employee list
        // is only a fallback. Never the raw employee id — that means
        // nothing to a person. Being the column's value, the name is also
        // what search and sort work on.
        accessorFn: (sim) =>
          sim.employee_id
            ? (sim.employee_name ??
              employeeNameById.get(sim.employee_id) ??
              "Name unavailable")
            : "",
        cell: (c) =>
          c.getValue<string>() || (
            <span className="text-muted-foreground">Unallocated</span>
          ),
      },
      {
        accessorKey: "lifecycle_state",
        header: "Status",
        cell: (c) => {
          const state = c.getValue<string>();
          return (
            <Badge variant={LIFECYCLE_TONE[state] ?? "outline"}>{state}</Badge>
          );
        },
      },
    ];

    if (!isAdmin) return base;

    return [
      ...base,
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: (c) => {
          const sim = c.row.original;
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              // A suspended or decommissioned SIM can be taken back, but
              // not given to anyone.
              disabled={!sim.employee_id && sim.lifecycle_state !== "active"}
              onClick={() => setChangingHolder(sim)}
            >
              {sim.employee_id ? "Change holder…" : "Assign…"}
            </Button>
          );
        },
      },
    ];
  }, [isAdmin, employeeNameById]);

  return (
    <>
      <PageHeader
        title="SIM inventory"
        description="Every SIM card, its company number and extension, who holds it, and its lifecycle state."
      />
      <DataTable
        tourId="sims-table"
        columns={columns}
        data={sims.data?.data}
        isLoading={sims.isLoading}
        error={sims.error}
        onRetry={() => sims.refetch()}
        searchPlaceholder="Search SIMs…"
        emptyIcon={Smartphone}
        emptyTitle="No SIM cards yet"
        getRowId={(row) => row.id}
      />
      {changingHolder ? (
        <SimHolderDialog
          key={changingHolder.id}
          sim={changingHolder}
          employees={employees.data?.data ?? []}
          onClose={() => setChangingHolder(null)}
        />
      ) : null}
    </>
  );
}
