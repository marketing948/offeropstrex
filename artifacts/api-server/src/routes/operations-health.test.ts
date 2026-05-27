import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import app from "../app.ts";
import { pool } from "@workspace/db";

let server: Server;
let baseUrl: string;

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

describe("operations health endpoints", () => {
  test("/healthz returns 200 and operational metadata", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.status, "ok");
    assert.equal(typeof body.environment, "string");
    assert.equal(typeof body.uptime, "number");
    assert.equal(typeof body.timestamp, "string");
  });

  test("/readyz fails safely when database is unavailable", async () => {
    const original = pool.query.bind(pool);
    (pool as { query: typeof pool.query }).query = (async () => {
      throw new Error("db unavailable");
    }) as unknown as typeof pool.query;

    const res = await fetch(`${baseUrl}/readyz`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { status: string; checks: { db: string } };
    assert.equal(body.status, "not_ready");
    assert.equal(body.checks.db, "error");

    (pool as { query: typeof pool.query }).query = original;
  });

  test("response includes request id and respects incoming x-request-id", async () => {
    const incomingId = `test-${Date.now()}`;
    const withIncoming = await fetch(`${baseUrl}/healthz`, {
      headers: { "x-request-id": incomingId },
    });
    assert.equal(withIncoming.headers.get("x-request-id"), incomingId);

    const generated = await fetch(`${baseUrl}/healthz`);
    const generatedId = generated.headers.get("x-request-id");
    assert.ok(generatedId);
    assert.notEqual(generatedId, "");
  });
});
