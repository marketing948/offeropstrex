import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  resolveSecretsEncryptionKey,
} from "./secrets-encryption.ts";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_ENV.SECRETS_ENCRYPTION_KEY;
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
}

describe("secrets-encryption", () => {
  test("encrypt + decrypt round-trip", () => {
    process.env.SECRETS_ENCRYPTION_KEY = "unit-test-encryption-key";
    const encrypted = encryptSecret("super-secret-voluum-key");
    assert.equal(isEncryptedSecret(encrypted), true);
    assert.notEqual(encrypted, "super-secret-voluum-key");
    assert.equal(decryptSecret(encrypted), "super-secret-voluum-key");
    restoreEnv();
  });

  test("legacy plaintext decrypt passthrough", () => {
    process.env.SECRETS_ENCRYPTION_KEY = "unit-test-encryption-key";
    assert.equal(decryptSecret("legacy-plaintext-key"), "legacy-plaintext-key");
    restoreEnv();
  });

  test("SECRETS_ENCRYPTION_KEY required in production when unset", () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    process.env.NODE_ENV = "production";
    assert.throws(() => resolveSecretsEncryptionKey(), /SECRETS_ENCRYPTION_KEY is required/);
    restoreEnv();
  });

  test("dev fallback allowed outside production", () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    process.env.NODE_ENV = "development";
    const encrypted = encryptSecret("dev-only-secret");
    assert.ok(isEncryptedSecret(encrypted));
    restoreEnv();
  });
});
