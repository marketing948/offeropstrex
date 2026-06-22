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

const EMPTY_CONFIG: ServerGoalsConfig = {
  workerGoalTargets: [],
  pointActions: [],
  eventPointRules: [],
  kpiTargets: [],
};

export async function loadGoalsConfig(workspaceId: number): Promise<ServerGoalsConfig> {
  const raw = await getSettingValue(workspaceId, "goals_config");
  if (!raw) return { ...EMPTY_CONFIG };
  try {
    const parsed = JSON.parse(raw) as Partial<ServerGoalsConfig>;
    return {
      workerGoalTargets: Array.isArray(parsed.workerGoalTargets) ? parsed.workerGoalTargets : [],
      pointActions: Array.isArray(parsed.pointActions) ? parsed.pointActions : [],
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
