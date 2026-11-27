import { describe, expect, it } from "vitest";
import { parseCdrCsv } from "./cdr-parser";

describe("parseCdrCsv", () => {
  it("reads a converted CDR and tidies its date and time", () => {
    const batch = parseCdrCsv(
      "orig,dest,duration_sec,date,orig_time\n201,90712345678,65,15/07/2026,9:05\n",
    );
    expect(batch.rejected).toEqual([]);
    expect(batch.records).toEqual([
      {
        orig: "201",
        dest: "90712345678",
        duration_sec: 65,
        date: "2026-07-15",
        orig_time: "09:05:00",
      },
    ]);
  });

  it("accepts the carrier's other column spellings", () => {
    const batch = parseCdrCsv(
      "Orig.,Dest.,Duration (sec),Date,Orig. Time\n201,202,10,2026-07-15,10:00:00\n",
    );
    expect(batch.missingColumns).toEqual([]);
    expect(batch.records).toHaveLength(1);
  });

  it("refuses a row without a usable time instead of guessing one", () => {
    const batch = parseCdrCsv(
      "orig,dest,duration_sec,date,orig_time\n201,202,10,2026-07-15,\n201,202,10,2026-07-15,25:00\n",
    );
    expect(batch.records).toEqual([]);
    expect(batch.rejected.map((r) => r.line)).toEqual([2, 3]);
  });

  it("converts a raw Cisco export: answer time, Nairobi clock, final number", () => {
    // Off-hook at 03:07:59 UTC, answered at 03:08:08 UTC (06:08:08 in
    // Nairobi), forwarded from 201 to 383.
    const batch = parseCdrCsv(
      "dateTimeOrigination,callingPartyNumber,originalCalledPartyNumber,finalCalledPartyNumber,dateTimeConnect,duration\n" +
        "1780715279,389,201,383,1780715288,14\n" +
        "1780715279,389,201,,0,0\n",
    );
    expect(batch.records).toEqual([
      {
        orig: "389",
        dest: "383",
        duration_sec: 14,
        date: "2026-06-06",
        orig_time: "06:08:08",
      },
      // Never answered: keeps its off-hook time, and the number dialled.
      {
        orig: "389",
        dest: "201",
        duration_sec: 0,
        date: "2026-06-06",
        orig_time: "06:07:59",
      },
    ]);
  });

  it("reads tab- and semicolon-delimited text exports", () => {
    for (const d of ["\t", ";"]) {
      const batch = parseCdrCsv(
        ["orig", "dest", "duration_sec", "date", "orig_time"].join(d) +
          "\n" +
          ["201", "202", "10", "2026-07-15", "10:00"].join(d) +
          "\n",
      );
      expect(batch.missingColumns).toEqual([]);
      expect(batch.records).toHaveLength(1);
    }
  });

  it("ignores a byte-order mark before the header", () => {
    const batch = parseCdrCsv(
      "\uFEFForig,dest,duration_sec,date,orig_time\n201,202,10,2026-07-15,10:00\n",
    );
    expect(batch.missingColumns).toEqual([]);
  });
});

describe("line numbers", () => {
  it("reports a rejected row by its line in the file, blank lines included", () => {
    const batch = parseCdrCsv(
      "orig,dest,duration_sec,date,orig_time\n201,202,10,2026-07-15,10:00\n\n201,202,x,2026-07-15,10:00\n",
    );
    expect(batch.records).toHaveLength(1);
    expect(batch.rejected.map((r) => r.line)).toEqual([4]);
  });
});
