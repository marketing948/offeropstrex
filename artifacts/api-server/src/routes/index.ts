import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { isVoluumDryRunEnabled, isVoluumEnabled } from "../lib/feature-flags";
import healthRouter from "./health";
import authRouter from "./auth";
import workspaceMembersRouter from "./workspace-members";
import employeesRouter from "./employees";
import goalsRouter from "./goals";
import dailyReportsRouter from "./daily-reports";
import testingBatchesRouter from "./testing-batches";
import offersRouter from "./offers";
import performanceRouter from "./performance";
import todoTasksRouter from "./todo-tasks";
import dashboardRouter from "./dashboard";
import adminBatchesRouter from "./admin/batches";
import adminBatchHealthRouter from "./admin/batch-health";
import adminBatchRecoveryRouter from "./admin/batch-recovery";
import adminSuspiciousBatchesRouter from "./admin/suspicious-batches";
import settingsRouter from "./settings";
import syncRouter from "./sync";
import notificationsRouter from "./notifications";
import queuesRouter from "./queues";
import workspaceTrafficSourcesRouter from "./workspace-traffic-sources";
import affiliateNetworksRouter from "./affiliate-networks";
import geosRouter from "./geos";
import campaignsRouter from "./campaigns";
import batchResultsRouter from "./batch-results";
import workerAffiliateNetworksRouter from "./worker-affiliate-networks";
import operationalEventsRouter from "./operational-events";

const router: IRouter = Router();

// Pivot Phase 0 — Voluum runtime lockout. Every Voluum-touching HTTP
// surface returns 410 Gone when ENABLE_VOLUUM is off (default). Set
// ENABLE_VOLUUM=true to restore prior behavior. The gate runs as the
// first middleware so it short-circuits before route handlers execute
// and DB/Voluum API calls cannot happen.
function voluumDisabledGate(req: Request, res: Response, next: NextFunction): void {
  if (isVoluumEnabled()) {
    next();
    return;
  }
  // Case-insensitive match — Express route matching is case-insensitive
  // by default, so `/sync/VoLuUm/...` would otherwise still hit the
  // underlying handlers and bypass the lockout.
  const path = req.path.toLowerCase();
  if (path === "/sync/voluum/discovery-preview" && isVoluumDryRunEnabled()) {
    next();
    return;
  }

  const isVoluumPath =
    path.startsWith("/sync/voluum") ||
    path.startsWith("/settings/voluum") ||
    path === "/settings/traffic-source-device-plan";
  if (isVoluumPath) {
    res.status(410).json({
      error: "voluum_disabled",
      message:
        "Voluum integration is currently disabled. The system runs in manual-first mode.",
    });
    return;
  }
  next();
}

router.use(voluumDisabledGate);

router.use(healthRouter);
router.use(authRouter);
router.use(workspaceMembersRouter);
router.use(employeesRouter);
router.use(goalsRouter);
router.use(dailyReportsRouter);
router.use(testingBatchesRouter);
router.use(offersRouter);
router.use(performanceRouter);
router.use(todoTasksRouter);
router.use(dashboardRouter);
router.use(adminBatchesRouter);
router.use(adminBatchHealthRouter);
router.use(adminBatchRecoveryRouter);
router.use(adminSuspiciousBatchesRouter);
router.use(settingsRouter);
router.use(syncRouter);
router.use(notificationsRouter);
router.use(queuesRouter);
router.use(workspaceTrafficSourcesRouter);
router.use(affiliateNetworksRouter);
router.use(geosRouter);
router.use(campaignsRouter);
router.use(batchResultsRouter);
router.use(workerAffiliateNetworksRouter);
router.use(operationalEventsRouter);

export default router;
