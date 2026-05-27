import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import app from "../app.ts";
import { db, employeesTable, workspacesTable } from "@workspace/db";
import { ENCRYPTED_SECRET_PREFIX } from "../lib/secrets-encryption.ts";
import {
  decryptVoluumAccessKeyFromStorage,
  encryptVoluumAccessKeyForStorage,
  getVoluumCredentialsFromWorkspace,
} from "../lib/voluum-credentials.ts";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";
import { hashPassword } from "./auth.ts";

const ORIGINAL_ENV = { ...process.env };

let server: Server;
let baseUrl: string;
let adminId: number;
let createdWorkspaceIds: number[] = [];

const RAW_ACCESS_KEY = "voluum-test-access-key-xy99";

before(async () => {
  process.env.AUTH_TOKEN_SECRET = "voluum-secrets-test-auth";
  process.env.SECRETS_ENCRYPTION_KEY = "voluum-secrets-test-encryption-key";
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  const [admin] = await db
    .insert(employeesTable)
    .values({
      name: "Voluum Secrets Admin",
      email: `voluum-secrets-admin-${Date.now()}@test.local`,
      passwordHash: hashPassword("admin-pass"),
      role: "admin",
      status: "active",
    })
    .returning({ id: employeesTable.id });
  adminId = admin.id;
});

after(async () => {
  await db.delete(employeesTable).where(eq(employeesTable.id, adminId));
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_ENV.SECRETS_ENCRYPTION_KEY;
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
});

beforeEach(() => {
  createdWorkspaceIds = [];
});

afterEach(async () => {
  for (const id of [...createdWorkspaceIds].reverse()) {
    await db.delete(workspacesTable).where(eq(workspacesTable.id, id));
  }
});

async function adminRequest(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${authToken(adminId)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { response, json, text };
}

describe("Voluum secrets encryption and redaction", () => {
  test("PATCH workspace does not return raw access key and stores encrypted value", async () => {
    const create = await adminRequest("POST", "/sync/voluum/workspaces", {
      name: `Secrets WS ${Date.now()}`,
    });
    assert.equal(create.response.status, 201);
    const workspaceId = create.json.id as number;
    createdWorkspaceIds.push(workspaceId);
    assert.equal(create.json.voluumAccessKey, undefined);

    const patch = await adminRequest("PATCH", `/sync/voluum/workspaces/${workspaceId}`, {
      voluumAccessId: "access-id-123",
      voluumAccessKey: RAW_ACCESS_KEY,
    });
    assert.equal(patch.response.status, 200);
    assert.equal(patch.json.voluumAccessKey, undefined);
    assert.equal(patch.json.hasVoluumCredentials, true);
    assert.equal(patch.json.voluumAccessKeySuffix, "xy99");
    assert.ok(!patch.text.includes(RAW_ACCESS_KEY));

    const [row] = await db
      .select()
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId));
    assert.ok(row?.voluumAccessKey?.startsWith(ENCRYPTED_SECRET_PREFIX));
    assert.notEqual(row?.voluumAccessKey, RAW_ACCESS_KEY);

    const creds = getVoluumCredentialsFromWorkspace(row!);
    assert.equal(creds.accessKey, RAW_ACCESS_KEY);
  });

  test("GET workspaces list redacts secrets", async () => {
    const create = await adminRequest("POST", "/sync/voluum/workspaces", {
      name: `Secrets List ${Date.now()}`,
      voluumAccessId: "list-access-id",
      voluumAccessKey: RAW_ACCESS_KEY,
    });
    assert.equal(create.response.status, 201);
    createdWorkspaceIds.push(create.json.id as number);
    assert.ok(!create.text.includes(RAW_ACCESS_KEY));

    const list = await adminRequest("GET", "/sync/voluum/workspaces");
    assert.equal(list.response.status, 200);
    const match = (list.json as Array<Record<string, unknown>>).find((w) => w.id === create.json.id);
    assert.ok(match);
    assert.equal(match.voluumAccessKey, undefined);
    assert.equal(match.hasVoluumCredentials, true);
    assert.ok(!list.text.includes(RAW_ACCESS_KEY));
  });

  test("legacy plaintext access key decrypts for internal use", async () => {
    const [row] = await db
      .insert(workspacesTable)
      .values({
        name: `Legacy WS ${Date.now()}`,
        voluumAccessId: "legacy-id",
        voluumAccessKey: RAW_ACCESS_KEY,
        isActive: false,
        isDefault: false,
        syncInterval: "manual",
      })
      .returning();
    createdWorkspaceIds.push(row.id);

    assert.equal(decryptVoluumAccessKeyFromStorage(row.voluumAccessKey), RAW_ACCESS_KEY);
    const creds = getVoluumCredentialsFromWorkspace(row);
    assert.equal(creds.accessKey, RAW_ACCESS_KEY);
  });

  test("PATCH migrates legacy plaintext to encrypted storage", async () => {
    const [row] = await db
      .insert(workspacesTable)
      .values({
        name: `Migrate WS ${Date.now()}`,
        voluumAccessId: "migrate-id",
        voluumAccessKey: RAW_ACCESS_KEY,
        isActive: false,
        isDefault: false,
        syncInterval: "manual",
      })
      .returning();
    createdWorkspaceIds.push(row.id);

    const patch = await adminRequest("PATCH", `/sync/voluum/workspaces/${row.id}`, {
      name: row.name,
    });
    assert.equal(patch.response.status, 200);

    const [stored] = await db
      .select()
      .from(workspacesTable)
      .where(eq(workspacesTable.id, row.id));
    assert.ok(stored?.voluumAccessKey?.startsWith(ENCRYPTED_SECRET_PREFIX));
    assert.equal(decryptVoluumAccessKeyFromStorage(stored?.voluumAccessKey), RAW_ACCESS_KEY);
  });

  test("POST create encrypts credentials in database", async () => {
    const encrypted = encryptVoluumAccessKeyForStorage(RAW_ACCESS_KEY);
    assert.ok(encrypted?.startsWith(ENCRYPTED_SECRET_PREFIX));

    const create = await adminRequest("POST", "/sync/voluum/workspaces", {
      name: `Encrypted Create ${Date.now()}`,
      voluumAccessId: "create-id",
      voluumAccessKey: RAW_ACCESS_KEY,
    });
    assert.equal(create.response.status, 201);
    createdWorkspaceIds.push(create.json.id as number);

    const [row] = await db
      .select()
      .from(workspacesTable)
      .where(eq(workspacesTable.id, create.json.id));
    assert.ok(row?.voluumAccessKey?.startsWith(ENCRYPTED_SECRET_PREFIX));
    assert.equal(getVoluumCredentialsFromWorkspace(row!).accessKey, RAW_ACCESS_KEY);
  });
});
