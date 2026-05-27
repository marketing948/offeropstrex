import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolveBackgroundCronsEnabled } from "./background-crons.ts";

const ORIGINAL = {
  CRON_DISABLED: process.env.CRON_DISABLED,
  CRON_ENABLED: process.env.CRON_ENABLED,
};

function restoreCronEnv(): void {
  if (ORIGINAL.CRON_DISABLED !== undefined) {
    process.env.CRON_DISABLED = ORIGINAL.CRON_DISABLED;
  } else {
    delete process.env.CRON_DISABLED;
  }
  if (ORIGINAL.CRON_ENABLED !== undefined) {
    process.env.CRON_ENABLED = ORIGINAL.CRON_ENABLED;
  } else {
    delete process.env.CRON_ENABLED;
  }
}

describe("resolveBackgroundCronsEnabled", () => {
  test("disables when CRON_DISABLED=true", () => {
    try {
      delete process.env.CRON_ENABLED;
      process.env.CRON_DISABLED = "true";
      assert.equal(resolveBackgroundCronsEnabled().enabled, false);
    } finally {
      restoreCronEnv();
    }
  });

  test("disabled wins when CRON_DISABLED=true even if CRON_ENABLED=true", () => {
    try {
      process.env.CRON_DISABLED = "true";
      process.env.CRON_ENABLED = "true";
      assert.equal(resolveBackgroundCronsEnabled().enabled, false);
    } finally {
      restoreCronEnv();
    }
  });

  test("disables when CRON_ENABLED=false", () => {
    try {
      delete process.env.CRON_DISABLED;
      process.env.CRON_ENABLED = "false";
      assert.equal(resolveBackgroundCronsEnabled().enabled, false);
    } finally {
      restoreCronEnv();
    }
  });

  test("enables by default when env unset", () => {
    try {
      delete process.env.CRON_DISABLED;
      delete process.env.CRON_ENABLED;
      const r = resolveBackgroundCronsEnabled();
      assert.equal(r.enabled, true);
      assert.ok(r.reason.includes("default"));
    } finally {
      restoreCronEnv();
    }
  });

  test("explicit CRON_ENABLED=true enables", () => {
    try {
      delete process.env.CRON_DISABLED;
      process.env.CRON_ENABLED = "true";
      assert.equal(resolveBackgroundCronsEnabled().enabled, true);
    } finally {
      restoreCronEnv();
    }
  });
});
