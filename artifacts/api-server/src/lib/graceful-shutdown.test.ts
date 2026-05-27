import type { Server } from "node:http";
import type { Logger } from "pino";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGracefulShutdownTimeoutMs,
  runGracefulShutdownSequence,
} from "./graceful-shutdown-core.ts";

const noopLog = { info() {}, error() {} } as unknown as Logger;

describe("parseGracefulShutdownTimeoutMs", () => {
  const ORIGINAL = process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS;

  test("defaults when unset", () => {
    try {
      delete process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS;
      assert.equal(parseGracefulShutdownTimeoutMs(), 25_000);
    } finally {
      if (ORIGINAL !== undefined) {
        process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS = ORIGINAL;
      } else {
        delete process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS;
      }
    }
  });

  test("respects numeric override when sane", () => {
    try {
      process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS = "12000";
      assert.equal(parseGracefulShutdownTimeoutMs(), 12_000);
    } finally {
      if (ORIGINAL !== undefined) {
        process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS = ORIGINAL;
      } else {
        delete process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS;
      }
    }
  });

  test("falls back when too small", () => {
    try {
      process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS = "500";
      assert.equal(parseGracefulShutdownTimeoutMs(), 25_000);
    } finally {
      if (ORIGINAL !== undefined) {
        process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS = ORIGINAL;
      } else {
        delete process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS;
      }
    }
  });
});

describe("runGracefulShutdownSequence", () => {
  test("closes HTTP before stopping crons, then pool", async () => {
    const order: string[] = [];
    const server = {
      close(cb: (err?: Error) => void) {
        order.push("server.close");
        queueMicrotask(() => cb());
      },
    } as unknown as Server;

    await runGracefulShutdownSequence({
      log: noopLog,
      server,
      stopCrons: () => {
        order.push("stopCrons");
      },
      closePool: async () => {
        order.push("pool.end");
      },
    });

    assert.deepEqual(order, ["server.close", "stopCrons", "pool.end"]);
  });
});
