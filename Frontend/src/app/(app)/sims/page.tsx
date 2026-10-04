"use client";

import { useMemo } from "react";
import { Smartphone } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/data/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/api/client";
import type { SimCard } from "@/lib/api/types";
import {
  useAllocateSim,
  useEmployees,
  useSims,
  useUnassignSim,
} from "@/lib/api/hooks";
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
  const allocate = useAllocateSim();
  const unassign = useUnassignSim();
  const role = useSession((state) => state.user?.role);
  const canManage = role === "Admin" || role === "Manager";

  const employeeNameById = useMemo(
    () => new Map((employees.data?.data ?? []).map((e) => [e.id, e.full_name])),
    [employees.data],
  );

  async function handleAllocate(simId: string, employeeId: string) {
    try {
      await allocate.mutateAsync({ simId, employeeId });
      toast.success("SIM allocated.");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't allocate this SIM.",
      );
    }
  }

  async function handleUnassign(simId: string) {
    try {
      await unassign.mutateAsync(simId);
      toast.success("SIM unassigned.");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't unassign this SIM.",
      );
    }
  }

  const columns = useMemo<ColumnDef<SimCard, unknown>[]>(() => {
    const base: ColumnDef<SimCard, unknown>[] = [
      {
        accessorKey: "provider",
        header: "Provider",
        cell: (c) => c.getValue<string | null>() ?? "—",
      },
      {
        accessorKey: "msisdn_masked",
        header: "MSISDN",
        cell: (c) =>
          c.row.original.msisdn ?? c.row.original.msisdn_masked ?? "—",
      },
      {
        accessorKey: "extension",
        header: "Extension",
        cell: (c) => c.getValue<string | null>() ?? "—",
      },
      {
        accessorKey: "employee_id",
        header: "Allocated to",
        cell: (c) => {
          const id = c.getValue<string | null>();
          return id ? (
            (employeeNameById.get(id) ?? id)
          ) : (
            <span className="text-muted-foreground">Unallocated</span>
          );
        },
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

    if (!canManage) return base;

    return [
      ...base,
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: (c) => {
          const sim = c.row.original;
          return sim.employee_id ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleUnassign(sim.id)}
            >
              Unassign
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  Allocate…
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-64 overflow-y-auto"
              >
                {(employees.data?.data ?? []).map((employee) => (
                  <DropdownMenuItem
                    key={employee.id}
                    onSelect={() => handleAllocate(sim.id, employee.id)}
                  >
                    {employee.full_name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers are stable per render, employees.data is the real dep
  }, [canManage, employeeNameById, employees.data]);

  return (
    <>
      <PageHeader
        title="SIM inventory"
        description="Every SIM card, who it's allocated to, and its lifecycle state."
      />
      <DataTable
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
    </>
  );
}
