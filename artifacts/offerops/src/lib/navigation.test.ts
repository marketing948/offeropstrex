/**
 * Sidebar visibility — the AI Optimizer tab is admin-only.
 * Run: ../api-server/node_modules/.bin/tsx --test src/lib/navigation.test.ts
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getNavigationSections } from "./navigation.ts";

function hasAiOptimizer(isAdmin: boolean): boolean {
  return getNavigationSections(isAdmin).some((s) =>
    s.items.some((i) => i.href === "/ai-optimizer"),
  );
}

describe("AI Optimizer sidebar visibility", () => {
  test("36) worker (non-admin) does not see the AI Optimizer item", () => {
    assert.equal(hasAiOptimizer(false), false);
  });

  test("admin sees the AI Optimizer item under Administration", () => {
    assert.equal(hasAiOptimizer(true), true);
    const admin = getNavigationSections(true);
    const adminSection = admin.find((s) => s.id === "administration");
    assert.ok(adminSection);
    assert.ok(adminSection!.items.some((i) => i.label === "AI Optimizer"));
  });
});
