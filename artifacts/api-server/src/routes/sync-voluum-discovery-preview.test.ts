import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import app from "../app.ts";
import {
  db,
  employeesTable,
  employeeWorkspaceAssignmentsTable,
  eventsTable,
  operationalEventsTable,
  performanceTable,
  testingBatchesTable,
  todoTasksTable,
  voluumAffiliateNetworksTable,
  voluumTrafficSourcesTable,
  workspacesTable,
} from "@workspace/db";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

const VOLUUM_AUTH_URL = "https://api.voluum.com/auth/access/session";
const originalEnableVoluum = process.env["ENABLE_VOLUUM"];
const originalEnableVoluumDryRun = process.env["ENABLE_VOLUUM_DRY_RUN"];
const originalFetch = globalThis.fetch;
let voluumFetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let voluumFetchMock: ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>) | null = null;

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
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  restoreEnv();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  process.env["ENABLE_VOLUUM"] = "false";
  delete process.env["ENABLE_VOLUUM_DRY_RUN"];
  createdWorkspaceIds = [];
  createdEmployeeIds = [];
  voluumFetchCalls = [];
  voluumFetchMock = null;
  globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.voluum.com")) {
      voluumFetchCalls.push({ url, init });
      if (!voluumFetchMock) {
        throw new Error(`Unexpected Voluum request in test: ${url}`);
      }
      return voluumFetchMock(input, init);
    }
    return originalFetch(input, init);
  };
});

afterEach(async () => {
  restoreEnv();
  globalThis.fetch = originalFetch;

  for (const id of [...createdWorkspaceIds].reverse()) {
    await db.delete(employeeWorkspaceAssignmentsTable).where(eq(employeeWorkspaceAssignmentsTable.workspaceId, id));
    await db.delete(workspacesTable).where(eq(workspacesTable.id, id));
  }
  for (const id of [...createdEmployeeIds].reverse()) {
    await db.delete(employeeWorkspaceAssignmentsTable).where(eq(employeeWorkspaceAssignmentsTable.employeeId, id));
    await db.delete(employeesTable).where(eq(employeesTable.id, id));
  }
});

function restoreEnv(): void {
  setOrDeleteEnv("ENABLE_VOLUUM", originalEnableVoluum);
  setOrDeleteEnv("ENABLE_VOLUUM_DRY_RUN", originalEnableVoluumDryRun);
}

function setOrDeleteEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}



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
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { response, json };
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

async function createEmployee(role: "admin" | "employee" = "employee"): Promise<number> {
  const [employee] = await db
    .insert(employeesTable)
    .values({
      name: `Voluum Preview ${Date.now()}`,
      email: `voluum-preview-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
      passwordHash: "x",
      role,
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(employee.id);
  return employee.id;
}

async function assign(employeeId: number, workspaceId: number, role = "employee"): Promise<void> {
  await db
    .insert(employeeWorkspaceAssignmentsTable)
    .values({ employeeId, workspaceId, role })
    .onConflictDoNothing();
}

async function seedWorkspaceAccess(role: "admin" | "employee" = "employee") {
  const workspaceId = await createWorkspace("voluum-discovery-preview");
  const employeeId = await createEmployee(role);
  await assign(employeeId, workspaceId, role);
  return { workspaceId, employeeId };
}

async function setWorkspaceVoluumCredentials(workspaceId: number, credentials: {
  accessId?: string | null;
  accessKey?: string | null;
  apiBaseUrl?: string | null;
  voluumWorkspaceId?: string | null;
}): Promise<void> {
  await db
    .update(workspacesTable)
    .set({
      voluumAccessId: credentials.accessId ?? null,
      voluumAccessKey: credentials.accessKey ?? null,
      voluumApiBaseUrl: credentials.apiBaseUrl ?? null,
      voluumWorkspaceId: credentials.voluumWorkspaceId ?? null,
    })
    .where(eq(workspacesTable.id, workspaceId));
}

async function eventCount(workspaceId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(eventsTable)
    .where(eq(eventsTable.workspaceId, workspaceId));
  return row?.count ?? 0;
}

async function operationalEvents(workspaceId: number, eventType: string) {
  return db
    .select()
    .from(operationalEventsTable)
    .where(
      eq(operationalEventsTable.workspaceId, workspaceId),
    )
    .then((rows) => rows.filter((row) => row.eventType === eventType));
}

async function writeCounts(workspaceId: number): Promise<{ batches: number; tasks: number; performance: number }> {
  const [batches] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(testingBatchesTable)
    .where(eq(testingBatchesTable.workspaceId, workspaceId));
  const [tasks] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(todoTasksTable)
    .where(eq(todoTasksTable.workspaceId, workspaceId));
  const [performance] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(performanceTable)
    .innerJoin(testingBatchesTable, eq(performanceTable.batchId, testingBatchesTable.id))
    .where(eq(testingBatchesTable.workspaceId, workspaceId));

  return {
    batches: batches?.count ?? 0,
    tasks: tasks?.count ?? 0,
    performance: performance?.count ?? 0,
  };
}

function mockVoluumAuth(response: Response): void {
  voluumFetchMock = async () => response;
}

function mockVoluumDiscoveryMetadata(options: {
  auth?: Response;
  trafficSources?: Response;
  affiliateNetworks?: Response;
} = {}): void {
  voluumFetchMock = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const pathname = new URL(url).pathname;

    if (pathname === "/auth/access/session") {
      return options.auth ?? new Response(JSON.stringify({ token: "voluum-session-token" }), { status: 200 });
    }
    if (pathname === "/traffic-source") {
      return options.trafficSources ?? new Response(JSON.stringify({ trafficSources: [] }), { status: 200 });
    }
    if (pathname === "/affiliate-network") {
      return options.affiliateNetworks ?? new Response(JSON.stringify({ affiliateNetworks: [] }), { status: 200 });
    }

    throw new Error(`Unexpected Voluum request in test: ${url}`);
  };
}

function assertOnlyVoluumAuthWasCalled(): void {
  assert.deepEqual(voluumFetchCalls.map((call) => call.url), [VOLUUM_AUTH_URL]);
  for (const call of voluumFetchCalls) {
    assert.equal(call.init?.method, "POST");
  }
}

function assertNoForbiddenVoluumEndpointsWereCalled(): void {
  for (const call of voluumFetchCalls) {
    const pathname = new URL(call.url).pathname;
    assert.notEqual(pathname, "/offer");
    assert.notEqual(pathname, "/campaign");
    assert.notEqual(pathname, "/report");
  }
}

function assertOnlyVoluumAuthAndMetadataWereCalled(): void {
  assert.deepEqual(voluumFetchCalls.map((call) => new URL(call.url).pathname), [
    "/auth/access/session",
    "/traffic-source",
    "/affiliate-network",
  ]);
  assert.equal(voluumFetchCalls[0]?.init?.method, "POST");
  assert.equal(voluumFetchCalls[1]?.init?.method, undefined);
  assert.equal(voluumFetchCalls[2]?.init?.method, undefined);
  assertNoForbiddenVoluumEndpointsWereCalled();
}

async function voluumMetadataCounts(workspaceId: number): Promise<{ trafficSources: number; affiliateNetworks: number }> {
  const [trafficSources] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(voluumTrafficSourcesTable)
    .where(eq(voluumTrafficSourcesTable.workspaceId, workspaceId));
  const [affiliateNetworks] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(voluumAffiliateNetworksTable)
    .where(eq(voluumAffiliateNetworksTable.workspaceId, workspaceId));

  return {
    trafficSources: trafficSources?.count ?? 0,
    affiliateNetworks: affiliateNetworks?.count ?? 0,
  };
}

describe("Voluum discovery preview dry-run route", { concurrency: false }, () => {
  test("is disabled unless ENABLE_VOLUUM_DRY_RUN=true", async () => {
    const { workspaceId, employeeId } = await seedWorkspaceAccess();

    const globallyDisabled = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });

    assert.equal(globallyDisabled.response.status, 410);
    assert.equal(globallyDisabled.json.error, "voluum_disabled");

    process.env["ENABLE_VOLUUM"] = "true";
    const dryRunDisabled = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });

    assert.equal(dryRunDisabled.response.status, 410);
    assert.equal(dryRunDisabled.json.error, "voluum_dry_run_disabled");
  });

  test("can be enabled while ENABLE_VOLUUM=false and reports missing credentials safely", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess();

    const { response, json } = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });

    assert.equal(response.status, 200);
    assert.deepEqual(json, {
      mode: "dry_run",
      workspaceId,
      enabled: true,
      credentials: {
        valid: false,
        code: "VOLUUM_CREDENTIALS_MISSING",
      },
      trafficSources: [],
      affiliateNetworks: [],
      summary: {
        trafficSourcesFound: 0,
        affiliateNetworksFound: 0,
      },
      sideEffects: {
        metadataFetches: false,
        dbWrites: false,
        events: false,
        tasks: false,
        batches: false,
      },
    });
    assert.equal(voluumFetchCalls.length, 0);
  });

  test("returns safe auth failure for invalid credentials", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess();
    await setWorkspaceVoluumCredentials(workspaceId, {
      accessId: "invalid-access-id",
      accessKey: "invalid-access-key",
      voluumWorkspaceId: "workspace-1",
    });
    mockVoluumAuth(new Response(JSON.stringify({
      error: "invalid invalid-access-key raw-provider-secret-token",
    }), {
      status: 401,
      headers: { "www-authenticate": "Bearer raw-provider-secret-token" },
    }));

    const { response, json } = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });

    assert.equal(response.status, 200);
    assert.deepEqual(json.credentials, {
      valid: false,
      code: "VOLUUM_AUTH_FAILED",
    });
    assert.deepEqual(json.trafficSources, []);
    assert.deepEqual(json.affiliateNetworks, []);
    assert.deepEqual(json.summary, {
      trafficSourcesFound: 0,
      affiliateNetworksFound: 0,
    });
    assert.equal(json.sideEffects.metadataFetches, false);
    assertOnlyVoluumAuthWasCalled();
  });

  test("returns normalized traffic source and affiliate network previews for valid mocked credentials", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess();
    await setWorkspaceVoluumCredentials(workspaceId, {
      accessId: "valid-access-id",
      accessKey: "valid-access-key",
      voluumWorkspaceId: "workspace-1",
    });
    mockVoluumDiscoveryMetadata({
      trafficSources: new Response(JSON.stringify({
        trafficSources: [
          {
            id: "ts-1",
            name: "Meta Source",
            status: "ACTIVE",
            active: true,
            workspaceId: "workspace-1",
            secret: "raw-source-secret",
          },
          {
            trafficSourceId: "ts-2",
            trafficSourceName: { name: "Secondary Source" },
            enabled: "false",
            workspace: { id: "workspace-1" },
            extraPayload: { nested: "not returned" },
          },
        ],
      }), { status: 200 }),
      affiliateNetworks: new Response(JSON.stringify({
        affiliateNetworks: [
          {
            id: "an-1",
            name: "Meta Network",
            status: "ACTIVE",
            archived: false,
            workspace_id: "workspace-1",
            accessKey: "raw-network-secret",
          },
        ],
      }), { status: 200 }),
    });

    const { response, json } = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });

    assert.equal(response.status, 200);
    assert.deepEqual(json.credentials, { valid: true });
    assert.deepEqual(json.trafficSources, [
      {
        id: "ts-1",
        name: "Meta Source",
        status: "ACTIVE",
        active: true,
        archived: null,
      },
      {
        id: "ts-2",
        name: "Secondary Source",
        status: null,
        active: false,
        archived: null,
      },
    ]);
    assert.deepEqual(json.affiliateNetworks, [
      {
        id: "an-1",
        name: "Meta Network",
        status: "ACTIVE",
        active: null,
        archived: false,
      },
    ]);
    assert.deepEqual(json.summary, {
      trafficSourcesFound: 2,
      affiliateNetworksFound: 1,
    });
    assert.deepEqual(json.sideEffects, {
      metadataFetches: true,
      dbWrites: false,
      events: false,
      tasks: false,
      batches: false,
    });
    const serialized = JSON.stringify(json);
    assert.equal(serialized.includes("raw-source-secret"), false);
    assert.equal(serialized.includes("raw-network-secret"), false);
    assert.equal(serialized.includes("extraPayload"), false);
    assertOnlyVoluumAuthAndMetadataWereCalled();
  });

  test("records sanitized SYNC_PREVIEW_RUN operational event after preview succeeds", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess();
    await setWorkspaceVoluumCredentials(workspaceId, {
      accessId: "valid-access-id",
      accessKey: "valid-access-key",
      voluumWorkspaceId: "workspace-1",
    });
    mockVoluumDiscoveryMetadata({
      trafficSources: new Response(JSON.stringify({
        trafficSources: [{ id: "ts-1", name: "Meta Source", secret: "raw-source-secret" }],
      }), { status: 200 }),
      affiliateNetworks: new Response(JSON.stringify({
        affiliateNetworks: [{ id: "an-1", name: "Meta Network", accessKey: "raw-network-secret" }],
      }), { status: 200 }),
    });

    const { response } = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });

    assert.equal(response.status, 200);
    const events = await operationalEvents(workspaceId, "SYNC_PREVIEW_RUN");
    assert.equal(events.length, 1);
    assert.equal(events[0]!.entityType, "sync_preview");
    assert.equal(events[0]!.entityId, `workspace:${workspaceId}`);
    assert.equal(events[0]!.actorType, "employee");
    assert.equal(events[0]!.actorId, String(employeeId));
    assert.equal(events[0]!.source, "sync.voluum.discovery-preview");
    assert.deepEqual(events[0]!.payloadJson, {
      credentialsValid: true,
      credentialCode: null,
      trafficSourcesFound: 1,
      affiliateNetworksFound: 1,
      metadataFetches: true,
      warnings: [],
    });
    const serialized = JSON.stringify(events[0]);
    assert.equal(serialized.includes("valid-access-key"), false);
    assert.equal(serialized.includes("voluum-session-token"), false);
    assert.equal(serialized.includes("raw-source-secret"), false);
    assert.equal(serialized.includes("raw-network-secret"), false);
  });

  test("response does not include secrets, tokens, headers, or raw provider errors", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess();
    await setWorkspaceVoluumCredentials(workspaceId, {
      accessId: "secret-access-id",
      accessKey: "secret-access-key",
      voluumWorkspaceId: "workspace-1",
    });
    mockVoluumAuth(new Response(JSON.stringify({
      error: "raw provider error includes secret-access-key and leaked-provider-token",
    }), {
      status: 403,
      headers: { "x-provider-token": "leaked-provider-token" },
    }));

    const { response, json } = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });
    const serialized = JSON.stringify(json);

    assert.equal(response.status, 200);
    assert.equal(serialized.includes("secret-access-id"), false);
    assert.equal(serialized.includes("secret-access-key"), false);
    assert.equal(serialized.includes("leaked-provider-token"), false);
    assert.equal(serialized.includes("raw provider error"), false);
    assert.equal(serialized.includes("www-authenticate"), false);
    assert.equal(serialized.includes("authorization"), false);
    assertOnlyVoluumAuthWasCalled();
  });

  test("does not leak raw provider errors when metadata fetch fails", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess();
    await setWorkspaceVoluumCredentials(workspaceId, {
      accessId: "valid-access-id",
      accessKey: "valid-access-key",
      voluumWorkspaceId: "workspace-1",
    });
    mockVoluumDiscoveryMetadata({
      trafficSources: new Response("provider failure contains valid-access-key leaked-provider-token", {
        status: 500,
        headers: { "x-provider-token": "leaked-provider-token" },
      }),
      affiliateNetworks: new Response(JSON.stringify({ affiliateNetworks: [] }), { status: 200 }),
    });

    const { response, json } = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });
    const serialized = JSON.stringify(json);

    assert.equal(response.status, 200);
    assert.deepEqual(json.credentials, { valid: true });
    assert.deepEqual(json.trafficSources, []);
    assert.deepEqual(json.affiliateNetworks, []);
    assert.deepEqual(json.summary, {
      trafficSourcesFound: 0,
      affiliateNetworksFound: 0,
    });
    assert.deepEqual(json.warnings, ["VOLUUM_TRAFFIC_SOURCES_FETCH_FAILED"]);
    assert.equal(serialized.includes("valid-access-key"), false);
    assert.equal(serialized.includes("leaked-provider-token"), false);
    assert.equal(serialized.includes("provider failure"), false);
    assertOnlyVoluumAuthAndMetadataWereCalled();
  });

  test("does not unlock existing mutating Voluum routes", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess("admin");

    const { response, json } = await request("POST", "/sync/voluum/trigger", employeeId, { workspaceId });

    assert.equal(response.status, 410);
    assert.equal(json.error, "voluum_disabled");
  });

  test("rejects missing or inaccessible workspace", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId } = await seedWorkspaceAccess();
    const otherEmployeeId = await createEmployee();

    const missing = await request("POST", "/sync/voluum/discovery-preview", otherEmployeeId, {});
    assert.equal(missing.response.status, 400);
    assert.match(missing.json.error, /workspaceId is required/);

    const inaccessible = await request("POST", "/sync/voluum/discovery-preview", otherEmployeeId, { workspaceId });
    assert.equal(inaccessible.response.status, 403);
    assert.match(inaccessible.json.error, /not a member/);
  });

  test("emits no events", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess();
    await setWorkspaceVoluumCredentials(workspaceId, {
      accessId: "valid-access-id",
      accessKey: "valid-access-key",
      voluumWorkspaceId: "workspace-1",
    });
    mockVoluumDiscoveryMetadata();
    const beforeCount = await eventCount(workspaceId);

    const { response } = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });
    const afterCount = await eventCount(workspaceId);

    assert.equal(response.status, 200);
    assert.equal(afterCount, beforeCount);
    assertOnlyVoluumAuthAndMetadataWereCalled();
  });

  test("does not write metadata, batches, tasks, or performance rows", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess();
    await setWorkspaceVoluumCredentials(workspaceId, {
      accessId: "valid-access-id",
      accessKey: "valid-access-key",
      voluumWorkspaceId: "workspace-1",
    });
    mockVoluumDiscoveryMetadata({
      trafficSources: new Response(JSON.stringify({ trafficSources: [{ id: "ts-1", name: "Meta Source" }] }), { status: 200 }),
      affiliateNetworks: new Response(JSON.stringify({ affiliateNetworks: [{ id: "an-1", name: "Meta Network" }] }), { status: 200 }),
    });
    const beforeCounts = await writeCounts(workspaceId);
    const beforeMetadataCounts = await voluumMetadataCounts(workspaceId);

    const { response } = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });
    const afterCounts = await writeCounts(workspaceId);
    const afterMetadataCounts = await voluumMetadataCounts(workspaceId);

    assert.equal(response.status, 200);
    assert.deepEqual(afterCounts, beforeCounts);
    assert.deepEqual(afterMetadataCounts, beforeMetadataCounts);
    assertOnlyVoluumAuthAndMetadataWereCalled();
  });

  test("does not call offers, campaigns, or report endpoints", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess();
    await setWorkspaceVoluumCredentials(workspaceId, {
      accessId: "valid-access-id",
      accessKey: "valid-access-key",
      voluumWorkspaceId: "workspace-1",
    });
    mockVoluumDiscoveryMetadata();

    const { response } = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });

    assert.equal(response.status, 200);
    assertOnlyVoluumAuthAndMetadataWereCalled();
  });
});
