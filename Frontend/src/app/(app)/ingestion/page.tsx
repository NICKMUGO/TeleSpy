"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api/client";
import { useIngestCdr } from "@/lib/api/hooks";

const SAMPLE = `orig,dest,duration_sec,date,orig_time,charge
083,90712345678,125,2026-09-20,14:30:00,
206,383,45,2026-09-20,14:32:10,`;

function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const record: Record<string, unknown> = {};
    headers.forEach((header, i) => {
      if (header === "duration_sec") record[header] = Number(values[i] || 0);
      else if (header === "charge" && values[i])
        record[header] = Number(values[i]);
      else if (values[i]) record[header] = values[i];
    });
    return record;
  });
}

export default function IngestionPage() {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<{
    ingested: number;
    attributed: number;
    unattributed: number;
  } | null>(null);
  const ingest = useIngestCdr();

  async function handleIngest() {
    const records = parseCsv(csv);
    if (records.length === 0) {
      toast.error("Paste at least a header row and one data row.");
      return;
    }
    try {
      const response = await ingest.mutateAsync({
        records,
        sourceFile: "manual-upload.csv",
      });
      setResult(response.data);
      toast.success(`Ingested ${response.data.ingested} record(s).`);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Ingestion failed.",
      );
    }
  }

  return (
    <>
      <PageHeader
        title="CDR upload"
        description="Manually ingest a CDR batch — orig, dest, duration_sec, date, orig_time, optional charge. For scheduled/automated ingestion (CUCM SFTP, Avaya real-time), see ML/ingestion/ on the server."
      />
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cdr-csv">CSV (with header row)</Label>
          <Textarea
            id="cdr-csv"
            rows={10}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={SAMPLE}
            className="font-mono text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={handleIngest}
            disabled={ingest.isPending}
          >
            {ingest.isPending ? "Ingesting…" : "Ingest batch"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setCsv(SAMPLE)}
          >
            Fill sample
          </Button>
        </div>

        {result ? (
          <div className="border-border flex flex-wrap gap-3 rounded-lg border p-4 text-sm">
            <Badge variant="secondary">{result.ingested} ingested</Badge>
            <Badge variant="secondary">{result.attributed} attributed</Badge>
            {result.unattributed > 0 ? (
              <Badge variant="outline">
                {result.unattributed} unattributed
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
