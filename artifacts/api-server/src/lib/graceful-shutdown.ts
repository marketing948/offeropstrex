import type { Server } from "node:http";
import type { Logger } from "pino";
import { pool } from "@workspace/db";
import {
  parseGracefulShutdownTimeoutMs,
  runGracefulShutdownSequence,
} from "./graceful-shutdown-core.ts";

export type { ShutdownSequenceDeps } from "./graceful-shutdown-core.ts";
export {
  parseGracefulShutdownTimeoutMs,
  runGracefulShutdownSequence,
} from "./graceful-shutdown-core.ts";

export type GracefulShutdownOptions = {
  log: Logger;
  server: Server;
  stopCrons: () => void;
};

/** Register SIGTERM/SIGINT handlers (idempotent-ish: guard avoids double-register). */
let registered = false;

export function registerGracefulShutdown(options: GracefulShutdownOptions): void {
  if (registered) return;
  registered = true;

  const { log, server, stopCrons } = options;
  let shuttingDown = false;
  const forceMs = parseGracefulShutdownTimeoutMs();

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    const forceExit = setTimeout(() => {
      log.error(
        { forceMs },
        "Graceful shutdown: timeout reached, forcing exit",
      );
      process.exit(1);
    }, forceMs);

    try {
      log.info({ signal, forceMs }, "Graceful shutdown: started");

      await runGracefulShutdownSequence({
        log,
        server,
        stopCrons,
        closePool: () => pool.end(),
      });

      clearTimeout(forceExit);
      log.info({ signal }, "Graceful shutdown: complete");
      process.exit(0);
    } catch (err) {
      log.error({ err }, "Graceful shutdown: failed");
      clearTimeout(forceExit);
      process.exit(1);
    }
  }

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
}
