import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { areRulesRegistered } from "../engine/rules/index.ts";
import { reportServerError } from "../lib/error-reporter.ts";

const router: IRouter = Router();

function operationalMetadata() {
  return {
    environment: process.env.NODE_ENV ?? "development",
    version: process.env.APP_VERSION ?? "dev",
    deploymentTimestamp: process.env.DEPLOYMENT_TIMESTAMP ?? null,
    apiVersion: "v1",
  };
}

router.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    ...operationalMetadata(),
  });
});

router.get("/readyz", async (req, res) => {
  try {
    await pool.query("select 1");
    res.json({
      status: "ready",
      checks: {
        db: "ok",
        rulesRegistry: areRulesRegistered() ? "ok" : "not_ready",
      },
      timestamp: new Date().toISOString(),
      ...operationalMetadata(),
    });
  } catch (error) {
    reportServerError(req.log, error, { route: "/readyz" });
    res.status(503).json({
      status: "not_ready",
      checks: {
        db: "error",
        rulesRegistry: areRulesRegistered() ? "ok" : "not_ready",
      },
      timestamp: new Date().toISOString(),
      ...operationalMetadata(),
    });
  }
});

export default router;
