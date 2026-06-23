import { authedJson, authedFetch } from "@/lib/api-fetch";

export type MonthlyGoalsKpi = {
  metricKey: string;
  label: string;
  current: number;
  target: number;
  progressPct: number;
  xpAvailable: number;
  theme: "revenue" | "testing" | "working";
};

export type WorkerMonthlyRow = {
  employeeId: number;
  name: string;
  email: string;
  initials: string;
  revenue: { current: number; target: number; progressPct: number };
  testing: { current: number; target: number; progressPct: number };
  working: { current: number; target: number; progressPct: number };
  profit: number | null;
  xpEarned: number;
  status: "Strong" | "On track" | "Watch" | "Behind";
  progressSegments: number;
};

export type MonthlyGoalsDashboard = {
  monthKey: string;
  kpis: MonthlyGoalsKpi[];
  workers: WorkerMonthlyRow[];
  leaderboard: { employeeId: number; name: string; initials: string; xp: number; rank: number }[];
};

export function fetchMonthlyGoalsDashboard(
  workspaceId: number,
  monthKey: string,
  employeeId?: number,
): Promise<MonthlyGoalsDashboard> {
  const emp = employeeId != null ? `&employee_id=${employeeId}` : "";
  return authedJson(
    `/api/performance/monthly-goals?workspace_id=${workspaceId}&month=${encodeURIComponent(monthKey)}${emp}`,
  );
}

export type MetricBreakdownKind = "revenue" | "testing" | "working";

export type MetricBreakdownGeoRow = {
  key: string;
  label: string;
  current: number;
  target: number;
  percent: number;
  targetSource?: "inherited" | "custom" | "none";
};

export type MetricBreakdownNetworkRow = {
  key: string;
  label: string;
  networkId: string;
  current: number;
  target: number;
  percent: number;
  geos: MetricBreakdownGeoRow[];
};

export type MetricBreakdownResult = {
  metric: MetricBreakdownKind;
  scope: {
    workspaceId: number;
    employeeId: number | null;
    month: string;
  };
  summary: {
    current: number;
    target: number;
    percent: number;
    xpAvailable: number;
  };
  networks: MetricBreakdownNetworkRow[];
  geos: MetricBreakdownGeoRow[];
  items: { name: string; network: string; geo: string; detail?: string }[];
};

export function fetchMetricBreakdown(
  workspaceId: number,
  monthKey: string,
  metric: MetricBreakdownKind,
  employeeId?: number,
): Promise<MetricBreakdownResult> {
  const emp = employeeId != null ? `&employee_id=${employeeId}` : "";
  return authedJson(
    `/api/performance/metric-breakdown?workspace_id=${workspaceId}&month=${encodeURIComponent(monthKey)}&metric=${metric}${emp}`,
  );
}

export function kpiMetricToBreakdown(metricKey: string): MetricBreakdownKind | null {
  if (metricKey === "revenue") return "revenue";
  if (metricKey === "testingBatches") return "testing";
  if (metricKey === "workingCampaigns") return "working";
  return null;
}

export function fetchWorkerBreakdown(workspaceId: number, employeeId: number, monthKey: string) {
  return authedJson<{
    networks: { name: string; target: number; current: number }[];
    geos: { code: string; target: number; current: number }[];
    topWinners: { name: string; geo: string; network: string }[];
  }>(
    `/api/performance/worker-breakdown?workspace_id=${workspaceId}&employee_id=${employeeId}&month=${encodeURIComponent(monthKey)}`,
  );
}

export function fetchWorkerActivity(workspaceId: number, employeeId: number, monthKey: string) {
  return authedJson<{
    activity: { id: number; title: string; description: string | null; eventType: string; createdAt: string }[];
    xpEvents: { id: number; amount: number; sourceType: string; label: string; createdAt: string }[];
  }>(
    `/api/performance/worker-activity?workspace_id=${workspaceId}&employee_id=${employeeId}&month=${encodeURIComponent(monthKey)}`,
  );
}

export function fetchXpHistory(workspaceId: number, employeeId: number, monthKey: string) {
  return authedJson<{
    monthKey: string;
    employeeId: number;
    totalXp: number;
    chart: { date: string; xp: number; cumulative: number }[];
    entries: unknown[];
  }>(
    `/api/performance/xp-history?workspace_id=${workspaceId}&employee_id=${employeeId}&month=${encodeURIComponent(monthKey)}`,
  );
}

export type UpsertWorkerGoalPayload = {
  workspaceId: number;
  goal: {
    id: string;
    employeeId: number;
    employeeName?: string;
    affiliateNetworkId?: number | null;
    affiliateNetworkName?: string | null;
    geoId?: number | null;
    geoCode?: string | null;
    selectedGeoCodes?: string[] | null;
    metricKey: "revenue" | "testingBatches" | "workingCampaigns";
    monthlyTarget: number;
    isActive: boolean;
    monthKey?: string | null;
    xpReward?: number | null;
    overachieveXpReward?: number | null;
    notes?: string;
  };
  replaceExisting?: boolean;
};

export type ReplaceWorkerGoalPlanPayload = {
  workspaceId: number;
  employeeId: number;
  employeeName?: string;
  monthKey: string;
  affiliateNetworkName?: string | null;
  affiliateNetworkId?: number | null;
  selectedGeoCodes?: string[];
  metrics: {
    metricKey: "revenue" | "testingBatches" | "workingCampaigns";
    monthlyTarget: number;
    xpReward?: number;
    enabled: boolean;
  }[];
  geoOverrides?: {
    metricKey: "revenue" | "testingBatches" | "workingCampaigns";
    geoCode: string;
    geoId?: number | null;
    monthlyTarget: number;
  }[];
};

export class DuplicateGoalError extends Error {
  existingGoal?: UpsertWorkerGoalPayload["goal"];
  constructor(message: string, existingGoal?: UpsertWorkerGoalPayload["goal"]) {
    super(message);
    this.name = "DuplicateGoalError";
    this.existingGoal = existingGoal;
  }
}

export async function upsertWorkerGoal(payload: UpsertWorkerGoalPayload) {
  const res = await authedFetch("/api/performance/worker-goals", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (res.status === 409) {
    const body = (await res.json()) as {
      message?: string;
      existingGoal?: UpsertWorkerGoalPayload["goal"];
    };
    throw new DuplicateGoalError(
      body.message ?? "A goal already exists for this worker/month/metric/network/GEO.",
      body.existingGoal,
    );
  }
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { ok: boolean; goal: UpsertWorkerGoalPayload["goal"] };
}

export async function replaceWorkerGoalPlan(payload: ReplaceWorkerGoalPlanPayload) {
  const res = await authedFetch("/api/performance/worker-goals/plan", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { ok: boolean; goals: UpsertWorkerGoalPayload["goal"][] };
}

export function currentMonthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
