/**
 * Client-side CSV download. The API has no report-export endpoint, so an
 * export is built from exactly the rows already on screen — which also
 * means the file can never contain more than the viewer is allowed to see.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  const escape = (cell: string | number | null | undefined) => {
    const value = cell ?? "";
    return /[",\n]/.test(String(value))
      ? `"${String(value).replace(/"/g, '""')}"`
      : String(value);
  };

  const csv = [headers, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");

  // Excel reads a bare UTF-8 CSV as Windows-1252 and mangles any non-ASCII
  // name; the BOM is what makes it open correctly.
  const blob = new Blob([`﻿${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
