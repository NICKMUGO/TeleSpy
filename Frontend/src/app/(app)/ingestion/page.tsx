"use client";

import { useMemo, useRef, useState } from "react";
import { CloudUpload, FileSpreadsheet, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/data/section-card";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";
import { BatchDetailSheet } from "@/features/ingestion/batch-detail-sheet";
import {
  parseCdrCsv,
  sourceFileName,
  type ParsedBatch,
} from "@/features/ingestion/cdr-parser";
import { ApiError } from "@/lib/api/client";
import { useAuditLog, useIngestCdr } from "@/lib/api/hooks";
import { downloadCsv } from "@/lib/export-csv";
import { monthKey, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuditLogEntry } from "@/lib/api/types";

const CARRIERS = ["Safaricom", "Airtel", "Telkom"];

// Twelve months back from today, newest first — a carrier batch is always
// for a period that has already closed.
const PERIODS = Array.from({ length: 12 }, (_, i) => {
  const now = new Date();
  return monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1));
});

type Stage = "idle" | "reading" | "validating" | "uploading" | "done";

const STAGE_LABEL: Record<Exclude<Stage, "idle">, string> = {
  reading: "Reading file",
  validating: "Validating",
  uploading: "Uploading",
  done: "Complete",
};

export default function IngestionPage() {
  const [carrier, setCarrier] = useState(CARRIERS[0]);
  const [period, setPeriod] = useState(PERIODS[1] ?? PERIODS[0]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBatch | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{
    ingested: number;
    attributed: number;
    unattributed: number;
  } | null>(null);
  const [openBatch, setOpenBatch] = useState<AuditLogEntry | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ingest = useIngestCdr();
  const audit = useAuditLog();

  const batches = useMemo(
    () =>
      (audit.data?.data ?? []).filter(
        (entry) => entry.action === "cdr_ingested",
      ),
    [audit.data],
  );

  async function handleFile(file: File) {
    setResult(null);
    setFileName(file.name);
    setStage("reading");
    const text = await file.text();
    setStage("validating");
    const batch = parseCdrCsv(text);
    setParsed(batch);
    setStage("idle");
    if (batch.missingColumns.length > 0) {
      toast.error(
        `Missing required column(s): ${batch.missingColumns.join(", ")}`,
      );
    }
  }

  async function handleIngest() {
    if (!parsed || parsed.records.length === 0) return;
    setStage("uploading");
    try {
      const response = await ingest.mutateAsync({
        records: parsed.records,
        sourceFile: sourceFileName(carrier, period, fileName),
      });
      setResult(response.data);
      setStage("done");
      toast.success(
        response.message ?? `Ingested ${response.data.ingested} record(s).`,
      );
      audit.refetch();
    } catch (error) {
      setStage("idle");
      toast.error(
        error instanceof ApiError ? error.message : "Ingestion failed.",
      );
    }
  }

  const accepted = parsed?.records.length ?? 0;
  const rejected = parsed?.rejected.length ?? 0;

  return (
    <>
      <PageHeader
        title="CDR upload"
        description="Upload carrier CDR batches and track ingestion status."
      />

      <div className="flex flex-col gap-4 p-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Upload */}
          <SectionCard
            title="Upload a CDR batch"
            description="orig, dest, duration_sec, date — plus optional orig_time and charge"
            className="lg:col-span-2"
          >
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files[0];
                if (file) handleFile(file);
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border-subtle bg-muted/40",
              )}
            >
              <CloudUpload
                aria-hidden="true"
                className="text-muted-foreground size-7"
              />
              <p className="text-sm font-medium">
                Drag and drop a carrier CSV here
              </p>
              <p className="text-muted-foreground text-xs">
                Accepts .csv — parsed in your browser, then sent as records
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => inputRef.current?.click()}
              >
                Browse files
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cdr-carrier">Carrier</Label>
                <SelectNative
                  id="cdr-carrier"
                  value={carrier}
                  onChange={(event) => setCarrier(event.target.value)}
                >
                  {CARRIERS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cdr-period">Billing period</Label>
                <SelectNative
                  id="cdr-period"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                >
                  {PERIODS.map((key) => (
                    <option key={key} value={key}>
                      {monthLabel(key)}
                    </option>
                  ))}
                </SelectNative>
              </div>
            </div>

            {fileName ? (
              <div className="border-border-subtle mt-4 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0"
                  />
                  <span className="font-tabular min-w-0 flex-1 truncate text-xs">
                    {fileName}
                  </span>
                  <span className="text-muted-foreground font-tabular shrink-0 text-xs">
                    {stage === "idle" || stage === "done"
                      ? `${accepted.toLocaleString("en-KE")} rows ready`
                      : STAGE_LABEL[stage]}
                  </span>
                </div>
                <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-300",
                      stage === "done" ? "bg-success" : "bg-primary",
                    )}
                    style={{
                      width:
                        stage === "reading"
                          ? "25%"
                          : stage === "validating"
                            ? "55%"
                            : stage === "uploading"
                              ? "80%"
                              : stage === "done"
                                ? "100%"
                                : accepted > 0
                                  ? "55%"
                                  : "0%",
                    }}
                  />
                </div>
              </div>
            ) : null}

            <Button
              type="button"
              className="mt-4"
              onClick={handleIngest}
              disabled={accepted === 0 || ingest.isPending}
            >
              {ingest.isPending
                ? "Ingesting…"
                : `Ingest ${accepted.toLocaleString("en-KE")} row(s)`}
            </Button>
          </SectionCard>

          {/* Validation */}
          <SectionCard title="Validation">
            {!parsed ? (
              <p className="text-muted-foreground py-6 text-center text-xs">
                Choose a file to see its row counts before anything is sent.
              </p>
            ) : parsed.missingColumns.length > 0 ? (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden="true" />
                <AlertTitle className="font-normal">
                  Missing required column(s):{" "}
                  <span className="font-tabular">
                    {parsed.missingColumns.join(", ")}
                  </span>
                </AlertTitle>
              </Alert>
            ) : (
              <dl className="flex flex-col gap-2.5 text-sm">
                <Row label="Rows in file" value={parsed.totalRows} />
                <Row label="Accepted" value={accepted} tone="success" />
                <Row
                  label="Rejected"
                  value={rejected}
                  tone={rejected > 0 ? "destructive" : undefined}
                />
                {result ? (
                  <>
                    <Row
                      label="Attributed"
                      value={result.attributed}
                      tone="success"
                    />
                    <Row
                      label="Unattributed"
                      value={result.unattributed}
                      tone={result.unattributed > 0 ? "warning" : undefined}
                    />
                  </>
                ) : null}
                {rejected > 0 ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="mt-1 self-start px-0"
                    onClick={() =>
                      downloadCsv(
                        `rejected-rows-${fileName ?? "batch"}.csv`,
                        ["Line", "Reason"],
                        parsed.rejected.map((row) => [row.line, row.reason]),
                      )
                    }
                  >
                    Download error report
                  </Button>
                ) : null}
              </dl>
            )}
          </SectionCard>
        </div>

        {/* History */}
        <SectionCard
          title="Ingestion history"
          description="Every cdr_ingested entry from the audit log"
          bodyClassName="px-0 pb-0"
        >
          {audit.isLoading ? (
            <div className="flex flex-col gap-2 px-4 pb-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : batches.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-border-subtle border-y text-[0.6875rem] tracking-wide uppercase">
                    <Th>Batch</Th>
                    <Th>Source file</Th>
                    <Th>Uploaded by</Th>
                    <Th align="end">Rows</Th>
                    <Th align="end">Unattributed</Th>
                    <Th>When</Th>
                  </tr>
                </thead>
                <tbody className="divide-border-subtle divide-y">
                  {batches.map((entry) => (
                    <tr
                      key={entry.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => setOpenBatch(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setOpenBatch(entry);
                        }
                      }}
                      className="hover:bg-muted/50 focus-visible:ring-ring cursor-pointer focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <td className="font-tabular px-4 py-2.5 text-xs">
                        {entry.id.slice(0, 8).toUpperCase()}
                      </td>
                      <td className="font-tabular max-w-56 truncate px-4 py-2.5 text-xs">
                        {String(entry.meta.source_file ?? "manual upload")}
                      </td>
                      <td className="px-4 py-2.5">
                        {entry.actor_role ?? "system"}
                      </td>
                      <td className="font-tabular px-4 py-2.5 text-end">
                        {Number(entry.meta.ingested ?? 0).toLocaleString(
                          "en-KE",
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-end">
                        {Number(entry.meta.unattributed ?? 0) > 0 ? (
                          <Badge variant="destructive">
                            {Number(entry.meta.unattributed).toLocaleString(
                              "en-KE",
                            )}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground font-tabular">
                            0
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5 text-xs">
                        {new Date(entry.occured_at).toLocaleString("en-KE")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground px-4 pb-6 text-center text-xs">
              No batches ingested yet.
            </p>
          )}
        </SectionCard>
      </div>

      <BatchDetailSheet
        entry={openBatch}
        onOpenChange={(open) => !open && setOpenBatch(null)}
      />
    </>
  );
}

function Th({
  children,
  align = "start",
}: {
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2 font-medium",
        align === "end" ? "text-end" : "text-start",
      )}
    >
      {children}
    </th>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "destructive" | "warning";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={cn(
          "font-tabular font-semibold",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive",
          tone === "warning" && "text-warning",
        )}
      >
        {value.toLocaleString("en-KE")}
      </dd>
    </div>
  );
}
