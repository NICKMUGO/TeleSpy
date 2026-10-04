"use client";

import { useMemo } from "react";
import { Globe2 } from "lucide-react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { DataTable } from "@/components/data/data-table";
import { InternationalRateRow } from "@/features/billing/international-rate-row";
import { useInternationalCallRates } from "@/lib/api/hooks";
import type { InternationalCallRate } from "@/lib/api/types";

/** Per-country international call rate table (Admin only), sourced from
 * Safaricom's published international rates. Each row's rate is editable
 * inline — see InternationalRateRow — so a pricing change takes effect
 * immediately via PATCH /call-rates/international/<country_code>. */
export function InternationalRatesTable() {
  const rates = useInternationalCallRates();

  const columns = useMemo<ColumnDef<InternationalCallRate, unknown>[]>(
    () => [
      {
        accessorKey: "country_code",
        header: "Country code",
        cell: (c) => <span className="font-mono">+{c.getValue<string>()}</span>,
      },
      {
        accessorKey: "country_name",
        header: "Country",
        cell: (c) => c.getValue<string | null>() ?? "—",
      },
      {
        id: "rate_kes_per_minute",
        accessorKey: "rate_kes_per_minute",
        header: "Rate",
        cell: (c) => <InternationalRateRow rate={c.row.original} />,
      },
      {
        accessorKey: "updated_at",
        header: "Last updated",
        cell: (c) => new Date(c.getValue<string>()).toLocaleString(),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={rates.data?.data}
      isLoading={rates.isLoading}
      error={rates.error}
      onRetry={() => rates.refetch()}
      searchPlaceholder="Search countries or codes…"
      emptyIcon={Globe2}
      emptyTitle="No international rates configured"
      getRowId={(row) => row.id}
    />
  );
}
