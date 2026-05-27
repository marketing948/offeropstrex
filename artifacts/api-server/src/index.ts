import app from "./app";
import { logger } from "./lib/logger";
import { resolveBackgroundCronsEnabled } from "./lib/background-crons.ts";
import { registerGracefulShutdown } from "./lib/graceful-shutdown.ts";
import { startOverdueTasksCron } from "./cron/overdue-tasks.ts";
import { startReconciliationCron } from "./cron/reconciliation.ts";
import { startOptimizationFollowupCron } from "./cron/optimization-followup.ts";
import { startFindWinnersScheduler } from "./cron/find-winners-scheduler.ts";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info(
    {
      port,
      environment: process.env.NODE_ENV ?? "development",
      version: process.env.APP_VERSION ?? "dev",
      deploymentTimestamp: process.env.DEPLOYMENT_TIMESTAMP ?? null,
    },
    "Server listening",
  );

  const cronStopHandles: Array<() => void> = [];
  const cronResolution = resolveBackgroundCronsEnabled();

  if (cronResolution.enabled) {
    logger.info(
      { reason: cronResolution.reason },
      "Background crons enabled",
    );
    cronStopHandles.push(startOverdueTasksCron());
    cronStopHandles.push(startReconciliationCron());
    cronStopHandles.push(startOptimizationFollowupCron());
    cronStopHandles.push(startFindWinnersScheduler());
  } else {
    logger.info(
      { reason: cronResolution.reason },
      "Background crons disabled",
    );
  }

  registerGracefulShutdown({
    log: logger,
    server,
    stopCrons: () => {
      for (const stop of cronStopHandles) {
        try {
          stop();
        } catch (stopErr) {
          logger.warn({ err: stopErr }, "graceful shutdown: cron stop failed");
        }
      }
    },
  });
});
