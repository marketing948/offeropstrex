import app from "./app";
import { logger } from "./lib/logger";
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

app.listen(port, (err) => {
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
  // Phase 7: start the overdue-tasks scanner only after we're listening,
  // so a crash on boot doesn't surface as a missing port.
  startOverdueTasksCron();
  // SPEC Phase 1: reconciliation safety-net cron (15-min interval).
  startReconciliationCron();
  // Pivot Phase 4 (Task #27): optimization-followup safety-net cron.
  startOptimizationFollowupCron();
  // CampaignOps redesign — 7-day Find Winners scheduler.
  startFindWinnersScheduler();
});
