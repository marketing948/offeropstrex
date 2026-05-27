import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { hashPassword } from "./auth.ts";
import { _resetLoginRateLimitForTests } from "../lib/login-rate-limit.ts";

const ORIGINAL_ENV = { ...process.env };

let server: Server;
let baseUrl: string;
let createdEmployeeIds: number[] = [];

const TEST_PASSWORD = "security-hardening-test-password";

async function loadApp() {
  const { default: app } = await import("../app.ts");
  return app;
}

before(async () => {
  process.env.AUTH_TOKEN_SECRET = "security-hardening-test-secret";
  const app = await loadApp();
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
  _resetLoginRateLimitForTests();
});

afterEach(async () => {
  for (const id of [...createdEmployeeIds].reverse()) {
    await db.delete(employeesTable).where(eq(employeesTable.id, id));
  }
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  process.env.CORS_ORIGIN = ORIGINAL_ENV.CORS_ORIGIN;
  process.env.LOGIN_RATE_LIMIT_DISABLED = ORIGINAL_ENV.LOGIN_RATE_LIMIT_DISABLED;
  process.env.LOGIN_RATE_LIMIT_MAX = ORIGINAL_ENV.LOGIN_RATE_LIMIT_MAX;
  process.env.LOGIN_RATE_LIMIT_WINDOW_MS = ORIGINAL_ENV.LOGIN_RATE_LIMIT_WINDOW_MS;
  _resetLoginRateLimitForTests();
});

async function createEmployee(email: string): Promise<void> {
  const [row] = await db
    .insert(employeesTable)
    .values({
      name: "Security Test User",
      email,
      passwordHash: hashPassword(TEST_PASSWORD),
      role: "employee",
      status: "active",
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(row.id);
}

describe("security hardening", () => {
  test("login succeeds normally", async () => {
    const email = `sec-login-ok-${Date.now()}@test.local`;
    await createEmployee(email);

    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { token: string };
    assert.ok(body.token.includes("."));
  });

  test("too many failed login attempts returns 429", async () => {
    process.env.LOGIN_RATE_LIMIT_DISABLED = "false";
    process.env.NODE_ENV = "development";
    process.env.LOGIN_RATE_LIMIT_MAX = "3";
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "900000";

    const email = `sec-rate-limit-${Date.now()}@test.local`;
    await createEmployee(email);

    for (let i = 0; i < 3; i++) {
      const fail = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "wrong-password" }),
      });
      assert.equal(fail.status, 401);
    }

    const blocked = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "wrong-password" }),
    });
    assert.equal(blocked.status, 429);

    const stillBlockedWithCorrect = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    assert.equal(stillBlockedWithCorrect.status, 429);
  });

  test("successful login is not blocked under normal conditions", async () => {
    process.env.LOGIN_RATE_LIMIT_DISABLED = "false";
    process.env.NODE_ENV = "development";
    process.env.LOGIN_RATE_LIMIT_MAX = "5";

    const email = `sec-login-normal-${Date.now()}@test.local`;
    await createEmployee(email);

    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    assert.equal(res.status, 200);
  });

  test("CORS rejects disallowed origin in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGIN = "https://app.offerops.example";

    const res = await fetch(`${baseUrl}/healthz`, {
      headers: { Origin: "https://evil.example.com" },
    });
    assert.equal(res.status, 200);
    assert.notEqual(
      res.headers.get("access-control-allow-origin"),
      "https://evil.example.com",
    );
  });

  test("CORS allows configured origin", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGIN = "https://app.offerops.example";

    const res = await fetch(`${baseUrl}/healthz`, {
      headers: { Origin: "https://app.offerops.example" },
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("access-control-allow-origin"),
      "https://app.offerops.example",
    );
  });

  test("security headers exist on API response", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("x-frame-options"));
  });
});
