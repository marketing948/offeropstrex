import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import app from "../app.ts";
import { signAuthToken } from "../lib/auth-tokens.ts";
import { db, employeesTable } from "@workspace/db";
import { hashPassword } from "./auth.ts";

let server: Server;
let baseUrl: string;
let createdEmployeeIds: number[] = [];

const TEST_PASSWORD = "test-password-auth-slice";

before(async () => {
  process.env.AUTH_TOKEN_SECRET = "auth-route-test-secret";
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
  createdEmployeeIds = [];
});

afterEach(async () => {
  for (const id of [...createdEmployeeIds].reverse()) {
    await db.delete(employeesTable).where(eq(employeesTable.id, id));
  }
});

async function createEmployee(email: string): Promise<number> {
  const [row] = await db
    .insert(employeesTable)
    .values({
      name: "Auth Test User",
      email,
      passwordHash: hashPassword(TEST_PASSWORD),
      role: "employee",
      status: "active",
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(row.id);
  return row.id;
}

describe("auth routes", () => {
  test("valid login token works on /auth/me", async () => {
    const email = `auth-login-${Date.now()}@test.local`;
    await createEmployee(email);

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    assert.equal(login.status, 200);
    const loginJson = (await login.json()) as { token: string };
    assert.ok(loginJson.token.includes("."));

    const me = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${loginJson.token}` },
    });
    assert.equal(me.status, 200);
  });

  test("valid signed token returns the matching employee on /auth/me", async () => {
    const email = `auth-valid-${Date.now()}@test.local`;
    const employeeId = await createEmployee(email);
    const token = signAuthToken(employeeId);

    const me = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(me.status, 200);
    const body = (await me.json()) as { id: number };
    assert.equal(body.id, employeeId);
  });

  test("forged jwt with tampered subject is rejected with 401", async () => {
    const token = signAuthToken(1);
    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as {
      sub?: string;
    };
    payload.sub = "99999";
    const forgedPayload = Buffer.from(JSON.stringify(payload))
      .toString("base64url")
      .replace(/=+$/, "");
    const forged = `${parts[0]}.${forgedPayload}.${parts[2]}`;

    const me = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${forged}` },
    });
    assert.equal(me.status, 401);
  });

  test("legacy base64 token is rejected with 401", async () => {
    const legacy = Buffer.from("1:123:offerops_secret").toString("base64");
    const me = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${legacy}` },
    });
    assert.equal(me.status, 401);
  });

  test("malformed token is rejected with 401", async () => {
    const me = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: "Bearer not-valid-jwt" },
    });
    assert.equal(me.status, 401);
  });

  test("expired token is rejected with 401", async () => {
    const email = `auth-expired-${Date.now()}@test.local`;
    const employeeId = await createEmployee(email);
    const expired = signAuthToken(employeeId, { expiresIn: -1 });

    const me = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${expired}` },
    });
    assert.equal(me.status, 401);
  });
});
