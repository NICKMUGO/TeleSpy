"use client";

import { CheckCircle2, CircleAlert, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { downloadCsv } from "@/lib/export-csv";
import type { CdrIngestBatch } from "@/lib/api/types";

/**
 * Detail view for one ingestion batch.
 *
 * Everything here comes from the cdr_ingest_batches row the ingest wrote
 * (counts plus source file). There is no per-stage timing in that record, so this
 * shows the outcome of each stage against the one real timestamp rather
 * than inventing a plausible-looking per-step clock.
 */
export function BatchDetailSheet({
  entry,
  onOpenChange,
}: {
  entry: CdrIngestBatch | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!entry) return null;

  const { ingested, attributed, unattributed } = entry;
  const attributionRate = ingested ? (attributed / ingested) * 100 : 0;
  const sourceFile = entry.source_file ?? "manual upload";

  const stages = [
    {
      label: "Batch received",
      detail: `${ingested.toLocaleString("en-KE")} rows`,
    },
    { label: "Classified", detail: "Internal / External / International" },
    {
      label: "Attributed to SIM allocation",
      detail: `${attributed.toLocaleString("en-KE")} of ${ingested.toLocaleString("en-KE")}`,
      warn: unattributed > 0,
    },
    { label: "Batch committed", detail: "single transaction" },
  ];

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="font-tabular text-sm">
            {entry.id.slice(0, 8).toUpperCase()}
          </SheetTitle>
          <SheetDescription>
            {sourceFile} · uploaded by {entry.uploaded_by_role ?? "system"} ·{" "}
            {new Date(entry.occured_at).toLocaleString("en-KE")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-4">
          <section>
            <h3 className="text-muted-foreground text-[0.6875rem] font-medium tracking-[0.12em] uppercase">
              Processing
            </h3>
            <ol className="mt-3 flex flex-col gap-2.5">
              {stages.map((stage) => (
                <li key={stage.label} className="flex items-start gap-2.5">
                  {stage.warn ? (
                    <CircleAlert
                      aria-hidden="true"
                      className="text-warning mt-0.5 size-4 shrink-0"
                    />
                  ) : (
                    <CheckCircle2
                      aria-hidden="true"
                      className="text-success mt-0.5 size-4 shrink-0"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm">{stage.label}</span>
                    <span className="text-muted-foreground font-tabular block text-xs">
                      {stage.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h3 className="text-muted-foreground text-[0.6875rem] font-medium tracking-[0.12em] uppercase">
              Attribution
            </h3>
            <div className="mt-3 flex items-baseline justify-between text-sm">
              <span>Matched to an employee</span>
              <span className="font-tabular font-semibold">
                {attributionRate.toFixed(0)}%
              </span>
            </div>
            <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-success h-full rounded-full"
                style={{ width: `${attributionRate}%` }}
              />
            </div>
            <div className="text-muted-foreground mt-2 flex items-baseline justify-between text-xs">
              <span>Unattributed (unknown SIM / extension)</span>
              <span className="font-tabular">
                {unattributed.toLocaleString("en-KE")}
              </span>
            </div>
            {(
              [
                ["Already uploaded before (skipped)", entry.skipped_duplicates],
                ["No date/time (skipped)", entry.skipped_invalid],
                ["Unanswered (skipped)", entry.skipped_unanswered],
              ] as const
            ).map(([label, count]) =>
              count ? (
                <div
                  key={label}
                  className="text-muted-foreground mt-1 flex items-baseline justify-between text-xs"
                >
                  <span>{label}</span>
                  <span className="font-tabular">
                    {count.toLocaleString("en-KE")}
                  </span>
                </div>
              ) : null,
            )}
          </section>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() =>
              downloadCsv(
                `batch-${entry.id.slice(0, 8)}.csv`,
                ["Field", "Value"],
                [
                  ["Batch id", entry.id],
                  ["Source file", sourceFile],
                  ["Ingested", ingested],
                  ["Attributed", attributed],
                  ["Unattributed", unattributed],
                  ["Already uploaded (skipped)", entry.skipped_duplicates],
                  ["No date/time (skipped)", entry.skipped_invalid],
                  ["Uploaded by", entry.uploaded_by_role ?? ""],
                  ["Occurred at", entry.occured_at],
                ],
              )
            }
          >
            <Download aria-hidden="true" data-icon="inline-start" />
            Download batch record
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
