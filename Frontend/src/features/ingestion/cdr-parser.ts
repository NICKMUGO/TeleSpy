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

const REQUIRED_COLUMNS = [
  "orig",
  "dest",
  "duration_sec",
  "date",
  "orig_time",
] as const;

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

/** The delimiter of a delimited-text export, judged from its header line:
 * tab (text exports), semicolon (Excel's "CSV" in comma-decimal
 * locales) or, by default, comma. */
export function detectDelimiter(headerLine: string): string {
  const counts = ["\t", ";", ","].map(
    (d) => [d, headerLine.split(d).length - 1] as const,
  );
  const [best, count] = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return count > 0 ? best : ",";
}

// Minimal RFC4180 line splitter: handles quoted fields containing the
// delimiter, which carrier exports do produce in free-text columns.
function splitCsvLine(line: string, delimiter = ","): string[] {
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
    } else if (char === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  out.push(field);
  return out.map((value) => value.trim());
}

/** Other spellings of the columns seen in carrier exports — the same
 * aliases ML/preprocessing/run_preprocessing.py (RAW_COLUMNS) accepts. */
const COLUMN_ALIASES: Record<string, string> = {
  "orig.": "orig",
  "orig. time": "orig_time",
  "orig time": "orig_time",
  "dest.": "dest",
  "duration (sec)": "duration_sec",
  duration: "duration_sec",
};

/** The PBX is in Nairobi (UTC+3, no daylight saving). */
const NAIROBI_OFFSET_SEC = 3 * 60 * 60;

/** A Cisco CallManager (CUCM) export, in its own column names? */
function isCucmExport(headers: string[]) {
  return (
    headers.includes("datetimeorigination") &&
    headers.includes("callingpartynumber")
  );
}

/** One raw CUCM row → the upload's columns, the same way
 * run_preprocessing.py (derive_cucm_fields) does it:
 * - the call's time is when it was **answered** (dateTimeConnect), not
 *   when the handset went off-hook — duration runs from answer to hang-up,
 *   so peak/off-peak is decided from the same moment; a call that never
 *   connected (dateTimeConnect 0) keeps its origination time;
 * - CUCM times are UTC epoch seconds → Nairobi wall-clock time;
 * - the destination is where the call finally went (after a forward),
 *   else the number dialled. */
function fromCucm(
  get: (column: string) => string | undefined,
): Record<string, string> | string {
  const origination = Number(get("datetimeorigination"));
  const connect = Number(get("datetimeconnect") ?? 0);
  const epoch = connect > 0 ? connect : origination;
  if (!Number.isFinite(epoch) || epoch <= 0) return "no call time";
  const local = new Date((epoch + NAIROBI_OFFSET_SEC) * 1000).toISOString();
  const orig = get("callingpartynumber");
  const dest =
    get("finalcalledpartynumber") || get("originalcalledpartynumber");
  const duration = get("duration");
  const row: Record<string, string> = {
    date: local.slice(0, 10),
    orig_time: local.slice(11, 19),
  };
  if (orig) row.orig = orig;
  if (dest) row.dest = dest;
  if (duration !== undefined) row.duration_sec = duration;
  return row;
}

/** "2026-07-15" or "15/07/2026" → "2026-07-15". A trailing time (a
 * spreadsheet datetime cell) is ignored. */
function normaliseDate(raw: string): string | null {
  const value = raw.split(/[ T]/)[0];
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return value;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (dmy)
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

/** "9:05" or "09:05:07" → "09:05:07". A leading date (a spreadsheet
 * datetime cell) is ignored. */
function normaliseTime(raw: string): string | null {
  const value = raw.trim().split(/[ T]/).pop()!;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match || Number(match[1]) > 23) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}

/** Delimited text (.csv or .txt — comma, tab or semicolon) → records. */
export function parseCdrCsv(text: string): ParsedBatch {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const delimiter = detectDelimiter(lines[0] ?? "");
  return parseCdrRows(
    lines.map((line) =>
      line.trim() === "" ? [] : splitCsvLine(line, delimiter),
    ),
  );
}

/** Rows of cell text (the first is the header; an empty row is skipped but
 * still counts towards line numbers) → validated records. */
export function parseCdrRows(rows: string[][]): ParsedBatch {
  const kept = rows
    .map((row, index) => ({ row, line: index + 1 }))
    .filter(
      ({ row }, index) => index === 0 || row.some((c) => c.trim() !== ""),
    );
  const lines = kept.map(({ row }) => row);
  const lineNumbers = kept.map(({ line }) => line);

  if (lines.length < 2) {
    return { records: [], rejected: [], totalRows: 0, missingColumns: [] };
  }

  const rawHeaders = lines[0].map((h) => h.trim().toLowerCase());
  const cucm = isCucmExport(rawHeaders);
  const headers = cucm
    ? rawHeaders
    : rawHeaders.map((h) => COLUMN_ALIASES[h] ?? h);
  const missingColumns = cucm
    ? []
    : REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
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

  lines.slice(1).forEach((values, index) => {
    const lineNumber = lineNumbers[index + 1]; // 1-based, as in the file
    const get = (column: string) => {
      const i = headers.indexOf(column);
      const value = i < 0 ? undefined : values[i]?.trim();
      return value === "" ? undefined : value;
    };

    let source: Record<string, string | undefined>;
    if (cucm) {
      const converted = fromCucm(get);
      if (typeof converted === "string") {
        rejected.push({ line: lineNumber, reason: converted });
        return;
      }
      source = converted;
    } else {
      source = Object.fromEntries(CDR_COLUMNS.map((c) => [c, get(c)]));
    }

    const missing = REQUIRED_COLUMNS.filter((c) => source[c] === undefined);
    if (missing.length > 0) {
      rejected.push({
        line: lineNumber,
        reason: `missing ${missing.join(", ")}`,
      });
      return;
    }
    const duration = Number(source.duration_sec);
    if (Number.isNaN(duration)) {
      rejected.push({
        line: lineNumber,
        reason: "duration_sec is not a number",
      });
      return;
    }
    if (duration < 0) {
      rejected.push({ line: lineNumber, reason: "duration_sec is negative" });
      return;
    }
    // The time decides peak or off-peak, so a row without a real one is
    // refused rather than guessed.
    const date = normaliseDate(source.date!);
    const time = normaliseTime(source.orig_time!);
    if (!date || !time) {
      rejected.push({
        line: lineNumber,
        reason: !date
          ? `date "${source.date}" isn't YYYY-MM-DD or DD/MM/YYYY`
          : `time "${source.orig_time}" isn't HH:MM:SS`,
      });
      return;
    }

    const row: Record<string, unknown> = {
      orig: source.orig,
      dest: source.dest,
      duration_sec: duration,
      date,
      orig_time: time,
    };
    const charge = Number(source.charge);
    if (source.charge !== undefined && !Number.isNaN(charge)) {
      row.charge = charge;
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
