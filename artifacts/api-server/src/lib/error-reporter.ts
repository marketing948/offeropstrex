import type { Logger } from "pino";

export function reportServerError(
  log: Logger,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  log.error(
    {
      err: {
        name: err.name,
        message: err.message,
      },
      ...context,
    },
    "Server error",
  );
}
