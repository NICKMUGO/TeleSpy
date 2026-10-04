/**
 * Client-side CDR parsing and validation.
 *
 * The API takes a JSON array of records (POST /cdr/ingest), not a file
 * upload, so the browser is where a carrier CSV becomes records — which
 * also means malformed rows can be reported per-line, with their original
 * line number, before anything reaches the server.
 */

export const CDR_COLUMNS = [
  "orig",
  "dest",
  "duration_sec",
  "date",
  "orig_time",
  "charge",
] as const;

const REQUIRED_COLUMNS = ["orig", "dest", "duration_sec", "date"] as const;

export interface RejectedRow {
  line: number;
  reason: string;
}

export interface ParsedBatch {
  records: Record<string, unknown>[];
  rejected: RejectedRow[];
  totalRows: number;
  missingColumns: string[];
}

// Minimal RFC4180 line splitter: handles quoted fields containing commas,
// which carrier exports do produce in free-text columns.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      out.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  out.push(field);
  return out.map((value) => value.trim());
}

export function parseCdrCsv(text: string): ParsedBatch {
  const lines = text
    .split(/\r?\n/)
    .filter((line, index) => index === 0 || line.trim() !== "");

  if (lines.length < 2) {
    return { records: [], rejected: [], totalRows: 0, missingColumns: [] };
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missingColumns.length > 0) {
    return {
      records: [],
      rejected: [],
      totalRows: lines.length - 1,
      missingColumns,
    };
  }

  const records: Record<string, unknown>[] = [];
  const rejected: RejectedRow[] = [];

  lines.slice(1).forEach((line, index) => {
    const lineNumber = index + 2; // 1-based, and line 1 is the header
    const values = splitCsvLine(line);
    const row: Record<string, unknown> = {};

    headers.forEach((header, i) => {
      const value = values[i];
      if (value === undefined || value === "") return;
      if (header === "duration_sec" || header === "charge") {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) row[header] = parsed;
      } else {
        row[header] = value;
      }
    });

    const missing = REQUIRED_COLUMNS.filter((c) => row[c] === undefined);
    if (missing.length > 0) {
      rejected.push({
        line: lineNumber,
        reason: `missing ${missing.join(", ")}`,
      });
      return;
    }
    if (typeof row.duration_sec !== "number") {
      rejected.push({
        line: lineNumber,
        reason: "duration_sec is not a number",
      });
      return;
    }
    records.push(row);
  });

  return { records, rejected, totalRows: lines.length - 1, missingColumns: [] };
}

/** Carrier + period are not columns on usage_events, but source_file is —
 * so they're encoded into the filename the batch is recorded under, which
 * is what the ingestion history then displays. */
export function sourceFileName(
  carrier: string,
  period: string,
  original: string | null,
) {
  const stem = `${carrier}_${period}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return original ? `${stem}__${original}` : `${stem}.csv`;
}
