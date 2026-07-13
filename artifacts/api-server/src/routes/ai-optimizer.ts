/**
 * AI Optimizer — admin-only, stateless deterministic CSV optimization.
 *
 * No DB, no persisted run, no temporary file storage. Both endpoints receive
 * the raw CSV text (the frontend reads the file with `File.text()`, mirroring
 * the existing Voluum metrics import) and recompute everything server-side.
 *
 * Auth: every route requires an authenticated admin (`requireAdmin` → 401 when
 * unauthenticated, 403 for workers). The optimizer touches no workspace-scoped
 * data, so admin role is the correct guard and no workspace check applies.
 *
 * Body size: the global `express.json()` limit is small; `app.ts` mounts a
 * larger JSON parser scoped to `/api/ai-optimizer` before the global one.
 */

import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAdmin } from "../lib/workspace-access.ts";
import {
  analyzeOptimization,
  buildDecisionReportCsv,
  buildOptimizedCampaignCsv,
} from "../lib/ai-optimizer/optimizer.ts";

const router: IRouter = Router();

const analyzeBodySchema = z.object({
  campaignCsv: z.string().min(1, "campaignCsv is required"),
  voluumCsv: z.string().min(1, "voluumCsv is required"),
  revenueThreshold: z.union([z.number(), z.string()]).optional(),
});

const exportBodySchema = z.object({
  campaignCsv: z.string().min(1, "campaignCsv is required"),
  voluumCsv: z.string().min(1, "voluumCsv is required"),
  revenueThreshold: z.union([z.number(), z.string()]).optional(),
  pathCount: z.number().int().min(1),
  exportType: z.enum(["campaign", "report"]),
  campaignFileName: z.string().optional(),
});

router.post("/ai-optimizer/analyze", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;

  const parsed = analyzeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }

  const result = analyzeOptimization(parsed.data);
  if (!result.ok) {
    res.status(422).json({ error: result.error });
    return;
  }

  res.status(200).json({
    threshold: result.threshold,
    campaignHeaders: result.campaignHeaders,
    decisions: result.decisions,
    summary: result.summary,
    warnings: result.warnings,
    brandSource: result.brandSource,
  });
});

router.post("/ai-optimizer/export", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;

  const parsed = exportBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }

  const { exportType, ...input } = parsed.data;
  const result =
    exportType === "campaign"
      ? buildOptimizedCampaignCsv(input)
      : buildDecisionReportCsv(input);

  if (!result.ok) {
    res.status(422).json({ error: result.error });
    return;
  }

  res.status(200).json({ filename: result.filename, csv: result.csv });
});

export default router;
