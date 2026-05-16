import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWorkspaceIdFromBody } from "./parse-workspace-id.ts";

/**
 * Phase 1 (Task #11) regression tests for the body-workspace chokepoint.
 *
 * Every Phase-1 domain insert (offers, batches, todo-tasks, traffic-source-plans,
 * sync trigger) routes its workspaceId through `requireWorkspaceFromBody`,
 * which is a thin async wrapper over `parseWorkspaceIdFromBody` + the
 * workspace-access check. The parsing contract is the part that prevents a
 * caller from skipping or spoofing workspaceId, so we lock it down here.
 *
 * If these tests start failing, every domain insert is at risk of writing
 * into the wrong (or default) workspace.
 */
describe("parseWorkspaceIdFromBody", () => {
  it("rejects an undefined body", () => {
    const r = parseWorkspaceIdFromBody(undefined);
    assert.equal(r.ok, false);
    assert.equal(r.ok ? -1 : r.status, 400);
    assert.match(r.ok ? "" : r.error, /workspaceId is required/);
  });

  it("rejects an empty body object", () => {
    const r = parseWorkspaceIdFromBody({});
    assert.equal(r.ok, false);
    assert.equal(r.ok ? -1 : r.status, 400);
  });

  it("rejects an empty-string workspaceId", () => {
    const r = parseWorkspaceIdFromBody({ workspaceId: "" });
    assert.equal(r.ok, false);
    assert.equal(r.ok ? -1 : r.status, 400);
  });

  it("rejects a null workspaceId", () => {
    const r = parseWorkspaceIdFromBody({ workspaceId: null });
    assert.equal(r.ok, false);
    assert.equal(r.ok ? -1 : r.status, 400);
  });

  it("rejects non-numeric workspaceId", () => {
    const r = parseWorkspaceIdFromBody({ workspaceId: "abc" });
    assert.equal(r.ok, false);
    assert.equal(r.ok ? -1 : r.status, 400);
    assert.match(r.ok ? "" : r.error, /positive integer/);
  });

  it("rejects zero and negative integers", () => {
    for (const bad of [0, -1, -999]) {
      const r = parseWorkspaceIdFromBody({ workspaceId: bad });
      assert.equal(r.ok, false, `expected reject for ${bad}`);
    }
  });

  it("rejects fractional values", () => {
    const r = parseWorkspaceIdFromBody({ workspaceId: 1.5 });
    assert.equal(r.ok, false);
  });

  it("accepts a positive integer workspaceId", () => {
    const r = parseWorkspaceIdFromBody({ workspaceId: 42 });
    assert.equal(r.ok, true);
    assert.equal(r.ok ? r.id : -1, 42);
  });

  it("accepts a numeric-string workspaceId (form encoding)", () => {
    const r = parseWorkspaceIdFromBody({ workspaceId: "7" });
    assert.equal(r.ok, true);
    assert.equal(r.ok ? r.id : -1, 7);
  });

  it("accepts the snake_case alias workspace_id", () => {
    const r = parseWorkspaceIdFromBody({ workspace_id: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.ok ? r.id : -1, 3);
  });

  it("prefers camelCase when both keys are present", () => {
    const r = parseWorkspaceIdFromBody({ workspaceId: 1, workspace_id: 99 });
    assert.equal(r.ok, true);
    assert.equal(r.ok ? r.id : -1, 1);
  });
});
