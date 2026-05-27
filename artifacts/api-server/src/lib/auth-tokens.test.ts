import { describe, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  isLegacyBase64AuthToken,
  signAuthToken,
  verifyAuthToken,
} from "./auth-tokens.ts";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  process.env.AUTH_TOKEN_SECRET = ORIGINAL_ENV.AUTH_TOKEN_SECRET;
}

describe("auth-tokens", () => {
  test("sign + verify round-trip", () => {
    process.env.AUTH_TOKEN_SECRET = "unit-test-secret";
    const token = signAuthToken(42);
    assert.equal(verifyAuthToken(token), 42);
    restoreEnv();
  });

  test("legacy base64 token is detected and rejected", () => {
    const legacy = Buffer.from("99:1:offerops_secret").toString("base64");
    assert.equal(isLegacyBase64AuthToken(legacy), true);
    process.env.AUTH_TOKEN_SECRET = "unit-test-secret";
    assert.equal(verifyAuthToken(legacy), null);
    restoreEnv();
  });

  test("malformed token is rejected", () => {
    process.env.AUTH_TOKEN_SECRET = "unit-test-secret";
    assert.equal(verifyAuthToken("not-a-jwt"), null);
    assert.equal(verifyAuthToken(""), null);
    restoreEnv();
  });

  test("expired token is rejected", () => {
    process.env.AUTH_TOKEN_SECRET = "unit-test-secret";
    const token = signAuthToken(7, { expiresIn: -10 });
    assert.equal(verifyAuthToken(token), null);
    restoreEnv();
  });

  test("token signed with wrong secret is rejected", () => {
    process.env.AUTH_TOKEN_SECRET = "secret-a";
    const token = signAuthToken(1);
    process.env.AUTH_TOKEN_SECRET = "secret-b";
    assert.equal(verifyAuthToken(token), null);
    restoreEnv();
  });

  test("forged payload without valid signature is rejected", () => {
    process.env.AUTH_TOKEN_SECRET = "unit-test-secret";
    const valid = signAuthToken(1);
    const parts = valid.split(".");
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
    payload.sub = "9999";
    const forgedPayload = Buffer.from(JSON.stringify(payload))
      .toString("base64url")
      .replace(/=+$/, "");
    const forged = `${parts[0]}.${forgedPayload}.${parts[2]}`;
    assert.equal(verifyAuthToken(forged), null);
    restoreEnv();
  });

  test("AUTH_TOKEN_SECRET is required in production when unset", () => {
    delete process.env.AUTH_TOKEN_SECRET;
    process.env.NODE_ENV = "production";
    assert.throws(() => signAuthToken(1), /AUTH_TOKEN_SECRET is required/);
    restoreEnv();
  });

  test("dev fallback allowed outside production", () => {
    delete process.env.AUTH_TOKEN_SECRET;
    process.env.NODE_ENV = "development";
    const token = signAuthToken(3);
    assert.ok(jwt.decode(token));
    restoreEnv();
  });
});
