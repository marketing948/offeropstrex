import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireWorkspaceFromQuery } from "../lib/workspace-access";
import { getSettingValue, upsertSetting } from "../lib/settings-store";

const router: IRouter = Router();

// The legacy global Voluum settings endpoints (GET/PATCH /settings/voluum)
// were removed. Voluum credentials live on the workspaces row and are managed
// per-workspace via Settings → Workspaces. Global Voluum settings were
// dangerous because they could mix data across workspaces during sync.
router.get("/settings/voluum", (_req, res) => {
  res.status(410).json({
    error: "Global Voluum settings have been removed. Configure Voluum credentials per workspace in Settings → Workspaces.",
  });
});
router.patch("/settings/voluum", (_req, res) => {
  res.status(410).json({
    error: "Global Voluum settings have been removed. Configure Voluum credentials per workspace in Settings → Workspaces.",
  });
});

const DEFAULT_GOALS_CONFIG = JSON.stringify({
  weights: { activity: 0.40, winner: 0.35, optimization: 0.15, discipline: 0.10 },
  roiThreshold: 10,
  pointActions: [
    { id: "batchCreated", name: "Batch Created", description: "Points awarded when a new testing batch is created", points: 2, enabled: true, category: "activity" },
    { id: "campaignLive", name: "Campaign Marked Live", description: "Points awarded when a batch goes live", points: 3, enabled: true, category: "activity" },
    { id: "optimizationCompleted", name: "Optimization Completed", description: "Points awarded when a batch completes optimization", points: 5, enabled: true, category: "activity" },
    { id: "scaleTaskCompleted", name: "Scale Task Completed", description: "Points awarded when a move-to-main scale task is created", points: 6, enabled: true, category: "activity" },
    { id: "taskCompleted", name: "Task Completed On Time", description: "Points awarded for each task completed before due date", points: 1, enabled: true, category: "activity" },
    { id: "retestedOffer", name: "Retest Completed", description: "Points awarded for retesting an offer", points: 4, enabled: true, category: "activity" },
    { id: "winnerFound", name: "Winner Found", description: "Points awarded when an offer is classified as winner or scaling", points: 10, enabled: true, category: "winner" },
    { id: "winnerMoved", name: "Winner Moved to Scale", description: "Points awarded when a scale task is created", points: 20, enabled: true, category: "winner" },
    { id: "successfulOptimization", name: "Successful Optimization", description: "Bonus points for each batch that reaches completed or scaling status", points: 10, enabled: true, category: "optimization" },
    { id: "noOverdueTasks", name: "No Overdue Tasks Bonus", description: "Bonus when employee has zero overdue tasks", points: 10, enabled: true, category: "discipline" },
    { id: "allTasksOnTime", name: "All Tasks On Time Bonus", description: "Additional bonus when all tasks are completed on time", points: 15, enabled: true, category: "discipline" },
  ],
  comboBonuses: [
    { id: "c1", name: "Winner Streak", description: "Find 3 winners in one month", triggerType: "winners_monthly", threshold: 3, rewardPoints: 50, active: true, repeatable: false, monthlyLimit: 1 },
    { id: "c2", name: "Optimization Machine", description: "Complete 5 optimizations", triggerType: "optimizations_monthly", threshold: 5, rewardPoints: 40, active: true, repeatable: false, monthlyLimit: 1 },
    { id: "c3", name: "Scale King", description: "Create a scale task for a winner", triggerType: "scale_tasks_monthly", threshold: 1, rewardPoints: 100, active: true, repeatable: true, monthlyLimit: 0 },
    { id: "c4", name: "Batch Factory", description: "Create 10 batches in a month", triggerType: "batches_monthly", threshold: 10, rewardPoints: 30, active: true, repeatable: false, monthlyLimit: 1 },
    { id: "c5", name: "Elite Optimizer", description: "Find 5+ winners in a month", triggerType: "winners_monthly", threshold: 5, rewardPoints: 75, active: true, repeatable: false, monthlyLimit: 1 },
  ],
  ranks: [
    { id: "r1", name: "Junior Buyer", minScore: 0, bonusAmount: 0, color: "slate", icon: "Target" },
    { id: "r2", name: "Active Buyer", minScore: 300, bonusAmount: 50, color: "blue", icon: "Star" },
    { id: "r3", name: "Strong Buyer", minScore: 500, bonusAmount: 125, color: "green", icon: "TrendingUp" },
    { id: "r4", name: "Killer Buyer", minScore: 800, bonusAmount: 200, color: "orange", icon: "Zap" },
    { id: "r5", name: "Elite Buyer", minScore: 1200, bonusAmount: 300, color: "purple", icon: "Crown" },
  ],
  penalties: [
    { id: "p1", name: "Overdue Task", description: "Points deducted per overdue task", triggerCondition: "overdue_task", pointsDeducted: 5, enabled: true },
    { id: "p2", name: "Batch Stuck Too Long", description: "Points deducted for batches stuck >14 days", triggerCondition: "inactive_batch", pointsDeducted: 10, enabled: false },
    { id: "p3", name: "Missing Optimization", description: "Points deducted when a ready batch is not optimized within 3 days", triggerCondition: "delayed_optimization", pointsDeducted: 8, enabled: false },
  ],
  bonusEvents: [
    { id: "be1", name: "Double Winner Week", description: "Winner Found points x2", multiplierTarget: "winnerFound", multiplier: 2, active: false, expiresAt: null },
    { id: "be2", name: "Batch Blitz", description: "Batch Created points x1.5", multiplierTarget: "batchCreated", multiplier: 1.5, active: false, expiresAt: null },
  ],
  kpiTargets: [
    { id: "kt1", name: "Batches Created", key: "batches", monthlyTarget: 20 },
    { id: "kt2", name: "Live Campaigns", key: "liveCampaigns", monthlyTarget: 40 },
    { id: "kt3", name: "Optimizations Completed", key: "optimizations", monthlyTarget: 30 },
    { id: "kt4", name: "Winners Found", key: "winners", monthlyTarget: 10 },
    { id: "kt5", name: "Scale Tasks Created", key: "scaleTasks", monthlyTarget: 5 },
  ],
});

router.get("/settings/goals", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;
  const raw = await getSettingValue(workspaceId, "goals_config");
  try {
    res.json(JSON.parse(raw ?? DEFAULT_GOALS_CONFIG));
  } catch {
    res.json(JSON.parse(DEFAULT_GOALS_CONFIG));
  }
});

router.patch("/settings/goals", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;
  const body = req.body;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  // Extract and strip admin audit info before saving
  const { _adminInfo, ...config } = body as Record<string, unknown>;
  await upsertSetting(workspaceId, "goals_config", JSON.stringify(config));

  // Append audit log entry
  if (_adminInfo && typeof _adminInfo === "object") {
    const ai = _adminInfo as Record<string, unknown>;
    const entry = {
      timestamp: new Date().toISOString(),
      adminId: ai.adminId ?? 0,
      adminName: ai.adminName ?? "Admin",
      summary: ai.summary ?? "Configuration updated",
      tab: ai.tab ?? null,
    };
    const existing = await getSettingValue(workspaceId, "goals_audit_log");
    const log: unknown[] = existing ? JSON.parse(existing) : [];
    log.unshift(entry);
    await upsertSetting(workspaceId, "goals_audit_log", JSON.stringify(log.slice(0, 50)));
  }

  const saved = await getSettingValue(workspaceId, "goals_config");
  res.json(JSON.parse(saved ?? DEFAULT_GOALS_CONFIG));
});

router.get("/settings/goals-audit", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;
  const raw = await getSettingValue(workspaceId, "goals_audit_log");
  res.json(raw ? JSON.parse(raw) : []);
});

// ─── Traffic source × device plan (REMOVED in Phase 2) ────────────────
// The legacy `traffic_source_device_plans` table backed an
// (any traffic source) × (5 fixed device labels) matrix per workspace.
// Phase 2 dropped that table in favour of the canonical
// `workspace_traffic_sources` + per-batch iOS/Android tracker_campaigns
// model. These endpoints return 410 Gone so any client still calling
// them gets a clear, non-silent failure. Phase 4 ships the replacement
// `/settings/workspace-traffic-sources` endpoints.
router.get("/settings/traffic-source-device-plan", (_req, res) => {
  res.status(410).json({
    error: "The traffic-source × device plan has been replaced. Configure traffic sources per workspace in Settings → Workspaces → Traffic Sources (Phase 4).",
  });
});
router.put("/settings/traffic-source-device-plan", (_req, res) => {
  res.status(410).json({
    error: "The traffic-source × device plan has been replaced. Configure traffic sources per workspace in Settings → Workspaces → Traffic Sources (Phase 4).",
  });
});

// Suppress unused-import warnings for symbols Phase 4 will bring back.
void z;
void requireWorkspaceFromQuery;
void getSettingValue;
void upsertSetting;

export default router;
