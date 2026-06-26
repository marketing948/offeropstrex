// Pure-logic tests for the shared table sort helper. The offerops package has
// no bundled test runner, so run directly: `tsx --test src/lib/use-table-sort.test.ts`.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { sortRows } from "./use-table-sort.ts";

type Row = { name: string; visits: number; profit: number | null };

const rows: Row[] = [
  { name: "b", visits: 10, profit: 5 },
  { name: "a", visits: 30, profit: -1 },
  { name: "c", visits: 20, profit: null },
];

describe("sortRows", () => {
  test("numeric DESC (default metric ordering)", () => {
    const out = sortRows(rows, "visits", "desc");
    assert.deepEqual(out.map((r) => r.visits), [30, 20, 10]);
  });

  test("numeric ASC", () => {
    const out = sortRows(rows, "visits", "asc");
    assert.deepEqual(out.map((r) => r.visits), [10, 20, 30]);
  });

  test("nullish values sort as 0", () => {
    const out = sortRows(rows, "profit", "desc");
    // 5, 0(null), -1
    assert.deepEqual(out.map((r) => r.profit), [5, null, -1]);
  });

  test("string columns use localeCompare", () => {
    const out = sortRows(rows, "name", "asc");
    assert.deepEqual(out.map((r) => r.name), ["a", "b", "c"]);
  });

  test("accessor supports computed sort keys", () => {
    const out = sortRows(rows, "score", "desc", (r) => r.visits + (r.profit ?? 0));
    // a: 29, c: 20, b: 15
    assert.deepEqual(out.map((r) => r.name), ["a", "c", "b"]);
  });

  test("does not mutate the input array", () => {
    const snapshot = rows.map((r) => r.name);
    sortRows(rows, "visits", "desc");
    assert.deepEqual(rows.map((r) => r.name), snapshot);
  });
});
