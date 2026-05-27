import type { Server } from "node:http";
import type { Logger } from "pino";

const DEFAULT_SHUTDOWN_MS = 25_000;

export function parseGracefulShutdownTimeoutMs(): number {
  const raw = process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_SHUTDOWN_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 3000 ? n : DEFAULT_SHUTDOWN_MS;
}

export type ShutdownSequenceDeps = {
  log: Logger;
  server: Server;
  stopCrons: () => void;
  closePool: () => Promise<void>;
};

/**
 * Drain HTTP connections, stop in-process crons, then release the DB pool.
 * Exported for isolated tests with mocked `server` / `closePool`.
 */
export async function runGracefulShutdownSequence(
  deps: ShutdownSequenceDeps,
): Promise<void> {
  const { log, server, stopCrons, closePool } = deps;

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  log.info(
    "Graceful shutdown: HTTP server closed (no longer accepting connections)",
  );

  stopCrons();
  log.info("Graceful shutdown: background crons stopped");

  await closePool();
  log.info("Graceful shutdown: Postgres pool closed");
}
