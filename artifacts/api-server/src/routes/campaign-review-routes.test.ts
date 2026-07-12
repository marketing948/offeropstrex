/**
 * Route/DB integration tests for the Campaign Review server flows touched by the
 * final hardening pass:
 *   - PATCH /api/campaigns/:id/review-note      (note persistence, latest wins)
 *   - POST  /api/campaigns/:id/mark-reviewed    (reviewed-today persistence)
 *   - GET   /api/campaign-review/reviewed-today
 *   - POST  /api/campaign-review/dismiss        (single + bulk, per-item results)
 *   - GET   /api/campaign-review/dismissed
 *
 * Run against a NON-PRODUCTION database only, e.g.:
 *   ENABLE_VOLUUM=true tsx --test src/routes/campaign-review-routes.test.ts
 * with DATABASE_URL pointing at a disposable local/test database.
 */
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import app from "../app.ts";
import {
  campaignsTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  operationalEventsTable,
  workspacesTable,
} from "@workspace/db";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  createdWorkspaceIds = [];
  createdEmployeeIds = [];
});

afterEach(async () => {
  for (const id of [...createdWorkspaceIds].reverse()) {
    await db.delete(workspacesTable).where(eq(workspacesTable.id, id));
  }
  for (const id of [...createdEmployeeIds].reverse()) {
    await db.delete(employeesTable).where(eq(employeesTable.id, id));
  }
});

async function request(
  method: string,
  path: string,
  employeeId: number,
  body?: Record<string, unknown>,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${authToken(employeeId)}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = { raw: text };
  }
  return { response, json };
}

async function createWorkspace(): Promise<number> {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `CR ${Date.now()}-${Math.random()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws!.id);
  return ws!.id;
}

async function createEmployee(role: "admin" | "employee" = "admin"): Promise<number> {
  const [emp] = await db
    .insert(employeesTable)
    .values({
      name: `CR ${role}`,
      email: `cr-${role}-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "x",
      role,
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(emp!.id);
  return emp!.id;
}

async function assign(employeeId: number, workspaceId: number): Promise<void> {
  await db
    .insert(employeeWorkspaceAssignmentsTable)
    .values({ employeeId, workspaceId, role: "employee" })
    .onConflictDoNothing();
}

async function createCampaign(
  workspaceId: number,
  overrides: Partial<typeof campaignsTable.$inferInsert> = {},
): Promise<number> {
  const [c] = await db
    .insert(campaignsTable)
    .values({
      workspaceId,
      platform: "ios",
      campaignName: `Campaign ${Date.now()}-${Math.random()}`,
      status: "live",
      campaignPurpose: "working",
      ...overrides,
    })
    .returning({ id: campaignsTable.id });
  return c!.id;
}

async function seedAdminWorkspaceCampaign() {
  const workspaceId = await createWorkspace();
  const adminId = await createEmployee("admin");
  await assign(adminId, workspaceId);
  const campaignId = await createCampaign(workspaceId);
  return { workspaceId, adminId, campaignId };
}

describe("Campaign Review — note persistence", { concurrency: false }, () => {
  test("PATCH review-note persists and read returns the latest saved comment", async () => {
    const { workspaceId, adminId, campaignId } = await seedAdminWorkspaceCampaign();

    // A note can only be edited on a campaign with an open review request.
    const requested = await request(
      "POST",
      `/campaigns/${campaignId}/request-review`,
      adminId,
      { workspaceId, note: "first note" },
    );
    assert.equal(requested.response.status === 200 || requested.response.status === 201, true);

    const patched = await request(
      "PATCH",
      `/campaigns/${campaignId}/review-note`,
      adminId,
      { workspaceId, note: "edited note" },
    );
    assert.equal(patched.response.status, 200);

    const open = await request(
      "GET",
      `/campaign-review/open-requests?workspace_id=${workspaceId}`,
      adminId,
    );
    const items = (open.json?.items ?? []) as Array<{ campaignId: number; note: string }>;
    const found = items.find((i) => i.campaignId === campaignId);
    assert.ok(found, "review request should be present");
    assert.equal(found!.note, "edited note");
  });

  test("PATCH review-note allows clearing the comment (empty)", async () => {
    const { workspaceId, adminId, campaignId } = await seedAdminWorkspaceCampaign();
    await request("POST", `/campaigns/${campaignId}/request-review`, adminId, {
      workspaceId,
      note: "temporary",
    });
    const cleared = await request("PATCH", `/campaigns/${campaignId}/review-note`, adminId, {
      workspaceId,
      note: "",
    });
    assert.equal(cleared.response.status, 200);
    const open = await request(
      "GET",
      `/campaign-review/open-requests?workspace_id=${workspaceId}`,
      adminId,
    );
    const items = (open.json?.items ?? []) as Array<{ campaignId: number; note: string }>;
    assert.equal(items.find((i) => i.campaignId === campaignId)!.note, "");
  });

  test("PATCH review-note enforces workspace scoping", async () => {
    const { campaignId } = await seedAdminWorkspaceCampaign();
    const otherWs = await createWorkspace();
    const outsider = await createEmployee("admin");
    await assign(outsider, otherWs);

    const res = await request("PATCH", `/campaigns/${campaignId}/review-note`, outsider, {
      workspaceId: otherWs,
      note: "should fail",
    });
    // campaign not in outsider's workspace → 404
    assert.equal(res.response.status, 404);
  });
});

describe("Campaign Review — mark reviewed", { concurrency: false }, () => {
  test("POST mark-reviewed persists and reviewed-today returns the campaign", async () => {
    const { workspaceId, adminId, campaignId } = await seedAdminWorkspaceCampaign();

    const marked = await request("POST", `/campaigns/${campaignId}/mark-reviewed`, adminId, {
      workspaceId,
    });
    assert.equal(marked.response.status, 200);

    const persisted = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, workspaceId),
          eq(operationalEventsTable.entityType, "campaign"),
          eq(operationalEventsTable.entityId, String(campaignId)),
          eq(operationalEventsTable.eventType, "CAMPAIGN_MARKED_REVIEWED"),
        ),
      );
    assert.equal(persisted.length, 1);

    const today = await request(
      "GET",
      `/campaign-review/reviewed-today?workspace_id=${workspaceId}`,
      adminId,
    );
    const items = (today.json?.items ?? []) as Array<{ campaignId: number }>;
    assert.ok(items.some((i) => i.campaignId === campaignId));
  });

  test("reviewed-today is workspace-isolated", async () => {
    const { workspaceId, adminId, campaignId } = await seedAdminWorkspaceCampaign();
    await request("POST", `/campaigns/${campaignId}/mark-reviewed`, adminId, { workspaceId });

    const otherWs = await createWorkspace();
    const otherAdmin = await createEmployee("admin");
    await assign(otherAdmin, otherWs);

    const today = await request(
      "GET",
      `/campaign-review/reviewed-today?workspace_id=${otherWs}`,
      otherAdmin,
    );
    const items = (today.json?.items ?? []) as Array<{ campaignId: number }>;
    assert.equal(items.some((i) => i.campaignId === campaignId), false);
  });
});

describe("Campaign Review — dismiss (single + bulk)", { concurrency: false }, () => {
  test("bulk dismiss persists events and dismissed read returns them", async () => {
    const { workspaceId, adminId } = await seedAdminWorkspaceCampaign();
    const c1 = await createCampaign(workspaceId);
    const c2 = await createCampaign(workspaceId);

    const res = await request("POST", `/campaign-review/dismiss`, adminId, {
      workspaceId,
      campaignIds: [c1, c2],
      reason: "not actionable",
    });
    assert.equal(res.response.status, 200);
    const results = (res.json?.results ?? []) as Array<{ campaignId: number; ok: boolean }>;
    assert.equal(results.filter((r) => r.ok).length, 2);

    const dismissed = await request(
      "GET",
      `/campaign-review/dismissed?workspace_id=${workspaceId}`,
      adminId,
    );
    const items = (dismissed.json?.items ?? []) as Array<{ campaignId: number }>;
    assert.ok(items.some((i) => i.campaignId === c1));
    assert.ok(items.some((i) => i.campaignId === c2));
  });

  test("single dismiss persists and does not delete the campaign", async () => {
    const { workspaceId, adminId, campaignId } = await seedAdminWorkspaceCampaign();
    const res = await request("POST", `/campaign-review/dismiss`, adminId, {
      workspaceId,
      campaignIds: [campaignId],
    });
    assert.equal(res.response.status, 200);

    const [stillThere] = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId));
    assert.ok(stillThere, "campaign row must not be deleted by dismiss");
  });

  test("partial invalid campaign ids return per-item failures without aborting valid ones", async () => {
    const { workspaceId, adminId } = await seedAdminWorkspaceCampaign();
    const valid = await createCampaign(workspaceId);
    const bogus = 999_000_000;

    const res = await request("POST", `/campaign-review/dismiss`, adminId, {
      workspaceId,
      campaignIds: [valid, bogus],
    });
    assert.equal(res.response.status, 200);
    const results = (res.json?.results ?? []) as Array<{
      campaignId: number;
      ok: boolean;
      error?: string;
    }>;
    assert.equal(results.find((r) => r.campaignId === valid)!.ok, true);
    assert.equal(results.find((r) => r.campaignId === bogus)!.ok, false);
  });

  test("cannot dismiss a campaign from another workspace", async () => {
    const { campaignId } = await seedAdminWorkspaceCampaign();
    const otherWs = await createWorkspace();
    const otherAdmin = await createEmployee("admin");
    await assign(otherAdmin, otherWs);

    const res = await request("POST", `/campaign-review/dismiss`, otherAdmin, {
      workspaceId: otherWs,
      campaignIds: [campaignId],
    });
    // valid workspace access, but campaign not in that workspace → per-item failure
    const results = (res.json?.results ?? []) as Array<{ campaignId: number; ok: boolean }>;
    assert.equal(results.find((r) => r.campaignId === campaignId)!.ok, false);
  });

  test("new review request after dismissal makes the item eligible again (event trail)", async () => {
    const { workspaceId, adminId, campaignId } = await seedAdminWorkspaceCampaign();

    await request("POST", `/campaign-review/dismiss`, adminId, {
      workspaceId,
      campaignIds: [campaignId],
    });

    // A brand new review request is a newer relevant signal than the dismissal.
    const requested = await request(
      "POST",
      `/campaigns/${campaignId}/request-review`,
      adminId,
      { workspaceId, note: "please re-check" },
    );
    assert.equal(requested.response.status === 200 || requested.response.status === 201, true);

    const dismissedRows = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, workspaceId),
          eq(operationalEventsTable.entityId, String(campaignId)),
          eq(operationalEventsTable.eventType, "CAMPAIGN_REVIEW_DISMISSED"),
        ),
      );
    const requestRows = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, workspaceId),
          eq(operationalEventsTable.entityId, String(campaignId)),
          eq(operationalEventsTable.eventType, "CAMPAIGN_REVIEW_REQUESTED"),
        ),
      );
    assert.equal(dismissedRows.length, 1);
    assert.equal(requestRows.length, 1);
    // newer request occurs strictly after the dismissal → reappears per read rule
    assert.equal(
      requestRows[0]!.createdAt.getTime() >= dismissedRows[0]!.createdAt.getTime(),
      true,
    );
  });
});
