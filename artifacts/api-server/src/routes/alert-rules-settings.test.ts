import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app.ts";
import {
  ALERT_RULES_SETTINGS_KEY,
  DEFAULT_ALERT_RULES,
} from "@workspace/alert-rules";
import {
  db,
  employeesTable,
  employeeWorkspaceAssignmentsTable,
  settingsTable,
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
  if (createdWorkspaceIds.length > 0) {
    await db.delete(settingsTable).where(inArray(settingsTable.workspaceId, createdWorkspaceIds));
    await db
      .delete(employeeWorkspaceAssignmentsTable)
      .where(inArray(employeeWorkspaceAssignmentsTable.workspaceId, createdWorkspaceIds));
  }
  for (const id of [...createdWorkspaceIds].reverse()) {
    await db.delete(workspacesTable).where(eq(workspacesTable.id, id));
  }
  for (const id of [...createdEmployeeIds].reverse()) {
    await db
      .delete(employeeWorkspaceAssignmentsTable)
      .where(eq(employeeWorkspaceAssignmentsTable.employeeId, id));
    await db.delete(employeesTable).where(eq(employeesTable.id, id));
  }
});



async function request(
  method: string,
  path: string,
  employeeId: number,
  body?: unknown,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${authToken(employeeId)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { response, json: json as Record<string, unknown> | null };
}

async function createWorkspace(name: string): Promise<number> {
  const [workspace] = await db
    .insert(workspacesTable)
    .values({
      name: `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      isDefault: false,
      isActive: false,
    })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(workspace.id);
  return workspace.id;
}

async function createEmployee(role: "admin" | "employee"): Promise<number> {
  const [employee] = await db
    .insert(employeesTable)
    .values({
      name: `Alert Rules ${Date.now()}`,
      email: `alert-rules-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
      passwordHash: "x",
      role,
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(employee.id);
  return employee.id;
}

async function assign(
  employeeId: number,
  workspaceId: number,
  role = "employee",
): Promise<void> {
  await db
    .insert(employeeWorkspaceAssignmentsTable)
    .values({ employeeId, workspaceId, role })
    .onConflictDoNothing();
}

async function seedWorkspace() {
  const workspaceId = await createWorkspace("alert-rules");
  const adminId = await createEmployee("admin");
  const workerId = await createEmployee("employee");
  await assign(adminId, workspaceId, "admin");
  await assign(workerId, workspaceId);
  return { workspaceId, adminId, workerId };
}

function assertDefaultShape(json: Record<string, unknown>) {
  assert.equal(json.testing && (json.testing as { visitsPerOffer: number }).visitsPerOffer, 15_000);
  assert.deepEqual(
    (json.testing as { trafficMilestonePercents: number[] }).trafficMilestonePercents,
    [50, 75, 100],
  );
  assert.equal(json.review && (json.review as { ignoredSignalEscalationHours: number }).ignoredSignalEscalationHours, 4);
  assert.equal(json.scaling && (json.scaling as { noConversionsAfterHours: number }).noConversionsAfterHours, 48);
}

describe("alert rules settings", { concurrency: false }, () => {
  test("GET returns defaults when no config exists", async () => {
    const seed = await seedWorkspace();

    const { response, json } = await request(
      "GET",
      `/settings/alert-rules?workspace_id=${seed.workspaceId}`,
      seed.workerId,
    );

    assert.equal(response.status, 200);
    assert.ok(json);
    assertDefaultShape(json);

    const rows = await db
      .select()
      .from(settingsTable)
      .where(
        and(
          eq(settingsTable.workspaceId, seed.workspaceId),
          eq(settingsTable.key, ALERT_RULES_SETTINGS_KEY),
        ),
      );
    assert.equal(rows.length, 0);
  });

  test("PATCH is admin-only and rejects non-admin workers", async () => {
    const seed = await seedWorkspace();

    const workerPatch = await request("PATCH", "/settings/alert-rules", seed.workerId, {
      workspaceId: seed.workspaceId,
      testing: { visitsPerOffer: 20_000 },
    });
    assert.equal(workerPatch.response.status, 403);
    assert.match(String(workerPatch.json?.error ?? ""), /admin/i);
  });

  test("PATCH requires workspace membership even for admins", async () => {
    const seed = await seedWorkspace();
    const foreignWorkspaceId = await createWorkspace("foreign-alert-rules");

    const denied = await request("PATCH", "/settings/alert-rules", seed.adminId, {
      workspaceId: foreignWorkspaceId,
      testing: { visitsPerOffer: 20_000 },
    });
    assert.equal(denied.response.status, 403);
    assert.match(String(denied.json?.error ?? ""), /not a member/i);
  });

  test("PATCH with partial config merges safely with defaults and is workspace-scoped", async () => {
    const seed = await seedWorkspace();
    const otherWorkspaceId = await createWorkspace("other-alert-rules");
    await assign(seed.adminId, otherWorkspaceId, "admin");

    const updated = await request("PATCH", "/settings/alert-rules", seed.adminId, {
      workspaceId: seed.workspaceId,
      testing: { visitsPerOffer: 20_000 },
      review: { dismissalSnoozeHours: 12 },
    });

    assert.equal(updated.response.status, 200);
    assert.ok(updated.json);
    assert.equal(
      (updated.json!.testing as { visitsPerOffer: number }).visitsPerOffer,
      20_000,
    );
    assert.equal(
      (updated.json!.review as { dismissalSnoozeHours: number }).dismissalSnoozeHours,
      12,
    );
    assert.equal(
      (updated.json!.scaling as { noConversionsAfterHours: number }).noConversionsAfterHours,
      DEFAULT_ALERT_RULES.scaling.noConversionsAfterHours,
    );

    const otherGet = await request(
      "GET",
      `/settings/alert-rules?workspace_id=${otherWorkspaceId}`,
      seed.adminId,
    );
    assert.equal(otherGet.response.status, 200);
    assertDefaultShape(otherGet.json!);

    const rows = await db
      .select()
      .from(settingsTable)
      .where(
        and(
          eq(settingsTable.workspaceId, seed.workspaceId),
          eq(settingsTable.key, ALERT_RULES_SETTINGS_KEY),
        ),
      );
    assert.equal(rows.length, 1);
    const stored = JSON.parse(rows[0]!.value!);
    assert.equal(stored.testing.visitsPerOffer, 20_000);
  });

  test("GET returns saved config after PATCH", async () => {
    const seed = await seedWorkspace();

    const patch = await request("PATCH", "/settings/alert-rules", seed.adminId, {
      workspaceId: seed.workspaceId,
      winners: { minRoiPercentForLikelyWinner: 12 },
    });
    assert.equal(patch.response.status, 200);

    const get = await request(
      "GET",
      `/settings/alert-rules?workspace_id=${seed.workspaceId}`,
      seed.workerId,
    );
    assert.equal(get.response.status, 200);
    assert.equal(
      (get.json!.winners as { minRoiPercentForLikelyWinner: number }).minRoiPercentForLikelyWinner,
      12,
    );
    assert.equal(
      (get.json!.testing as { visitsPerOffer: number }).visitsPerOffer,
      DEFAULT_ALERT_RULES.testing.visitsPerOffer,
    );
  });

  test("invalid merged config is coerced to full defaults on PATCH (200, not 400)", async () => {
    const seed = await seedWorkspace();

    const invalid = await request("PATCH", "/settings/alert-rules", seed.adminId, {
      workspaceId: seed.workspaceId,
      testing: { visitsPerOffer: -1 },
    });

    assert.equal(invalid.response.status, 200);
    assert.ok(invalid.json);
    assertDefaultShape(invalid.json!);

    const get = await request(
      "GET",
      `/settings/alert-rules?workspace_id=${seed.workspaceId}`,
      seed.adminId,
    );
    assert.equal(get.response.status, 200);
    assert.equal(
      (get.json!.testing as { visitsPerOffer: number }).visitsPerOffer,
      DEFAULT_ALERT_RULES.testing.visitsPerOffer,
    );
  });

  test("GET falls back to defaults when stored JSON is corrupt", async () => {
    const seed = await seedWorkspace();

    await db.insert(settingsTable).values({
      workspaceId: seed.workspaceId,
      key: ALERT_RULES_SETTINGS_KEY,
      value: "{not-json",
    });

    const { response, json } = await request(
      "GET",
      `/settings/alert-rules?workspace_id=${seed.workspaceId}`,
      seed.adminId,
    );

    assert.equal(response.status, 200);
    assert.ok(json);
    assertDefaultShape(json!);
  });

  test("PATCH rejects missing workspaceId", async () => {
    const seed = await seedWorkspace();

    const bad = await request("PATCH", "/settings/alert-rules", seed.adminId, {
      testing: { visitsPerOffer: 20_000 },
    });
    assert.equal(bad.response.status, 400);
    assert.match(String(bad.json?.error ?? ""), /workspaceId/i);
  });
});
