import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import {
  db,
  employeesTable,
  operationalActivityFeedTable,
  xpLedgerTable,
  campaignWinnersTable,
  campaignsTable,
  testingBatchesTable,
  affiliateNetworksTable,
  workerAffiliateNetworksTable,
} from "@workspace/db";
import { requireWorkspaceFromQuery, requireWorkspaceAccess } from "../lib/workspace-access.ts";
import { getEmployeeFromToken } from "../routes/auth.ts";
import {
  enforceEmployeeIdAccess,
  requireWorkspaceWithNetworkScope,
} from "../lib/worker-network-access.ts";
import {
  buildMonthlyGoalsDashboard,
} from "../lib/monthly-goals-service.ts";
import { buildMetricBreakdown } from "../lib/metric-breakdown-service.ts";
import { currentMonthKey, monthKeyToRange } from "../lib/xp-award-service.ts";
import {
  loadGoalsConfig,
  findDuplicateGoal,
  goalsForMonth,
} from "../lib/goals-config-server.ts";
import { removeNetworkGoalsFromTargets } from "../lib/goal-plan-scope.ts";
import { getSettingValue, upsertSetting } from "../lib/settings-store.ts";
import { awardXp, rewardRuleIdempotencyKey } from "../lib/xp-award-service.ts";
import {
  findEnabledPointAction,
  resolveTaskXpActionType,
} from "../lib/performance-action-catalog.ts";

const router: IRouter = Router();

const monthKeySchema = z.string().regex(/^\d{4}-\d{2}$/);

const goalMetricKeySchema = z.enum(["revenue", "testingBatches", "workingCampaigns"]);

const upsertGoalSchema = z.object({
  workspaceId: z.number().int().positive(),
  goal: z.object({
    id: z.string().min(1),
    employeeId: z.number().int().positive(),
    employeeName: z.string().optional(),
    affiliateNetworkId: z.number().int().positive().nullable().optional(),
    affiliateNetworkName: z.string().nullable().optional(),
    geoId: z.number().int().positive().nullable().optional(),
    geoCode: z.string().nullable().optional(),
    selectedGeoCodes: z.array(z.string().min(1)).nullable().optional(),
    metricKey: goalMetricKeySchema,
    monthlyTarget: z.number().nonnegative(),
    isActive: z.boolean(),
    monthKey: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
    xpReward: z.number().int().nonnegative().nullable().optional(),
    overachieveXpReward: z.number().int().nonnegative().nullable().optional(),
    notes: z.string().optional(),
  }).superRefine((goal, ctx) => {
    const hasGeo = Boolean(goal.geoCode?.trim());
    if (!hasGeo && goal.monthlyTarget <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Network and worker-wide goals require a positive monthlyTarget.",
        path: ["monthlyTarget"],
      });
    }
  }),
  replaceExisting: z.boolean().optional(),
});

const replaceGoalPlanSchema = z.object({
  workspaceId: z.number().int().positive(),
  employeeId: z.number().int().positive(),
  employeeName: z.string().optional(),
  monthKey: monthKeySchema,
  affiliateNetworkName: z.string().nullable().optional(),
  affiliateNetworkId: z.number().int().positive().nullable().optional(),
  selectedGeoCodes: z.array(z.string().min(1)).optional(),
  metrics: z.array(
    z.object({
      metricKey: goalMetricKeySchema,
      monthlyTarget: z.number().positive(),
      xpReward: z.number().int().nonnegative().optional(),
      enabled: z.boolean(),
    }),
  ),
  geoOverrides: z
    .array(
      z.object({
        metricKey: goalMetricKeySchema,
        geoCode: z.string().min(1),
        geoId: z.number().int().positive().nullable().optional(),
        monthlyTarget: z.number().nonnegative(),
      }),
    )
    .optional(),
});

const resetNetworkGoalPlanSchema = z.object({
  workspaceId: z.number().int().positive(),
  employeeId: z.number().int().positive(),
  monthKey: monthKeySchema,
  affiliateNetworkName: z.string().min(1),
  confirmation: z.literal(true),
});

router.get("/performance/monthly-goals", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const scoped = await requireWorkspaceWithNetworkScope(req, res, workspaceId);
  if (scoped === null) return;

  const monthRaw = req.query.month;
  const monthKey =
    typeof monthRaw === "string" && monthKeySchema.safeParse(monthRaw).success
      ? monthRaw
      : currentMonthKey();

  const employeeIdRaw = req.query.employee_id;
  let scopeEmployeeId: number | undefined;
  if (employeeIdRaw != null && employeeIdRaw !== "") {
    const n = Number(employeeIdRaw);
    if (!Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: "employee_id must be a positive integer" });
      return;
    }
    if (!enforceEmployeeIdAccess(res, scoped.scope, n)) return;
    scopeEmployeeId = n;
  } else if (!scoped.scope.isAdmin) {
    scopeEmployeeId = scoped.scope.employeeId;
  }

  const dashboard = await buildMonthlyGoalsDashboard(workspaceId, monthKey, scopeEmployeeId);
  res.json(dashboard);
});

router.get("/performance/metric-breakdown", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const scoped = await requireWorkspaceWithNetworkScope(req, res, workspaceId);
  if (scoped === null) return;

  const metricRaw = req.query.metric;
  const metricParsed = z.enum(["revenue", "testing", "working"]).safeParse(metricRaw);
  if (!metricParsed.success) {
    res.status(400).json({ error: "metric must be revenue, testing, or working" });
    return;
  }

  const monthKey =
    typeof req.query.month === "string" && monthKeySchema.safeParse(req.query.month).success
      ? req.query.month
      : currentMonthKey();

  const employeeIdRaw = req.query.employee_id;
  let employeeId: number | null = null;
  if (employeeIdRaw != null && employeeIdRaw !== "") {
    const n = Number(employeeIdRaw);
    if (!Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: "employee_id must be a positive integer" });
      return;
    }
    if (!enforceEmployeeIdAccess(res, scoped.scope, n)) return;
    employeeId = n;
  } else if (!scoped.scope.isAdmin) {
    employeeId = scoped.scope.employeeId;
  }

  const breakdown = await buildMetricBreakdown(
    workspaceId,
    monthKey,
    metricParsed.data,
    employeeId,
    scoped.scope.isAdmin ? undefined : scoped.scope.allowedNetworkNames ?? [],
  );
  res.json(breakdown);
});

router.get("/performance/xp-history", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const employeeId = Number(req.query.employee_id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    res.status(400).json({ error: "employee_id is required" });
    return;
  }

  const monthKey =
    typeof req.query.month === "string" && monthKeySchema.safeParse(req.query.month).success
      ? req.query.month
      : currentMonthKey();

  const { dateFrom, dateToExclusive } = monthKeyToRange(monthKey);
  const rows = await db
    .select()
    .from(xpLedgerTable)
    .where(
      and(
        eq(xpLedgerTable.workspaceId, workspaceId),
        eq(xpLedgerTable.employeeId, employeeId),
        eq(xpLedgerTable.monthKey, monthKey),
        gte(xpLedgerTable.createdAt, dateFrom),
        lt(xpLedgerTable.createdAt, dateToExclusive),
      ),
    )
    .orderBy(xpLedgerTable.createdAt);

  const cumulative: { date: string; xp: number; cumulative: number }[] = [];
  let running = 0;
  for (const row of rows) {
    running += row.amount;
    cumulative.push({
      date: row.createdAt.toISOString().slice(0, 10),
      xp: row.amount,
      cumulative: running,
    });
  }

  res.json({ monthKey, employeeId, entries: rows, chart: cumulative, totalXp: running });
});

router.get("/performance/worker-breakdown", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const employeeId = Number(req.query.employee_id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    res.status(400).json({ error: "employee_id is required" });
    return;
  }

  const monthKey =
    typeof req.query.month === "string" && monthKeySchema.safeParse(req.query.month).success
      ? req.query.month
      : currentMonthKey();

  const cfg = await loadGoalsConfig(workspaceId);
  const goals = goalsForMonth(cfg.workerGoalTargets, monthKey).filter(
    (g) => g.employeeId === employeeId,
  );

  const networks = new Map<string, { target: number; current: number }>();
  const geos = new Map<string, { target: number; current: number }>();
  for (const g of goals) {
    if (g.affiliateNetworkName) {
      const k = g.affiliateNetworkName;
      const ex = networks.get(k) ?? { target: 0, current: 0 };
      ex.target += g.monthlyTarget;
      networks.set(k, ex);
    }
    if (g.geoCode) {
      const k = g.geoCode;
      const ex = geos.get(k) ?? { target: 0, current: 0 };
      ex.target += g.monthlyTarget;
      geos.set(k, ex);
    }
  }

  const range = monthKeyToRange(monthKey);
  const winners = await db
    .select({
      offerId: campaignWinnersTable.offerId,
      campaignId: campaignWinnersTable.campaignId,
      geo: testingBatchesTable.geo,
      network: testingBatchesTable.affiliateNetwork,
      batchName: testingBatchesTable.batchName,
    })
    .from(campaignWinnersTable)
    .innerJoin(campaignsTable, eq(campaignWinnersTable.campaignId, campaignsTable.id))
    .innerJoin(testingBatchesTable, eq(campaignsTable.batchId, testingBatchesTable.id))
    .where(
      and(
        eq(campaignWinnersTable.workspaceId, workspaceId),
        eq(testingBatchesTable.employeeId, employeeId),
        gte(campaignWinnersTable.createdAt, range.dateFrom),
        lt(campaignWinnersTable.createdAt, range.dateToExclusive),
      ),
    )
    .orderBy(desc(campaignWinnersTable.createdAt))
    .limit(10);

  res.json({
    networks: [...networks.entries()].map(([name, v]) => ({ name, ...v })),
    geos: [...geos.entries()].map(([code, v]) => ({ code, ...v })),
    topWinners: winners.map((w) => ({
      name: w.batchName ?? `Campaign #${w.campaignId}`,
      geo: w.geo ?? "—",
      network: w.network ?? "—",
    })),
  });
});

router.get("/performance/worker-activity", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const employeeId = Number(req.query.employee_id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    res.status(400).json({ error: "employee_id is required" });
    return;
  }

  const monthKey =
    typeof req.query.month === "string" && monthKeySchema.safeParse(req.query.month).success
      ? req.query.month
      : currentMonthKey();

  const { dateFrom, dateToExclusive } = monthKeyToRange(monthKey);
  const rows = await db
    .select()
    .from(operationalActivityFeedTable)
    .where(
      and(
        eq(operationalActivityFeedTable.workspaceId, workspaceId),
        eq(operationalActivityFeedTable.actorEmployeeId, employeeId),
        gte(operationalActivityFeedTable.createdAt, dateFrom),
        lt(operationalActivityFeedTable.createdAt, dateToExclusive),
      ),
    )
    .orderBy(desc(operationalActivityFeedTable.createdAt))
    .limit(50);

  const xpRows = await db
    .select()
    .from(xpLedgerTable)
    .where(
      and(
        eq(xpLedgerTable.workspaceId, workspaceId),
        eq(xpLedgerTable.employeeId, employeeId),
        eq(xpLedgerTable.monthKey, monthKey),
      ),
    )
    .orderBy(desc(xpLedgerTable.createdAt))
    .limit(20);

  res.json({
    activity: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      eventType: r.eventType,
      createdAt: r.createdAt.toISOString(),
    })),
    xpEvents: xpRows.map((r) => ({
      id: r.id,
      amount: r.amount,
      sourceType: r.sourceType,
      label:
        r.sourceType === "goal_completion"
          ? `Goal completed: ${r.metricKey ?? "goal"}`
          : `Reward: ${r.actionType ?? r.rewardRuleId ?? "rule"}`,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

async function assertWorkerNetworkAccess(
  workspaceId: number,
  employeeId: number,
  affiliateNetworkName: string | null | undefined,
  affiliateNetworkId: number | null | undefined,
  res: import("express").Response,
): Promise<boolean> {
  if (!affiliateNetworkName && !affiliateNetworkId) return true;

  let networkId = affiliateNetworkId ?? null;
  if (!networkId && affiliateNetworkName) {
    const [net] = await db
      .select({ id: affiliateNetworksTable.id })
      .from(affiliateNetworksTable)
      .where(
        and(
          eq(affiliateNetworksTable.workspaceId, workspaceId),
          eq(affiliateNetworksTable.name, affiliateNetworkName),
        ),
      )
      .limit(1);
    networkId = net?.id ?? null;
  }
  if (networkId) {
    const [assign] = await db
      .select({ id: workerAffiliateNetworksTable.id })
      .from(workerAffiliateNetworksTable)
      .where(
        and(
          eq(workerAffiliateNetworksTable.workspaceId, workspaceId),
          eq(workerAffiliateNetworksTable.employeeId, employeeId),
          eq(workerAffiliateNetworksTable.affiliateNetworkId, networkId),
        ),
      )
      .limit(1);
    if (!assign) {
      res.status(403).json({ error: "Worker does not have access to this affiliate network." });
      return false;
    }
  }
  return true;
}

function goalMatchesPlanScope(
  g: { employeeId: number; monthKey?: string | null; affiliateNetworkName?: string | null },
  employeeId: number,
  monthKey: string,
  affiliateNetworkName: string | null | undefined,
): boolean {
  if (g.employeeId !== employeeId) return false;
  if (!g.monthKey || g.monthKey !== monthKey) return false;
  const net = (g.affiliateNetworkName ?? "").trim();
  const scopeNet = (affiliateNetworkName ?? "").trim();
  if (scopeNet) return net === scopeNet;
  return !net;
}

function sortSelectedGeoCodes(codes: string[]): string[] {
  return [...new Set(codes.map((c) => c.trim()).filter(Boolean))].sort((a, b) =>
    a.toUpperCase().localeCompare(b.toUpperCase()),
  );
}

router.post("/performance/worker-goals/plan", async (req, res): Promise<void> => {
  const employee = await getEmployeeFromToken(req);
  if (!employee || employee.role !== "admin") {
    res.status(employee ? 403 : 401).json({ error: employee ? "Admin access required" : "Unauthorized" });
    return;
  }

  const parsed = replaceGoalPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    workspaceId,
    employeeId,
    employeeName,
    monthKey,
    affiliateNetworkName,
    affiliateNetworkId,
    selectedGeoCodes,
    metrics,
    geoOverrides,
  } = parsed.data;

  if ((await requireWorkspaceAccess(req, res, workspaceId)) === null) return;

  const scopeNet = affiliateNetworkName?.trim() || null;
  if (scopeNet) {
    const enabledMetrics = metrics.filter((m) => m.enabled);
    if (enabledMetrics.length === 0) {
      res.status(400).json({ error: "Enable at least one metric for this network plan." });
      return;
    }
    if (!selectedGeoCodes || selectedGeoCodes.length === 0) {
      res.status(400).json({ error: "Select at least one GEO for network-scoped goal plans." });
      return;
    }
    if (
      !(await assertWorkerNetworkAccess(
        workspaceId,
        employeeId,
        scopeNet,
        affiliateNetworkId ?? null,
        res,
      ))
    ) {
      return;
    }
  }

  const raw = await getSettingValue(workspaceId, "goals_config");
  let cfg: Record<string, unknown> = {};
  try {
    cfg = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    cfg = {};
  }

  const targets = Array.isArray(cfg.workerGoalTargets)
    ? (cfg.workerGoalTargets as Array<Record<string, unknown>>)
    : [];

  const kept = targets.filter(
    (g) =>
      !goalMatchesPlanScope(
        g as { employeeId: number; monthKey?: string | null; affiliateNetworkName?: string | null },
        employeeId,
        monthKey,
        scopeNet,
      ),
  );

  const now = new Date().toISOString();
  const ts = Date.now();
  const nextGoals: Record<string, unknown>[] = [];

  for (const metric of metrics) {
    if (!metric.enabled) continue;
    nextGoals.push({
      id: `wg_${metric.metricKey}_${employeeId}_${monthKey}_${ts}_${nextGoals.length}`,
      employeeId,
      employeeName,
      monthKey,
      isActive: true,
      metricKey: metric.metricKey,
      monthlyTarget: metric.monthlyTarget,
      xpReward: metric.xpReward ?? 0,
      affiliateNetworkId: scopeNet ? (affiliateNetworkId ?? null) : null,
      affiliateNetworkName: scopeNet,
      geoId: null,
      geoCode: null,
      selectedGeoCodes: scopeNet ? sortSelectedGeoCodes(selectedGeoCodes ?? []) : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const override of geoOverrides ?? []) {
    if (!scopeNet) continue;
    const selected = new Set((selectedGeoCodes ?? []).map((c) => c.trim().toUpperCase()));
    if (!selected.has(override.geoCode.trim().toUpperCase())) continue;
    nextGoals.push({
      id: `wg_${override.metricKey}_${employeeId}_${monthKey}_${override.geoCode}_${ts}_${nextGoals.length}`,
      employeeId,
      employeeName,
      monthKey,
      isActive: true,
      metricKey: override.metricKey,
      monthlyTarget: override.monthlyTarget,
      xpReward: 0,
      affiliateNetworkId: affiliateNetworkId ?? null,
      affiliateNetworkName: scopeNet,
      geoId: override.geoId ?? null,
      geoCode: override.geoCode,
      selectedGeoCodes: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  cfg.workerGoalTargets = [...kept, ...nextGoals];
  await upsertSetting(workspaceId, "goals_config", JSON.stringify(cfg));

  res.json({ ok: true, goals: nextGoals });
});

router.post("/performance/worker-goals/plan/reset-network", async (req, res): Promise<void> => {
  const employee = await getEmployeeFromToken(req);
  if (!employee || employee.role !== "admin") {
    res.status(employee ? 403 : 401).json({ error: employee ? "Admin access required" : "Unauthorized" });
    return;
  }

  const parsed = resetNetworkGoalPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { workspaceId, employeeId, monthKey, affiliateNetworkName } = parsed.data;
  if ((await requireWorkspaceAccess(req, res, workspaceId)) === null) return;

  const scopeNet = affiliateNetworkName.trim();
  if (
    !(await assertWorkerNetworkAccess(workspaceId, employeeId, scopeNet, null, res))
  ) {
    return;
  }

  const raw = await getSettingValue(workspaceId, "goals_config");
  let cfg: Record<string, unknown> = {};
  try {
    cfg = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    cfg = {};
  }

  const targets = Array.isArray(cfg.workerGoalTargets)
    ? (cfg.workerGoalTargets as import("../lib/goals-config-server.ts").ServerWorkerGoalTarget[])
    : [];

  const { kept, removed } = removeNetworkGoalsFromTargets(
    targets,
    employeeId,
    monthKey,
    scopeNet,
  );

  cfg.workerGoalTargets = kept;
  await upsertSetting(workspaceId, "goals_config", JSON.stringify(cfg));

  res.json({ ok: true, removedCount: removed.length, removedGoalIds: removed.map((g) => g.id) });
});

router.post("/performance/worker-goals", async (req, res): Promise<void> => {
  const employee = await getEmployeeFromToken(req);
  if (!employee || employee.role !== "admin") {
    res.status(employee ? 403 : 401).json({ error: employee ? "Admin access required" : "Unauthorized" });
    return;
  }

  const parsed = upsertGoalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { workspaceId, goal, replaceExisting } = parsed.data;
  if ((await requireWorkspaceAccess(req, res, workspaceId)) === null) return;

  if (goal.affiliateNetworkId || goal.affiliateNetworkName) {
    let networkId = goal.affiliateNetworkId ?? null;
    if (!networkId && goal.affiliateNetworkName) {
      const [net] = await db
        .select({ id: affiliateNetworksTable.id })
        .from(affiliateNetworksTable)
        .where(
          and(
            eq(affiliateNetworksTable.workspaceId, workspaceId),
            eq(affiliateNetworksTable.name, goal.affiliateNetworkName),
          ),
        )
        .limit(1);
      networkId = net?.id ?? null;
    }
    if (networkId) {
      const [assign] = await db
        .select({ id: workerAffiliateNetworksTable.id })
        .from(workerAffiliateNetworksTable)
        .where(
          and(
            eq(workerAffiliateNetworksTable.workspaceId, workspaceId),
            eq(workerAffiliateNetworksTable.employeeId, goal.employeeId),
            eq(workerAffiliateNetworksTable.affiliateNetworkId, networkId),
          ),
        )
        .limit(1);
      if (!assign) {
        res.status(403).json({ error: "Worker does not have access to this affiliate network." });
        return;
      }
    }
  }

  const raw = await getSettingValue(workspaceId, "goals_config");
  let cfg: Record<string, unknown> = {};
  try {
    cfg = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    cfg = {};
  }

  const targets = Array.isArray(cfg.workerGoalTargets)
    ? (cfg.workerGoalTargets as typeof parsed.data.goal[])
    : [];

  const dup = findDuplicateGoal(targets, {
    ...goal,
    monthKey: goal.monthKey ?? null,
  }, goal.id);

  if (dup && !replaceExisting) {
    res.status(409).json({
      error: "duplicate_goal",
      message: "A goal already exists for this worker/month/metric/network/GEO.",
      existingGoal: dup,
    });
    return;
  }

  const nextGoal = {
    ...goal,
    monthKey: goal.monthKey ?? null,
    createdAt: dup?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let nextTargets;
  if (dup && replaceExisting) {
    nextTargets = targets.map((g) => (g.id === dup.id ? { ...g, ...nextGoal, id: dup.id } : g));
  } else if (targets.some((g) => g.id === goal.id)) {
    nextTargets = targets.map((g) => (g.id === goal.id ? { ...g, ...nextGoal } : g));
  } else {
    nextTargets = [...targets, nextGoal];
  }

  cfg.workerGoalTargets = nextTargets;
  await upsertSetting(workspaceId, "goals_config", JSON.stringify(cfg));

  res.json({ ok: true, goal: nextGoal });
});

export default router;

// Re-export for task XP wiring
export async function awardTaskCompletionXp(
  workspaceId: number,
  employeeId: number,
  taskType: string,
  taskId: number,
  client: Parameters<typeof awardXp>[0] = db,
): Promise<void> {
  const cfg = await loadGoalsConfig(workspaceId);
  const catalogActionType = resolveTaskXpActionType(taskType);
  const action = findEnabledPointAction(cfg.pointActions, catalogActionType);
  if (!action || (action.points ?? 0) <= 0) return;

  const ruleId = action.id;
  const monthKey = currentMonthKey();
  await awardXp(client, {
    workspaceId,
    employeeId,
    monthKey,
    amount: action.points ?? 0,
    sourceType: "reward_rule",
    idempotencyKey: rewardRuleIdempotencyKey(workspaceId, employeeId, ruleId, catalogActionType, String(taskId)),
    rewardRuleId: ruleId,
    actionType: catalogActionType,
    entityId: String(taskId),
    metadata: { actionName: action.name, taskType },
  });
}
