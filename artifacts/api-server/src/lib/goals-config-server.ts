import { getSettingValue } from "./settings-store.ts";

export type ServerWorkerGoalTarget = {
  id: string;
  employeeId: number;
  employeeName?: string;
  affiliateNetworkId?: number | null;
  affiliateNetworkName?: string | null;
  geoId?: number | null;
  geoCode?: string | null;
  metricKey: string;
  monthlyTarget: number;
  isActive: boolean;
  monthKey?: string | null;
  xpReward?: number | null;
  overachieveXpReward?: number | null;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ServerGoalsConfig = {
  workerGoalTargets: ServerWorkerGoalTarget[];
  pointActions: {
    id: string;
    name: string;
    points: number;
    enabled: boolean;
    category: string;
  }[];
  eventPointRules: {
    id: string;
    eventKey: string;
    label: string;
    points: number;
    isActive: boolean;
  }[];
  kpiTargets: { key: string; monthlyTarget: number }[];
};

/** Legacy pointActions defaults — must match frontend DEFAULT_CONFIG / awardTaskCompletionXp legacy ids. */
export const DEFAULT_POINT_ACTIONS: ServerGoalsConfig["pointActions"] = [
  { id: "batchCreated", name: "Batch Created", points: 2, enabled: true, category: "activity" },
  { id: "campaignLive", name: "Campaign Marked Live", points: 3, enabled: true, category: "activity" },
  { id: "optimizationCompleted", name: "Optimization Completed", points: 5, enabled: true, category: "activity" },
  { id: "scaleTaskCompleted", name: "Scale Task Completed", points: 6, enabled: true, category: "activity" },
  { id: "taskCompleted", name: "Task Completed On Time", points: 1, enabled: true, category: "activity" },
  { id: "retestedOffer", name: "Retest Completed", points: 4, enabled: true, category: "activity" },
  { id: "winnerFound", name: "Winner Found", points: 10, enabled: true, category: "winner" },
  { id: "winnerMoved", name: "Winner Moved to Scale", points: 20, enabled: true, category: "winner" },
  { id: "successfulOptimization", name: "Successful Optimization", points: 10, enabled: true, category: "optimization" },
  { id: "noOverdueTasks", name: "No Overdue Tasks Bonus", points: 10, enabled: true, category: "discipline" },
  { id: "allTasksOnTime", name: "All Tasks On Time Bonus", points: 15, enabled: true, category: "discipline" },
];

const EMPTY_CONFIG: ServerGoalsConfig = {
  workerGoalTargets: [],
  pointActions: [...DEFAULT_POINT_ACTIONS],
  eventPointRules: [],
  kpiTargets: [],
};

function resolvePointActions(parsed: Partial<ServerGoalsConfig>): ServerGoalsConfig["pointActions"] {
  if (!("pointActions" in parsed)) {
    return [...DEFAULT_POINT_ACTIONS];
  }
  return Array.isArray(parsed.pointActions) ? parsed.pointActions : [...DEFAULT_POINT_ACTIONS];
}

export async function loadGoalsConfig(workspaceId: number): Promise<ServerGoalsConfig> {
  const raw = await getSettingValue(workspaceId, "goals_config");
  if (!raw) return { ...EMPTY_CONFIG };
  try {
    const parsed = JSON.parse(raw) as Partial<ServerGoalsConfig>;
    return {
      workerGoalTargets: Array.isArray(parsed.workerGoalTargets) ? parsed.workerGoalTargets : [],
      pointActions: resolvePointActions(parsed),
      eventPointRules: Array.isArray(parsed.eventPointRules) ? parsed.eventPointRules : [],
      kpiTargets: Array.isArray(parsed.kpiTargets) ? parsed.kpiTargets : [],
    };
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

export function goalsForMonth(
  goals: ServerWorkerGoalTarget[],
  monthKey: string,
): ServerWorkerGoalTarget[] {
  return goals.filter(
    (g) =>
      g.isActive &&
      g.monthlyTarget > 0 &&
      (!g.monthKey || g.monthKey === monthKey),
  );
}

export function workerGoalRowKey(g: ServerWorkerGoalTarget): string {
  const net = (g.affiliateNetworkName ?? "").trim().toLowerCase();
  const geo = (g.geoCode ?? "").trim().toLowerCase();
  const month = (g.monthKey ?? "").trim();
  return `${g.employeeId}|${g.metricKey}|${net}|${geo}|${month}`;
}

export function findDuplicateGoal(
  goals: ServerWorkerGoalTarget[],
  candidate: ServerWorkerGoalTarget,
  excludeId?: string,
): ServerWorkerGoalTarget | undefined {
  const key = workerGoalRowKey(candidate);
  return goals.find((g) => g.id !== excludeId && workerGoalRowKey(g) === key);
}
