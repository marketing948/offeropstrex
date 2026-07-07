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

export type NetworkAllocationSource =
  | "auto-from-worker-wide"
  | "network-explicit"
  | "unallocated";

export type GeoAllocationSource = "inherited" | "custom" | "custom-zero" | "none";

export type GoalAllocationGeoRow = {
  affiliateNetworkName: string;
  geoCode: string;
  revenueTarget: number | null;
  testingTarget: number | null;
  workingTarget: number | null;
  revenueSource?: GeoAllocationSource;
  testingSource?: GeoAllocationSource;
  workingSource?: GeoAllocationSource;
};

export type GoalAllocationNetworkRow = {
  affiliateNetworkName: string;
  revenueTarget: number | null;
  testingTarget: number | null;
  workingTarget: number | null;
  revenueSource?: NetworkAllocationSource;
  testingSource?: NetworkAllocationSource;
  workingSource?: NetworkAllocationSource;
  geoCount: number;
  overrideCount: number;
  geoSplitRows: GoalAllocationGeoRow[];
};

export type GoalAllocationResult = {
  employeeId: number;
  monthKey: string;
  overview: {
    revenue: { current: number; target: number };
    testing: { current: number; target: number };
    working: { current: number; target: number };
    xpEarned: number;
  };
  workerWideUnallocated: {
    revenueTarget: number | null;
    testingTarget: number | null;
    workingTarget: number | null;
    message: string;
  } | null;
  networks: GoalAllocationNetworkRow[];
  geos: GoalAllocationGeoRow[];
  counts: {
    hasAnyGoals: boolean;
    networkCount: number;
    selectedGeoCount: number;
    overrideCount: number;
  };
};

export function fetchGoalAllocation(
  workspaceId: number,
  employeeId: number,
  monthKey: string,
): Promise<GoalAllocationResult> {
  return authedJson(
    `/api/performance/goal-allocation?workspace_id=${workspaceId}&employee_id=${employeeId}&month=${encodeURIComponent(monthKey)}`,
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

export type ResetWorkerGoalPlanNetworkPayload = {
  workspaceId: number;
  employeeId: number;
  monthKey: string;
  affiliateNetworkName: string;
  confirmation: true;
};

export async function resetWorkerGoalPlanNetwork(payload: ResetWorkerGoalPlanNetworkPayload) {
  const res = await authedFetch("/api/performance/worker-goals/plan/reset-network", {
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
  return (await res.json()) as { ok: boolean; removedCount: number; removedGoalIds: string[] };
}

export type ResetAllWorkerGoalPlanPayload = {
  workspaceId: number;
  employeeId: number;
  monthKey: string;
  confirmation: true;
};

export async function resetAllWorkerGoalPlan(payload: ResetAllWorkerGoalPlanPayload) {
  const res = await authedFetch("/api/performance/worker-goals/plan/reset-all", {
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
  return (await res.json()) as { ok: boolean; removedCount: number; removedGoalIds: string[] };
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

export type GoalsImportPreviewRow = {
  rowNumber: number;
  status: "valid" | "error" | "warning";
  employeeName: string | null;
  employeeEmail: string | null;
  monthKey: string | null;
  affiliateNetworkName: string | null;
  selectedGeoCodes: string[];
  revenueTarget: number | null;
  revenueXp: number | null;
  testingTarget: number | null;
  testingXp: number | null;
  workingTarget: number | null;
  workingXp: number | null;
  messages: string[];
};

export type NormalizedImportGoal = {
  monthKey: string;
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  affiliateNetworkId: number;
  affiliateNetworkName: string;
  selectedGeoCodes: string[] | null;
  geoId: number | null;
  geoCode: string | null;
  metricKey: "revenue" | "testingBatches" | "workingCampaigns";
  monthlyTarget: number;
  xpReward: number | null;
  xpProvided: boolean;
  source: "goals_sheet" | "geo_override_sheet";
  sourceRowNumber: number;
};

export type GoalsImportPreviewResponse = {
  ok: boolean;
  summary: {
    validRows: number;
    errorRows: number;
    warnings: number;
    newGoals: number;
    updatedGoals: number;
    skippedRows: number;
  };
  rows: GoalsImportPreviewRow[];
  errors: string[];
  warnings: string[];
  normalizedGoals: NormalizedImportGoal[];
  checksum: string;
};

export type GoalsImportConfirmResponse = {
  ok: boolean;
  importMode: "UPSERT_ROWS_ONLY";
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  goalsBeforeCount: number;
  goalsAfterCount: number;
};

export async function previewMonthlyGoalsExcelImport(params: {
  workspaceId: number;
  fileName: string;
  fileBase64: string;
}): Promise<GoalsImportPreviewResponse> {
  return authedJson<GoalsImportPreviewResponse>("/api/performance/monthly-goals/import/preview", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function confirmMonthlyGoalsExcelImport(params: {
  workspaceId: number;
  importMode: "UPSERT_ROWS_ONLY";
  checksum: string;
  normalizedGoals: NormalizedImportGoal[];
}): Promise<GoalsImportConfirmResponse> {
  return authedJson<GoalsImportConfirmResponse>("/api/performance/monthly-goals/import/confirm", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function downloadMonthlyGoalsImportTemplate(workspaceId: number): Promise<Blob> {
  const res = await authedFetch(
    `/api/performance/monthly-goals/import/template?workspace_id=${workspaceId}`,
  );
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
  return res.blob();
}

export const GOALS_EXCEL_TEMPLATE_HEADERS =
  "month,employee_email,employee_name,affiliate_network,selected_geos,revenue_target,revenue_xp,testing_target,testing_xp,working_target,working_xp";
