import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Employee, TestingBatch, Offer, TodoTask } from "@workspace/api-client-react";
import { useWorkspace } from "@/lib/workspace-context";
import { readAuthToken, authedJson } from "@/lib/api-fetch";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface PointAction {
  id: string;
  /** Canonical catalog action type — trigger identity */
  actionType?: string;
  name: string;
  description: string;
  points: number;
  enabled: boolean;
  category: "activity" | "winner" | "optimization" | "discipline";
}

export interface ComboBonus {
  id: string;
  name: string;
  description: string;
  triggerType: string;
  threshold: number;
  rewardPoints: number;
  active: boolean;
  repeatable: boolean;
  monthlyLimit: number; // 0 = unlimited
}

export interface RankTier {
  id: string;
  name: string;
  minScore: number;
  bonusAmount: number; // admin-only
  color: string; // slate | blue | green | orange | purple | red | yellow
  icon: string;  // icon name
}

export interface Penalty {
  id: string;
  actionType?: string;
  name: string;
  description: string;
  triggerCondition: string;
  pointsDeducted: number;
  enabled: boolean;
}

export interface BonusEvent {
  id: string;
  bonusEventType?: string;
  name: string;
  description: string;
  multiplierTarget: string;
  multiplier: number;
  xpAmount?: number;
  active: boolean;
  expiresAt: string | null;
}

export interface KpiTarget {
  id: string;
  name: string;
  key: string;
  monthlyTarget: number;
}

export type { WorkerGoalTarget, EventPointRule, WorkerGoalMetricKey } from "@/lib/worker-goals";

import type { WorkerGoalTarget, EventPointRule } from "@/lib/worker-goals";
import { resolveXpCatalogFromRule } from "@/lib/performance-engine/action-catalog";

function migratePointActions(actions: PointAction[]): PointAction[] {
  return actions.map((a) => {
    const entry = resolveXpCatalogFromRule(a);
    if (entry) {
      return {
        ...a,
        actionType: entry.actionType,
        id: entry.legacyRuleIds?.[0] ?? entry.actionType,
        name: a.name || entry.label,
        description: a.description || entry.description,
      };
    }
    return { ...a, actionType: a.actionType ?? a.id };
  });
}

export interface GoalsConfig {
  pointActions: PointAction[];
  comboBonuses: ComboBonus[];
  ranks: RankTier[];
  penalties: Penalty[];
  bonusEvents: BonusEvent[];
  kpiTargets: KpiTarget[];
  workerGoalTargets: WorkerGoalTarget[];
  eventPointRules: EventPointRule[];
  weights: { activity: number; winner: number; optimization: number; discipline: number };
  roiThreshold: number;
}

export interface AuditEntry {
  timestamp: string;
  adminId: number;
  adminName: string;
  summary: string;
  tab?: string;
}

// ─────────────────────────────────────────────────────────────────
// Default config
// ─────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: GoalsConfig = {
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
    { id: "winnerMoved", name: "Winner Moved to Scale", description: "Points awarded when a scale task is created (implies winner → scale)", points: 20, enabled: true, category: "winner" },
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
    { id: "p2", name: "Batch Stuck Too Long", description: "Points deducted for batches stuck in one stage >14 days", triggerCondition: "inactive_batch", pointsDeducted: 10, enabled: false },
    { id: "p3", name: "Missing Optimization", description: "Points deducted when a ready batch is not optimized within 3 days", triggerCondition: "delayed_optimization", pointsDeducted: 8, enabled: false },
  ],
  bonusEvents: [
    { id: "be1", name: "Double Winner Week", description: "Winner Found points x2 for a limited time", multiplierTarget: "winnerFound", multiplier: 2, active: false, expiresAt: null },
    { id: "be2", name: "Batch Blitz", description: "Batch Created points x1.5 for a limited time", multiplierTarget: "batchCreated", multiplier: 1.5, active: false, expiresAt: null },
  ],
  kpiTargets: [
    { id: "kt1", name: "Batches Created", key: "batches", monthlyTarget: 20 },
    { id: "kt2", name: "Live Campaigns", key: "liveCampaigns", monthlyTarget: 40 },
    { id: "kt3", name: "Optimizations Completed", key: "optimizations", monthlyTarget: 30 },
    { id: "kt4", name: "Winners Found", key: "winners", monthlyTarget: 10 },
    { id: "kt5", name: "Scale Tasks Created", key: "scaleTasks", monthlyTarget: 5 },
    { id: "kt6", name: "Monthly Revenue", key: "revenue", monthlyTarget: 50000 },
    { id: "kt7", name: "Working Campaigns", key: "workingCampaigns", monthlyTarget: 10 },
    { id: "kt8", name: "Testing Pipeline", key: "testingBatches", monthlyTarget: 8 },
  ],
  workerGoalTargets: [],
  eventPointRules: [
    {
      id: "epr_report_download",
      eventKey: "report_downloaded",
      label: "Downloaded report",
      points: 5,
      isActive: true,
      category: "report",
      description: "Configured rule — event tracking will apply when wired.",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Rank utilities
// ─────────────────────────────────────────────────────────────────

export const RANK_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  slate:  { text: "text-slate-700",  bg: "bg-slate-100",  border: "border-slate-300" },
  blue:   { text: "text-blue-700",   bg: "bg-blue-100",   border: "border-blue-300" },
  green:  { text: "text-green-700",  bg: "bg-green-100",  border: "border-green-300" },
  orange: { text: "text-orange-700", bg: "bg-orange-100", border: "border-orange-300" },
  purple: { text: "text-purple-700", bg: "bg-purple-100", border: "border-purple-300" },
  red:    { text: "text-red-700",    bg: "bg-red-100",    border: "border-red-300" },
  yellow: { text: "text-yellow-700", bg: "bg-yellow-100", border: "border-yellow-300" },
};

export function getRankForScore(score: number, cfg: GoalsConfig): RankTier {
  const sorted = [...cfg.ranks].sort((a, b) => a.minScore - b.minScore);
  let current = sorted[0] ?? DEFAULT_CONFIG.ranks[0];
  for (const r of sorted) { if (score >= r.minScore) current = r; }
  return current;
}

export function getNextRank(currentRank: RankTier, cfg: GoalsConfig): RankTier | null {
  const sorted = [...cfg.ranks].sort((a, b) => a.minScore - b.minScore);
  const idx = sorted.findIndex(r => r.id === currentRank.id);
  return idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;
}

// ─────────────────────────────────────────────────────────────────
// Scoring engine
// ─────────────────────────────────────────────────────────────────

export interface EmployeeMetrics {
  batches: number; liveCampaigns: number; optimizations: number;
  winners: number; retests: number; scaleTasks: number;
  tasksCompleted: number; overdueTasks: number; allTasksOnTime: boolean;
}

export interface EmployeeScores extends EmployeeMetrics {
  employeeId: number; name: string;
  activityRaw: number; winnerRaw: number; optimizationRaw: number; disciplineRaw: number;
  penaltyPoints: number; comboBonus: number; earnedCombos: string[];
  total: number;
}

export function getActionPoints(cfg: GoalsConfig, actionId: string): number {
  const action = cfg.pointActions.find(a => a.id === actionId && a.enabled);
  if (!action) return 0;
  let pts = action.points;
  const now = new Date();
  for (const ev of cfg.bonusEvents) {
    if (ev.active && ev.multiplierTarget === actionId && (!ev.expiresAt || new Date(ev.expiresAt) > now)) {
      pts = Math.round(pts * ev.multiplier);
    }
  }
  return pts;
}

function calcActionScore(cfg: GoalsConfig, actionId: string, quantity: number): number {
  return getActionPoints(cfg, actionId) * quantity;
}

export function computeMetrics(
  emp: Employee,
  batches: TestingBatch[],
  offers: Offer[],
  tasks: TodoTask[],
): EmployeeMetrics {
  const today = new Date();
  const myBatches = batches.filter(b => b.employeeId === emp.id);
  const myBatchIds = new Set(myBatches.map(b => b.id));
  const myOffers = offers.filter(o => myBatchIds.has(o.batchId));
  const myTasks = tasks.filter(t => t.employeeId === emp.id);

  // Phase 9: 6-state lifecycle. "Live campaigns" = trackers active in
  // Voluum (anything past the OFFER_READY gate). "Optimizations" =
  // batches whose winners have been picked (TESTED) or pushed live
  // and finished (COMPLETED).
  const liveCampaigns = myBatches.filter(b => ["LIVE_TESTS", "TESTED", "COMPLETED"].includes(b.status)).length;
  const optimizations = myBatches.filter(b => ["TESTED", "COMPLETED"].includes(b.status)).length;
  const winners = myOffers.filter(o => o.status === "winner").length;
  const retests = myOffers.filter(o => o.status === "retest").length;
  // Phase 2 task taxonomy: the legacy "move_to_main" scale-task type
  // has been replaced by FIND_WINNERS, which the engine emits when a
  // batch enters TESTED. Status enum is now TODO/IN_PROGRESS/BLOCKED/
  // DONE — DONE = completed; BLOCKED replaces "cancelled" semantically
  // (still excluded from overdue counts because the worker is waiting
  // on something external).
  const scaleTasks = myTasks.filter(t => t.taskType === "FIND_WINNERS").length;
  const tasksCompleted = myTasks.filter(t => t.status === "DONE").length;
  const overdueTasks = myTasks.filter(t =>
    t.status !== "DONE" && t.status !== "BLOCKED" &&
    t.dueDate && new Date(t.dueDate) < today
  ).length;
  const allTasksOnTime = myTasks.length > 0 &&
    myTasks.every(t => t.status === "DONE" || !t.dueDate || new Date(t.dueDate) >= today);

  return {
    batches: myBatches.length, liveCampaigns, optimizations,
    winners, retests, scaleTasks, tasksCompleted, overdueTasks, allTasksOnTime,
  };
}

export function computeScoreFromMetrics(metrics: EmployeeMetrics, cfg: GoalsConfig): Omit<EmployeeScores, "employeeId" | "name"> {
  const w = cfg.weights;

  const activityRaw =
    calcActionScore(cfg, "batchCreated", metrics.batches) +
    calcActionScore(cfg, "campaignLive", metrics.liveCampaigns) +
    calcActionScore(cfg, "optimizationCompleted", metrics.optimizations) +
    calcActionScore(cfg, "scaleTaskCompleted", metrics.scaleTasks) +
    calcActionScore(cfg, "taskCompleted", metrics.tasksCompleted) +
    calcActionScore(cfg, "retestedOffer", metrics.retests);

  const winnerRaw =
    calcActionScore(cfg, "winnerFound", metrics.winners) +
    calcActionScore(cfg, "winnerMoved", metrics.scaleTasks);

  const optimizationRaw = calcActionScore(cfg, "successfulOptimization", metrics.optimizations);

  const disciplineBase =
    calcActionScore(cfg, "noOverdueTasks", metrics.overdueTasks === 0 ? 1 : 0) +
    calcActionScore(cfg, "allTasksOnTime", metrics.allTasksOnTime ? 1 : 0);

  const penaltyPoints = cfg.penalties
    .filter(p => p.enabled && p.triggerCondition === "overdue_task")
    .reduce((acc, p) => acc + p.pointsDeducted * metrics.overdueTasks, 0);

  const disciplineRaw = Math.max(0, disciplineBase - penaltyPoints);

  // Combo bonuses
  const TRIGGER_VALS: Record<string, number> = {
    winners_monthly: metrics.winners,
    optimizations_monthly: metrics.optimizations,
    scale_tasks_monthly: metrics.scaleTasks,
    batches_monthly: metrics.batches,
    tasks_completed_monthly: metrics.tasksCompleted,
    no_overdue_tasks: metrics.overdueTasks === 0 ? 1 : 0,
  };

  const earnedCombos: string[] = [];
  let comboBonus = 0;
  for (const cb of cfg.comboBonuses) {
    if (!cb.active) continue;
    const val = TRIGGER_VALS[cb.triggerType] ?? 0;
    if (val >= cb.threshold) {
      comboBonus += cb.rewardPoints;
      earnedCombos.push(cb.name);
    }
  }

  const weighted = activityRaw * w.activity + winnerRaw * w.winner + optimizationRaw * w.optimization + disciplineRaw * w.discipline;
  const total = Math.round(weighted + comboBonus);

  return {
    ...metrics,
    activityRaw, winnerRaw, optimizationRaw, disciplineRaw,
    penaltyPoints, comboBonus, earnedCombos, total,
  };
}

export function computeScores(
  employees: Employee[],
  batches: TestingBatch[],
  offers: Offer[],
  tasks: TodoTask[],
  cfg: GoalsConfig,
): EmployeeScores[] {
  return employees.map(emp => {
    const metrics = computeMetrics(emp, batches, offers, tasks);
    const scores = computeScoreFromMetrics(metrics, cfg);
    return { employeeId: emp.id, name: emp.name, ...scores };
  }).sort((a, b) => b.total - a.total);
}

// ─────────────────────────────────────────────────────────────────
// API hooks
// ─────────────────────────────────────────────────────────────────

export const GOALS_CONFIG_KEY = (workspaceId: number | null) => ["/api/settings/goals", workspaceId];
export const GOALS_AUDIT_KEY = (workspaceId: number | null) => ["/api/settings/goals-audit", workspaceId];

export function useGoalsConfig() {
  const { activeWorkspaceId } = useWorkspace();
  return useQuery<GoalsConfig>({
    queryKey: GOALS_CONFIG_KEY(activeWorkspaceId),
    queryFn: () =>
      authedJson<GoalsConfig>(`/api/settings/goals?workspace_id=${activeWorkspaceId}`).then(migrateConfig),
    staleTime: 60000,
    placeholderData: DEFAULT_CONFIG,
    enabled: activeWorkspaceId != null,
  });
}

interface UpdateGoalsConfigPayload {
  config: GoalsConfig;
  adminId?: number;
  adminName?: string;
  summary?: string;
  tab?: string;
}

export function useUpdateGoalsConfig() {
  const qc = useQueryClient();
  const { activeWorkspaceId } = useWorkspace();
  return useMutation<GoalsConfig, Error, UpdateGoalsConfigPayload>({
    mutationFn: ({ config, adminId, adminName, summary, tab }) => {
      if (activeWorkspaceId == null) {
        return Promise.reject(new Error("No active workspace"));
      }
      return authedJson<GoalsConfig>(`/api/settings/goals?workspace_id=${activeWorkspaceId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...config, _adminInfo: { adminId, adminName, summary, tab } }),
      }).then(migrateConfig);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GOALS_CONFIG_KEY(activeWorkspaceId) });
      qc.invalidateQueries({ queryKey: GOALS_AUDIT_KEY(activeWorkspaceId) });
    },
  });
}

export function useGoalsAuditLog() {
  const { activeWorkspaceId } = useWorkspace();
  return useQuery<AuditEntry[]>({
    queryKey: GOALS_AUDIT_KEY(activeWorkspaceId),
    queryFn: async () => {
      const token = readAuthToken();
      const res = await fetch(`/api/settings/goals-audit?workspace_id=${activeWorkspaceId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`goals-audit ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 30000,
    enabled: activeWorkspaceId != null,
  });
}

// ─────────────────────────────────────────────────────────────────
// Config migration helper (old format → new format)
// ─────────────────────────────────────────────────────────────────

export function ensureGoalsConfig(raw: Partial<GoalsConfig> | null | undefined): GoalsConfig {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(raw && typeof raw === "object" ? raw : {}),
  };
  return {
    ...merged,
    pointActions: migratePointActions(
      Array.isArray(merged.pointActions) ? merged.pointActions : DEFAULT_CONFIG.pointActions,
    ),
    comboBonuses: Array.isArray(merged.comboBonuses) ? merged.comboBonuses : DEFAULT_CONFIG.comboBonuses,
    ranks: Array.isArray(merged.ranks) ? merged.ranks : DEFAULT_CONFIG.ranks,
    penalties: Array.isArray(merged.penalties) ? merged.penalties : DEFAULT_CONFIG.penalties,
    bonusEvents: Array.isArray(merged.bonusEvents) ? merged.bonusEvents : DEFAULT_CONFIG.bonusEvents,
    kpiTargets: Array.isArray(merged.kpiTargets) ? merged.kpiTargets : DEFAULT_CONFIG.kpiTargets,
    workerGoalTargets: Array.isArray(merged.workerGoalTargets) ? merged.workerGoalTargets : [],
    eventPointRules: Array.isArray(merged.eventPointRules)
      ? merged.eventPointRules
      : DEFAULT_CONFIG.eventPointRules,
    weights: merged.weights ?? DEFAULT_CONFIG.weights,
    roiThreshold: merged.roiThreshold ?? DEFAULT_CONFIG.roiThreshold,
  };
}

export function migrateConfig(raw: unknown): GoalsConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
  if (Array.isArray((raw as GoalsConfig).pointActions)) {
    return ensureGoalsConfig(raw as GoalsConfig);
  }
  return { ...DEFAULT_CONFIG };
}
