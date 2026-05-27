import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import app from "../app.ts";
import {
  affiliateNetworksTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  geosTable,
  operationalEventsTable,
  testingBatchesTable,
  workerAffiliateNetworksTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import {
  BATCH_CREATED_PAYLOAD_KEYS,
} from "../lib/campaignops-operational-events.ts";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS operational_events (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      event_type text NOT NULL,
      actor_type text NOT NULL DEFAULT 'system',
      actor_id text,
      source text NOT NULL,
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS operational_events_workspace_created_at_idx
      ON operational_events (workspace_id, created_at, id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS operational_events_workspace_entity_idx
      ON operational_events (workspace_id, entity_type, entity_id, created_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS operational_events_workspace_event_type_idx
      ON operational_events (workspace_id, event_type, created_at)
  `);

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
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { response, json: json as Record<string, unknown> };
}

async function createWorkspace(name: string): Promise<number> {
  const [workspace] = await db
    .insert(workspacesTable)
    .values({
      name: `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      isActive: false,
    })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(workspace.id);
  return workspace.id;
}

async function createEmployee(role: "admin" | "employee" = "employee"): Promise<number> {
  const [employee] = await db
    .insert(employeesTable)
    .values({
      name: `CampaignOps Ops ${Date.now()}`,
      email: `campaignops-ops-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
      passwordHash: "x",
      role,
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(employee.id);
  return employee.id;
}

async function assign(employeeId: number, workspaceId: number): Promise<void> {
  await db
    .insert(employeeWorkspaceAssignmentsTable)
    .values({ employeeId, workspaceId, role: "employee" })
    .onConflictDoNothing();
}

function assertSafeOperationalPayload(
  payload: unknown,
  allowedKeys: readonly string[],
): void {
  assert.ok(payload !== null && typeof payload === "object");
  const record = payload as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    assert.ok(
      (allowedKeys as readonly string[]).includes(key),
      `unexpected payload key: ${key}`,
    );
    const value = record[key];
    assert.ok(
      typeof value === "number" || typeof value === "string",
      `unexpected value type for ${key}`,
    );
    if (typeof value === "string") {
      assert.ok(!value.includes("http"), `suspicious string in ${key}`);
      assert.ok(!value.includes("token"), `suspicious string in ${key}`);
    }
  }
}

describe("CampaignOps boundary operational events", { concurrency: false }, () => {
  test("POST /testing-batches records BATCH_CREATED with safe payload", async () => {
    const workspaceId = await createWorkspace("batch-created");
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);

    const [network] = await db
      .insert(affiliateNetworksTable)
      .values({ workspaceId, name: `Network ${Date.now()}`, isActive: true })
      .returning({ id: affiliateNetworksTable.id });
    await db.insert(workerAffiliateNetworksTable).values({
      workspaceId,
      employeeId,
      affiliateNetworkId: network.id,
    });
    const [geo] = await db
      .insert(geosTable)
      .values({
        workspaceId,
        code: `G${Math.floor(Math.random() * 90 + 10)}`,
        name: "Geo",
        isActive: true,
      })
      .returning({ id: geosTable.id });
    const [source] = await db
      .insert(workspaceTrafficSourcesTable)
      .values({ workspaceId, name: `Source ${Date.now()}`, position: 1, isActive: true })
      .returning({ id: workspaceTrafficSourcesTable.id });

    const batchTag = `ops_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const { response, json } = await request("POST", "/testing-batches", employeeId, {
      workspaceId,
      assignedWorkerId: employeeId,
      batchName: `Ops Batch ${Date.now()}`,
      affiliateNetworkId: network.id,
      geoId: geo.id,
      trafficSourceId: source.id,
      batchTag,
      numberOfOffers: 3,
    });

    assert.equal(response.status, 201);
    const batchId = json.id as number;

    const events = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, workspaceId),
          eq(operationalEventsTable.eventType, "BATCH_CREATED"),
          eq(operationalEventsTable.entityId, String(batchId)),
        ),
      );
    assert.equal(events.length, 1);
    assert.equal(events[0]?.entityType, "batch");
    assert.equal(events[0]?.source, "routes.testing-batches");
    assertSafeOperationalPayload(events[0]?.payloadJson, BATCH_CREATED_PAYLOAD_KEYS);
    assert.deepEqual(events[0]?.payloadJson, {
      batchId,
      workspaceId,
      employeeId,
      initialTrafficSourceId: source.id,
      trafficSourceStep: 0,
      offerCount: 3,
    });

    const [batch] = await db
      .select({ id: testingBatchesTable.id })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, batchId));
    assert.ok(batch);
  });
});
