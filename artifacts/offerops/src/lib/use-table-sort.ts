/**
 * Shared client-side table sorting primitives.
 *
 * Extracted so every client-side OfferOps table (reports tabs, ops
 * drilldown, live-campaigns summary) shares the same toggle semantics and
 * visual sort indicator:
 *   - first click on a column  -> sort DESC by that column
 *   - click the active column  -> flip ASC/DESC
 *   - default direction is DESC (numeric metrics read best high-to-low)
 *
 * This is purely client-side. Server-paginated tables that need a true
 * global sort must push sort state into their query params instead.
 */
import { useState } from "react";

export type SortDir = "asc" | "desc";

export type TableSort = {
  col: string;
  dir: SortDir;
  toggle: (col: string) => void;
};

export function useTableSort(defaultCol: string, defaultDir: SortDir = "desc"): TableSort {
  const [col, setCol] = useState(defaultCol);
  const [dir, setDir] = useState<SortDir>(defaultDir);
  function toggle(next: string) {
    if (next === col) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setCol(next);
      setDir("desc");
    }
  }
  return { col, dir, toggle };
}

type SortValue = number | string | null | undefined;

/**
 * Stable-ish sort by a column. `accessor` lets callers sort by a computed
 * value (e.g. a metric merged in from a separate query) rather than a plain
 * object key. Nullish values sort as 0 / empty string so they sink to the
 * bottom of a DESC sort.
 */
export function sortRows<T>(
  rows: readonly T[],
  col: string,
  dir: SortDir,
  accessor?: (row: T, col: string) => SortValue,
): T[] {
  const read = (row: T): SortValue =>
    accessor ? accessor(row, col) : (row as Record<string, unknown>)[col] as SortValue;
  return [...rows].sort((a, b) => {
    const av = read(a);
    const bv = read(b);
    if (typeof av === "string" || typeof bv === "string") {
      const as = (av ?? "") as string;
      const bs = (bv ?? "") as string;
      return dir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    }
    const an = (av ?? 0) as number;
    const bn = (bv ?? 0) as number;
    return dir === "asc" ? an - bn : bn - an;
  });
}
