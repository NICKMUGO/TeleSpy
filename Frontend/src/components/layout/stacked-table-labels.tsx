"use client";

import { useEffect } from "react";

/** On phones, tables marked `data-stack` show each row as a card (see
 * globals.css). Each cell then needs its column's name beside it; this
 * copies the header text onto the cells as data-label, and keeps doing so
 * as rows render or change. */
export function StackedTableLabels() {
  useEffect(() => {
    const label = () => {
      for (const table of document.querySelectorAll<HTMLTableElement>(
        "table[data-stack]",
      )) {
        const names = Array.from(
          table.tHead?.rows[0]?.cells ?? [],
          (cell) => cell.textContent?.trim() ?? "",
        );
        for (const body of table.tBodies) {
          for (const row of body.rows) {
            Array.from(row.cells).forEach((cell, i) => {
              const name = names[i] ?? "";
              if (cell.dataset.label !== name) cell.dataset.label = name;
            });
          }
        }
      }
    };
    label();
    const observer = new MutationObserver(label);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
