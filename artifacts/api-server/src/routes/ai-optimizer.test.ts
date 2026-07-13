/**
 * AI Optimizer route + authorization tests.
 *
 * Requires an isolated Postgres (never production/demo) because auth resolves
 * the employee from the DB. Run via `test:routes` with DATABASE_URL pointing at
 * a disposable database.
 */
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import app from "../app.ts";
import { db, employeesTable } from "@workspace/db";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdEmployeeIds: number[] = [];

const CAMPAIGN_CSV = [
  "Campaign index,Geo,AN Name,Brand Name,Link,Status,Offer Id,Service Id,Weight",
  "old01,GB,AN,Keep1,http://x,active,OF1,svc,1",
  "old02,GB,AN,Remove1,http://x,active,OF2,svc,1",
  "old03,GB,AN,Ghost,http://x,active,OF3,svc,1",
].join("\n");
const VOLUUM_CSV = ["Brand Name,Revenue", "Keep1,5", "Remove1,0"].join("\n");

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
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

async function seedEmployee(role: "admin" | "employee"): Promise<number> {
  const id = (
    await db
      .insert(employeesTable)
      .values({
        name: `AIOpt ${role}`,
        email: `aiopt-${role}-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "x",
        role,
      })
      .returning({ id: employeesTable.id })
  )[0]!.id;
  createdEmployeeIds.push(id);
  return id;
}

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

describe("ai-optimizer routes", { concurrency: false }, () => {
  test("35) admin can analyze — 200 with summary + decisions", async () => {
    const adminId = await seedEmployee("admin");
    const { res, json } = await post(
      "/ai-optimizer/analyze",
      { campaignCsv: CAMPAIGN_CSV, voluumCsv: VOLUUM_CSV, revenueThreshold: 0.1 },
      authToken(adminId),
    );
    assert.equal(res.status, 200);
    const summary = json?.summary as Record<string, number>;
    assert.equal(summary.campaignRows, 3);
    assert.equal(summary.keep, 1);
    assert.equal(summary.remove, 1);
    assert.equal(summary.unmatched, 1);
    assert.equal(summary.retainedTotal, 2);
  });

  test("35) admin can export the optimized Campaign CSV", async () => {
    const adminId = await seedEmployee("admin");
    const { res, json } = await post(
      "/ai-optimizer/export",
      {
        campaignCsv: CAMPAIGN_CSV,
        voluumCsv: VOLUUM_CSV,
        revenueThreshold: 0.1,
        pathCount: 2,
        exportType: "campaign",
        campaignFileName: "campaigns.csv",
      },
      authToken(adminId),
    );
    assert.equal(res.status, 200);
    assert.match(String(json?.filename), /_optimized_2_offers_2_paths\.csv$/);
    assert.match(String(json?.csv), /cmp01/);
    assert.ok(!String(json?.csv).includes("Remove1"));
    assert.ok(String(json?.csv).includes("Ghost"));
  });

  test("37) worker analyze → 403", async () => {
    const workerId = await seedEmployee("employee");
    const { res } = await post(
      "/ai-optimizer/analyze",
      { campaignCsv: CAMPAIGN_CSV, voluumCsv: VOLUUM_CSV },
      authToken(workerId),
    );
    assert.equal(res.status, 403);
  });

  test("37) worker export → 403", async () => {
    const workerId = await seedEmployee("employee");
    const { res } = await post(
      "/ai-optimizer/export",
      { campaignCsv: CAMPAIGN_CSV, voluumCsv: VOLUUM_CSV, pathCount: 1, exportType: "campaign" },
      authToken(workerId),
    );
    assert.equal(res.status, 403);
  });

  test("38) unauthenticated analyze → 401", async () => {
    const { res } = await post("/ai-optimizer/analyze", {
      campaignCsv: CAMPAIGN_CSV,
      voluumCsv: VOLUUM_CSV,
    });
    assert.equal(res.status, 401);
  });

  test("invalid body → 400 (admin)", async () => {
    const adminId = await seedEmployee("admin");
    const { res } = await post("/ai-optimizer/analyze", { campaignCsv: "" }, authToken(adminId));
    assert.equal(res.status, 400);
  });

  test("unparseable CSV → 422 (admin)", async () => {
    const adminId = await seedEmployee("admin");
    const { res } = await post(
      "/ai-optimizer/analyze",
      { campaignCsv: "Geo,AN\nGB,x", voluumCsv: VOLUUM_CSV },
      authToken(adminId),
    );
    assert.equal(res.status, 422);
  });

  test("scoped 25MB parser: admin analyze accepts a payload > 100 KB", async () => {
    const adminId = await seedEmployee("admin");
    const header =
      "Campaign index,Geo,AN Name,Brand Name,Link,Status,Offer Id,Service Id,Weight";
    const lines = [header];
    for (let i = 0; i < 3000; i++) {
      lines.push(`old${i},GB,AffiliateNetwork,BigBrand${i},http://example/${i},active,OF${i},svc,1`);
    }
    const bigCampaign = lines.join("\n");
    const bodyBytes = Buffer.byteLength(
      JSON.stringify({ campaignCsv: bigCampaign, voluumCsv: VOLUUM_CSV }),
    );
    assert.ok(bodyBytes > 100 * 1024, `payload should exceed 100 KB (was ${bodyBytes})`);
    const { res, json } = await post(
      "/ai-optimizer/analyze",
      { campaignCsv: bigCampaign, voluumCsv: VOLUUM_CSV, revenueThreshold: 0.1 },
      authToken(adminId),
    );
    // Must NOT be 413 Payload Too Large — the scoped 25 MB parser handled it.
    assert.equal(res.status, 200);
    assert.equal((json?.summary as Record<string, number>).campaignRows, 3000);
  });

  test("scoped limit does NOT leak: a non-optimizer route rejects a > 100 KB body", async () => {
    // /auth/login only sees the global (small) JSON parser. If the 25 MB limit
    // were global, this would parse and return a normal 400/401; instead the
    // oversized body is rejected before the handler (413 → 500 via error mw).
    const bigValue = "x".repeat(200 * 1024);
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: bigValue, password: bigValue }),
    });
    assert.ok(
      res.status === 413 || res.status === 500,
      `expected size rejection (413/500), got ${res.status}`,
    );
    assert.notEqual(res.status, 200);
  });
});
