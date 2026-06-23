import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { wsQueryOpts } from "@/lib/ws-query";
import { useLocation } from "wouter";
import {
  useListTestingBatches,
  useListPerformance,
  useListOffers,
  useListTodoTasks,
  useListEmployees,
  useListAffiliateNetworks,
  useListGeos,
  useListWorkspaceTrafficSources,
  getListEmployeesQueryKey,
  getListTestingBatchesQueryKey,
  getListPerformanceQueryKey,
  getListOffersQueryKey,
  getListTodoTasksQueryKey,
  getListAffiliateNetworksQueryKey,
  getListGeosQueryKey,
  getListWorkspaceTrafficSourcesQueryKey,
} from "@workspace/api-client-react";
import { useWorkspace } from "@/lib/workspace-context";
import type {
  Offer,
  TodoTask,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OperationalEmpty } from "@/components/operational-state/operational-empty";
import {
  DataTableSkeleton,
  ReportKpiCardsSkeleton,
} from "@/components/operational-state/operational-skeletons";
import { PerformanceRangePicker } from "@/components/live-campaigns/performance-range-picker";
import { ReportsSummaryCards } from "@/components/reports/reports-summary-cards";
import { ReportsGoalDashboardTab } from "@/components/reports/reports-goal-dashboard-tab";
import { ReportsInsightPill } from "@/components/reports/reports-insight-pill";
import {
  deriveReportInsight,
  fmtReportMoney,
  fmtReportPct,
  fmtReportPctCompact,
  fmtReportVisits,
  reportProfitColor,
  reportRoiColor,
} from "@/components/reports/reports-analytics";
import { useDateFilterState } from "@/hooks/use-date-filter-state";
import { DATE_RANGE_PRESET_LABELS } from "@/lib/date-filter-presets";
import { useAuth } from "@/lib/auth";
import { authedJson } from "@/lib/api-fetch";
import {
  buildAllReportEntities,
  buildMasterStringOptions,
  buildReportCampaignTypeOptions,
  filterReportEntities,
  perfMatchesFilteredEntities,
  reportCampaignTypeLabel,
  type LiveCampaignsListResponse,
  type ReportEntityRow,
} from "@/lib/reports/reports-data";
import { useReportsPeGoalDashboard } from "@/lib/reports/use-reports-pe-goal-dashboard";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell,
} from "recharts";
import {
  BarChart3, Download,
  Users, Globe, Network, Target, Trophy,
  ChevronUp, ChevronDown,
  Copy,
} from "lucide-react";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function fmt$(n: number) { return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`; }
function fmtPct(n: number) { return `${n.toFixed(1)}%`; }
function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const content = [headers, ...rows]
    .map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// Table helpers
// ─────────────────────────────────────────────
type SortDir = "asc" | "desc";
function useSortState(defaultCol: string, defaultDir: SortDir = "desc") {
  const [col, setCol] = useState(defaultCol);
  const [dir, setDir] = useState<SortDir>(defaultDir);
  function toggle(c: string) {
    if (c === col) setDir(d => d === "asc" ? "desc" : "asc");
    else { setCol(c); setDir("desc"); }
  }
  return { col, dir, toggle };
}

function ThSort({
  label,
  col,
  sort,
  onToggle,
  align = "left",
}: {
  label: string;
  col: string;
  sort: { col: string; dir: SortDir };
  onToggle: (c: string) => void;
  align?: "left" | "right";
}) {
  const active = sort.col === col;
  return (
    <th
      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 cursor-pointer select-none hover:text-slate-800 ${
        align === "right" ? "text-right" : "text-left"
      }`}
      onClick={() => onToggle(col)}
    >
      <span className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {label}
        {active ? (sort.dir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <span className="opacity-30"><ChevronDown size={11} /></span>}
      </span>
    </th>
  );
}

function sortRows<T extends Record<string, unknown>>(rows: T[], col: string, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const av = a[col] as number | string ?? 0;
    const bv = b[col] as number | string ?? 0;
    if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return dir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });
}

// ─────────────────────────────────────────────
// Types for aggregated rows
// ─────────────────────────────────────────────
type BatchRow = ReportEntityRow;
interface SourceRow {
  source: string; batches: number; clicks: number; spend: number; revenue: number;
  profit: number; roi: number; conversions: number; winners: number; losers: number; winnerRate: number;
}
interface NetworkGeoRow {
  network: string; geo: string; batches: number; clicks: number; spend: number;
  revenue: number; profit: number; roi: number; conversions: number;
  winners: number; losers: number; winnerRate: number; bestSource: string;
}
interface EmpRow {
  employeeId: number; name: string; batches: number; winners: number; losers: number;
  scaleTasksCreated: number; tasksCompleted: number; clicks: number; spend: number; revenue: number;
  profit: number; roi: number;
}

type ReportTab = "batches" | "sources" | "networks" | "employees" | "ops" | "winners";

type CampaignWinnerReportRow = {
  detectedAt: string;
  batchName: string | null;
  trafficSourceName: string | null;
  platform: string;
  campaignName: string;
  offerId: number;
  source: string;
  sourceLabel: string;
  enteredBy: string | null;
  notes: string | null;
};

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export default function Reports() {
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [, navigate] = useLocation();
  const isAdmin = currentEmployee?.role === "admin";
  const isWorker = !isAdmin;

  const {
    preset: datePreset,
    dateFrom,
    dateTo,
    setPreset: setDatePreset,
    setCustomRange,
    clearToDefault: clearDateRange,
  } = useDateFilterState({
    storageKey: "offerops.dateFilter.reports",
    defaultPreset: "last7",
    syncUrl: true,
  });

  const [filterEmployee, setFilterEmployee] = useState<number | "">("");
  const [filterNetwork, setFilterNetwork]   = useState("");
  const [filterGeo, setFilterGeo]           = useState("");
  const [filterSource, setFilterSource]     = useState("");
  const [filterStatus, setFilterStatus]     = useState("");
  const [filterCampaignType, setFilterCampaignType] = useState("");

  // Reset workspace-sensitive filters when the active workspace changes
  useEffect(() => {
    setFilterNetwork("");
    setFilterGeo("");
    setFilterSource("");
    setFilterStatus("");
    setFilterCampaignType("");
    setFilterEmployee("");
  }, [activeWorkspaceId]);

  const [tab, setTab] = useState<ReportTab>("batches");
  const [winnerRows, setWinnerRows] = useState<CampaignWinnerReportRow[]>([]);
  const [winnersLoading, setWinnersLoading] = useState(false);

  // Data
  const wsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const perfParams = {
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
    workspace_id: activeWorkspaceId ?? 0,
  };
  const { data: batches = [], isLoading: batchesLoading } = useListTestingBatches(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(wsParams)),
  );
  const { data: perfAll = [], isLoading: perfLoading } = useListPerformance(
    perfParams,
    wsQueryOpts(activeWorkspaceId, getListPerformanceQueryKey(perfParams)),
  );
  const { data: employees = [] } = useListEmployees(wsParams, wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(wsParams)));
  const { data: affiliateNetworks = [] } = useListAffiliateNetworks(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListAffiliateNetworksQueryKey(wsParams)),
  );
  const { data: geosCatalog = [] } = useListGeos(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListGeosQueryKey(wsParams)),
  );
  const { data: trafficSourcesCatalog = [] } = useListWorkspaceTrafficSources(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListWorkspaceTrafficSourcesQueryKey(wsParams)),
  );

  const { data: liveCampaigns = [], isLoading: liveCampaignsLoading } = useQuery({
    queryKey: ["reports-live-campaigns", activeWorkspaceId],
    enabled: !!activeWorkspaceId,
    queryFn: async () => {
      const statuses = ["live", "tested", "closed"] as const;
      const chunks = await Promise.all(
        statuses.map((status) =>
          authedJson<LiveCampaignsListResponse>(
            `/api/live-campaigns?workspace_id=${activeWorkspaceId}&status=${status}&limit=400&offset=0`,
          ),
        ),
      );
      const byId = new Map<number, LiveCampaignsListResponse["items"][0]>();
      for (const chunk of chunks) {
        for (const c of chunk.items ?? []) byId.set(c.id, c);
      }
      return [...byId.values()];
    },
  });

  const reportsCoreLoading = batchesLoading || perfLoading || liveCampaignsLoading;
  const { data: offers = [] } = useListOffers(wsParams, wsQueryOpts(activeWorkspaceId, getListOffersQueryKey(wsParams)));
  const { data: tasks = [] } = useListTodoTasks(wsParams, wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(wsParams)));

  const { data: assignedNetworks = [] } = useQuery({
    queryKey: ["reports-assigned-networks", activeWorkspaceId, currentEmployee?.id],
    enabled: isWorker && !!activeWorkspaceId && !!currentEmployee,
    queryFn: () =>
      authedJson<{ affiliateNetworkName: string | null }[]>(
        `/api/worker-affiliate-networks?workspace_id=${activeWorkspaceId}&employee_id=${currentEmployee!.id}`,
      ),
  });

  useEffect(() => {
    if (tab !== "winners" || !activeWorkspaceId) {
      setWinnerRows([]);
      return;
    }
    let cancelled = false;
    setWinnersLoading(true);
    authedJson<CampaignWinnerReportRow[]>(`/api/reports/campaign-winners?workspace_id=${activeWorkspaceId}`)
      .then((data) => {
        if (!cancelled) setWinnerRows(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setWinnerRows([]);
      })
      .finally(() => {
        if (!cancelled) setWinnersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, activeWorkspaceId]);

  // Build offer lookup: batchId → { winners, losers, total }
  const offersByBatch = useMemo(() => {
    const map = new Map<number, { winners: number; losers: number; retest: number; total: number }>();
    for (const o of offers) {
      const e = map.get(o.batchId) ?? { winners: 0, losers: 0, retest: 0, total: 0 };
      e.total++;
      if (o.status === "winner") e.winners++;
      if (o.status === "loser") e.losers++;
      map.set(o.batchId, e);
    }
    return map;
  }, [offers]);

  const allReportEntities = useMemo(
    () => buildAllReportEntities(batches, liveCampaigns, perfAll, offersByBatch),
    [batches, liveCampaigns, perfAll, offersByBatch],
  );

  const roleScopedReportEntities = useMemo(() => {
    if (isAdmin) return allReportEntities;
    const empId = currentEmployee?.id;
    const assignedNetworkNames = new Set(
      assignedNetworks
        .map((n) => n.affiliateNetworkName?.trim().toLowerCase())
        .filter((n): n is string => Boolean(n)),
    );
    return allReportEntities.filter((r) => {
      const net = (r.network || "").trim().toLowerCase();
      if (assignedNetworkNames.size > 0) {
        return assignedNetworkNames.has(net);
      }
      return empId != null && r.employeeId === empId;
    });
  }, [allReportEntities, isAdmin, currentEmployee?.id, assignedNetworks]);

  const filteredReportEntities = useMemo(
    () =>
      filterReportEntities(roleScopedReportEntities, {
        employeeId: isAdmin ? filterEmployee : currentEmployee?.id ?? "",
        network: filterNetwork,
        geo: filterGeo,
        source: filterSource,
        status: filterStatus,
        campaignType: filterCampaignType,
      }),
    [roleScopedReportEntities, isAdmin, currentEmployee?.id, filterEmployee, filterNetwork, filterGeo, filterSource, filterStatus, filterCampaignType],
  );

  /** @deprecated alias — report rows include testing batches + standalone live campaigns */
  const filteredBatches = filteredReportEntities;
  const batchRows = filteredReportEntities;

  // ── Source rows
  const sourceRows = useMemo<SourceRow[]>(() => {
    const map = new Map<string, SourceRow>();
    for (const r of filteredReportEntities) {
      const s = r.trafficSource || "—";
      const e = map.get(s) ?? { source: s, batches: 0, clicks: 0, spend: 0, revenue: 0, profit: 0, roi: 0, conversions: 0, winners: 0, losers: 0, winnerRate: 0 };
      e.batches++;
      e.clicks += r.clicks;
      e.spend += r.spend;
      e.revenue += r.revenue;
      e.profit += r.profit;
      e.conversions += r.conversions;
      e.winners += r.winners;
      e.losers += r.losers;
      map.set(s, e);
    }
    return [...map.values()].map((row) => ({
      ...row,
      roi: row.spend > 0 ? ((row.revenue - row.spend) / row.spend) * 100 : 0,
      winnerRate: (row.winners + row.losers) > 0 ? (row.winners / (row.winners + row.losers)) * 100 : 0,
    }));
  }, [filteredReportEntities]);

  // ── Network/GEO rows
  const networkGeoRows = useMemo<NetworkGeoRow[]>(() => {
    const map = new Map<string, {
      network: string; geo: string; batches: number; clicks: number; spend: number;
      revenue: number; profit: number; conversions: number; winners: number; losers: number;
      sourceProfits: Map<string, number>;
    }>();
    for (const r of filteredReportEntities) {
      const key = `${r.network}|${r.geo}`;
      const e = map.get(key) ?? {
        network: r.network, geo: r.geo, batches: 0, clicks: 0, spend: 0,
        revenue: 0, profit: 0, conversions: 0, winners: 0, losers: 0,
        sourceProfits: new Map<string, number>(),
      };
      e.batches++;
      e.clicks += r.clicks;
      e.spend += r.spend;
      e.revenue += r.revenue;
      e.profit += r.profit;
      e.conversions += r.conversions;
      e.winners += r.winners;
      e.losers += r.losers;
      const sp = e.sourceProfits.get(r.trafficSource) ?? 0;
      e.sourceProfits.set(r.trafficSource, sp + r.profit);
      map.set(key, e);
    }
    return [...map.values()].map((row) => {
      let bestSource = "—";
      let bestProfit = -Infinity;
      for (const [src, pft] of row.sourceProfits) {
        if (pft > bestProfit) { bestProfit = pft; bestSource = src; }
      }
      return {
        network: row.network, geo: row.geo, batches: row.batches,
        clicks: row.clicks, spend: row.spend, revenue: row.revenue, profit: row.profit,
        roi: row.spend > 0 ? ((row.revenue - row.spend) / row.spend) * 100 : 0,
        conversions: row.conversions, winners: row.winners, losers: row.losers,
        winnerRate: (row.winners + row.losers) > 0 ? (row.winners / (row.winners + row.losers)) * 100 : 0,
        bestSource,
      };
    });
  }, [filteredReportEntities]);

  // ── Employee rows
  const empRows = useMemo<EmpRow[]>(() => {
    const map = new Map<number, EmpRow>();
    for (const emp of employees) {
      map.set(emp.id, {
        employeeId: emp.id, name: emp.name, batches: 0, winners: 0, losers: 0,
        scaleTasksCreated: 0, tasksCompleted: 0, clicks: 0, spend: 0, revenue: 0, profit: 0, roi: 0,
      });
    }
    for (const r of filteredReportEntities) {
      if (r.employeeId == null) continue;
      const row = map.get(r.employeeId);
      if (!row) continue;
      row.batches++;
      row.winners += r.winners;
      row.losers += r.losers;
      row.clicks += r.clicks;
      row.spend += r.spend;
      row.revenue += r.revenue;
      row.profit += r.profit;
    }
    for (const t of tasks) {
      const row = map.get(t.employeeId);
      if (!row) continue;
      // Phase 2: find_winners is the post-test scale-prep task; DONE is
      // the only completed terminal state.
      if (t.taskType === "find_winners" || t.taskType === "FIND_WINNERS") row.scaleTasksCreated++;
      if (t.status === "DONE") row.tasksCompleted++;
    }
    return [...map.values()].map(r => ({
      ...r,
      roi: r.spend > 0 ? ((r.revenue - r.spend) / r.spend) * 100 : 0,
    }));
  }, [employees, filteredReportEntities, tasks]);

  const rangeSummary = useMemo(() => {
    const visits = batchRows.reduce((a, b) => a + b.clicks, 0);
    const spend = batchRows.reduce((a, b) => a + b.spend, 0);
    const revenue = batchRows.reduce((a, b) => a + b.revenue, 0);
    const profit = batchRows.reduce((a, b) => a + b.profit, 0);
    const winners = batchRows.reduce((a, b) => a + b.winners, 0);
    const losers = batchRows.reduce((a, b) => a + b.losers, 0);
    const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : 0;
    const hasImportedMetrics = perfMatchesFilteredEntities(perfAll, filteredReportEntities);
    const isFiltered = Boolean(
      filterEmployee || filterNetwork || filterGeo || filterSource || filterStatus || filterCampaignType,
    );
    return {
      visits,
      spend,
      revenue,
      profit,
      roi,
      winners,
      losers,
      batchCount: filteredReportEntities.length,
      hasImportedMetrics,
      isFiltered,
    };
  }, [
    batchRows,
    perfAll,
    filteredReportEntities,
    filterEmployee,
    filterNetwork,
    filterGeo,
    filterSource,
    filterStatus,
    filterCampaignType,
  ]);

  const reportGoalsEmployeeScope = isAdmin ? filterEmployee : currentEmployee?.id ?? "";
  const peGoalDashboard = useReportsPeGoalDashboard(reportGoalsEmployeeScope);

  // Master filter catalogs — worker sees only assigned networks in dropdown
  const networks = useMemo(() => {
    if (isWorker) {
      return buildMasterStringOptions(
        assignedNetworks.map((n) => n.affiliateNetworkName).filter((n): n is string => !!n),
        ...filteredReportEntities.map((r) => r.network),
      );
    }
    return buildMasterStringOptions(
      affiliateNetworks.map((n) => n.name),
      ...batches.map((b) => b.affiliateNetwork),
      ...liveCampaigns.map((c) => c.batchAffiliateNetwork),
    );
  }, [isWorker, assignedNetworks, affiliateNetworks, batches, liveCampaigns, filteredReportEntities]);
  const geos = useMemo(
    () =>
      buildMasterStringOptions(
        geosCatalog.map((g) => g.code),
        ...batches.map((b) => b.geo),
        ...liveCampaigns.map((c) => c.batchGeo),
      ),
    [geosCatalog, batches, liveCampaigns],
  );
  const sources = useMemo(
    () =>
      buildMasterStringOptions(
        trafficSourcesCatalog.map((s) => s.name),
        ...batches.map((b) => b.trafficSource),
        ...liveCampaigns.map((c) => c.trafficSourceName),
      ),
    [trafficSourcesCatalog, batches, liveCampaigns],
  );
  const statuses = useMemo(
    () => [...new Set(allReportEntities.map((r) => r.status))].sort(),
    [allReportEntities],
  );
  const campaignTypeOptions = useMemo(
    () => buildReportCampaignTypeOptions(allReportEntities),
    [allReportEntities],
  );

  // ── Sort states
  const batchSort  = useSortState("profit");
  const srcSort    = useSortState("profit");
  const netSort    = useSortState("profit");
  const empSort    = useSortState("profit");

  const sortedBatches = useMemo<BatchRow[]>(() => sortRows(batchRows as any, batchSort.col, batchSort.dir) as unknown as BatchRow[], [batchRows, batchSort.col, batchSort.dir]);
  const sortedSrc     = useMemo<SourceRow[]>(() => sortRows(sourceRows as any, srcSort.col, srcSort.dir) as unknown as SourceRow[], [sourceRows, srcSort.col, srcSort.dir]);
  const sortedNet     = useMemo<NetworkGeoRow[]>(() => sortRows(networkGeoRows as any, netSort.col, netSort.dir) as unknown as NetworkGeoRow[], [networkGeoRows, netSort.col, netSort.dir]);
  const sortedEmp     = useMemo<EmpRow[]>(() => sortRows(empRows as any, empSort.col, empSort.dir) as unknown as EmpRow[], [empRows, empSort.col, empSort.dir]);

  // ── Top source chart data
  const srcChartData = useMemo(() =>
    [...sourceRows].sort((a, b) => b.profit - a.profit).slice(0, 8).map(r => ({
      name: r.source, profit: Math.round(r.profit), roi: Math.round(r.roi), clicks: r.clicks,
    })), [sourceRows]);

  const netChartData = useMemo(() =>
    [...networkGeoRows].sort((a, b) => b.profit - a.profit).slice(0, 10).map(r => ({
      name: `${r.network} / ${r.geo}`, profit: Math.round(r.profit), roi: Math.round(r.roi), winners: r.winners,
    })), [networkGeoRows]);

  const empChartData = useMemo(() =>
    [...empRows].sort((a, b) => b.profit - a.profit).slice(0, 8).map(r => ({
      name: r.name.split(" ")[0], profit: Math.round(r.profit), winners: r.winners, batches: r.batches,
    })), [empRows]);

  const ALL_REPORT_TABS: { id: ReportTab; label: string; icon: React.ElementType }[] = [
    { id: "ops", label: "Dashboard", icon: BarChart3 },
    { id: "batches", label: "Batches", icon: Target },
    { id: "sources", label: "Traffic Sources", icon: Globe },
    { id: "networks", label: "Networks & GEOs", icon: Network },
    { id: "employees", label: "Employees", icon: Users },
    { id: "winners", label: "Winners", icon: Trophy },
  ];

  const TABS = useMemo(
    () => ALL_REPORT_TABS.filter((t) => isAdmin || t.id !== "employees"),
    [isAdmin],
  );

  useEffect(() => {
    if (!isAdmin && tab === "employees") setTab("ops");
  }, [isAdmin, tab]);

  const selFilter = "h-8 text-sm px-2 rounded-md border border-input bg-background w-full";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Historical analysis from imported Voluum daily metrics (date range below).
          </p>
        </div>
      </div>

      {/* Global filters */}
      <Card className="border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100">
        <CardContent className="px-4 py-3">
          <div className="mb-3 max-w-xl">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Date Range
            </label>
            <PerformanceRangePicker
              preset={datePreset}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onPresetChange={setDatePreset}
              onCustomRangeChange={setCustomRange}
            />
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {DATE_RANGE_PRESET_LABELS[datePreset]} · metrics from imported Voluum daily data
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {isAdmin && (
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Employee</label>
                <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value ? Number(e.target.value) : "")} className={selFilter}>
                  <option value="">All employees</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Network</label>
              <select value={filterNetwork} onChange={e => setFilterNetwork(e.target.value)} className={selFilter}>
                <option value="">All networks</option>
                {networks.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">GEO</label>
              <select value={filterGeo} onChange={e => setFilterGeo(e.target.value)} className={selFilter}>
                <option value="">All GEOs</option>
                {geos.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Traffic Source</label>
              <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className={selFilter}>
                <option value="">All sources</option>
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Campaign Type</label>
              <select value={filterCampaignType} onChange={e => setFilterCampaignType(e.target.value)} className={selFilter}>
                <option value="">All campaign types</option>
                {campaignTypeOptions.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          {(dateFrom || dateTo || filterEmployee || filterNetwork || filterGeo || filterSource || filterStatus || filterCampaignType) && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
              <span className="text-xs text-muted-foreground">{filteredReportEntities.length} in view</span>
              <button
                onClick={() => { clearDateRange(); setFilterEmployee(""); setFilterNetwork(""); setFilterGeo(""); setFilterSource(""); setFilterStatus(""); setFilterCampaignType(""); }}
                className="text-xs text-primary hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {reportsCoreLoading ? (
        <ReportKpiCardsSkeleton count={6} />
      ) : (
        <ReportsSummaryCards summary={rangeSummary} />
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════
          DASHBOARD TAB
      ══════════════════════════════════════ */}
      {tab === "ops" && <ReportsGoalDashboardTab dashboard={peGoalDashboard} />}

      {/* ══════════════════════════════════════
          BATCHES TAB
      ══════════════════════════════════════ */}
      {tab === "batches" && (
        <div className="space-y-4">
          {reportsCoreLoading ? (
            <DataTableSkeleton rows={8} cols={7} />
          ) : (
          <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{sortedBatches.length} row{sortedBatches.length !== 1 ? "s" : ""}</p>
            <button
              onClick={() => exportCSV(
                "batches-report.csv",
                ["Batch", "Network", "GEO", "Source", "Employee", "Status", "Visits", "Spend", "Revenue", "Profit", "ROI%", "Conversions", "Winners", "Losers", "Days Running"],
                sortedBatches.map(r => [r.batchName, r.network, r.geo, r.trafficSource, r.employee, r.status, r.clicks, fmt$(r.spend), fmt$(r.revenue), fmt$(r.profit), r.roi.toFixed(1), r.conversions, r.winners, r.losers, r.daysRunning])
              )}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <Download size={12} /> Export CSV
            </button>
          </div>

          <Card className="overflow-hidden border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100">
            <table className="w-full table-fixed">
              <colgroup>
                <col style={{ width: isAdmin ? "26%" : "28%" }} />
                <col style={{ width: isAdmin ? "10%" : "11%" }} />
                <col style={{ width: isAdmin ? "8%" : "9%" }} />
                {isAdmin && <col style={{ width: "8%" }} />}
                <col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: isAdmin ? "13%" : "14%" }} />
              </colgroup>
              <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95">
                <tr>
                  <ThSort label="Batch" col="batchName" sort={batchSort} onToggle={batchSort.toggle} />
                  <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Network / GEO</th>
                  <ThSort label="Source" col="trafficSource" sort={batchSort} onToggle={batchSort.toggle} />
                  {isAdmin && <ThSort label="Employee" col="employee" sort={batchSort} onToggle={batchSort.toggle} />}
                  <ThSort label="Visits" col="clicks" sort={batchSort} onToggle={batchSort.toggle} align="right" />
                  <ThSort label="Spend" col="spend" sort={batchSort} onToggle={batchSort.toggle} align="right" />
                  <ThSort label="Revenue" col="revenue" sort={batchSort} onToggle={batchSort.toggle} align="right" />
                  <ThSort label="Profit" col="profit" sort={batchSort} onToggle={batchSort.toggle} align="right" />
                  <ThSort label="ROI" col="roi" sort={batchSort} onToggle={batchSort.toggle} align="right" />
                  <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Insight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedBatches.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 10 : 9} className="p-4">
                      <OperationalEmpty
                        icon={Target}
                        title="No batches match these filters"
                        description="Clear filters or widen the date range to see batch performance."
                        compact
                      />
                    </td>
                  </tr>
                ) : sortedBatches.map((r) => (
                  <tr
                    key={r.rowKey}
                    className="cursor-pointer hover:bg-slate-50/80"
                    onClick={() => {
                      if (r.entityKind === "batch") navigate(`/testing-batches/${r.id}`);
                      else navigate("/live-campaigns");
                    }}
                  >
                    <td className="min-w-0 px-2 py-2.5 align-top">
                      <p
                        className="text-sm font-semibold leading-snug text-slate-900 whitespace-normal break-words line-clamp-3"
                        title={r.batchName}
                      >
                        {r.batchName}
                      </p>
                      <p className="mt-0.5 text-[10px] leading-snug text-slate-500" title={reportCampaignTypeLabel(r.campaignType)}>
                        {reportCampaignTypeLabel(r.campaignType)} · #{r.id}
                      </p>
                    </td>
                    <td className="min-w-0 px-2 py-2.5 align-top text-xs leading-snug text-slate-700">
                      <div className="break-words line-clamp-2" title={r.network}>{r.network}</div>
                      <div className="text-slate-500">{r.geo}</div>
                    </td>
                    <td className="min-w-0 px-2 py-2.5 align-top text-xs leading-snug text-slate-600 break-words line-clamp-2" title={r.trafficSource}>
                      {r.trafficSource}
                    </td>
                    {isAdmin && (
                      <td className="min-w-0 px-2 py-2.5 align-top text-xs leading-snug text-slate-600 break-words line-clamp-2" title={r.employee}>
                        {r.employee}
                      </td>
                    )}
                    <td className="min-w-0 px-2 py-2.5 align-top text-right text-xs tabular-nums text-slate-700 whitespace-nowrap">{fmtReportVisits(r.clicks)}</td>
                    <td className="min-w-0 px-2 py-2.5 align-top text-right text-xs tabular-nums text-slate-500 whitespace-nowrap">{fmtReportMoney(r.spend)}</td>
                    <td className="min-w-0 px-2 py-2.5 align-top text-right text-xs tabular-nums text-slate-800 whitespace-nowrap">{fmtReportMoney(r.revenue)}</td>
                    <td className={`min-w-0 px-2 py-2.5 align-top text-right text-xs font-semibold tabular-nums whitespace-nowrap ${reportProfitColor(r.profit)}`}>{fmtReportMoney(r.profit)}</td>
                    <td
                      className={`min-w-0 px-2 py-2.5 align-top text-right text-xs font-semibold tabular-nums whitespace-nowrap ${reportRoiColor(r.roi)}`}
                      title={fmtReportPct(r.roi)}
                    >
                      {fmtReportPctCompact(r.roi)}
                    </td>
                    <td className="min-w-0 px-2 py-2.5 align-top overflow-hidden">
                      <ReportsInsightPill
                        insight={deriveReportInsight({
                          clicks: r.clicks,
                          spend: r.spend,
                          revenue: r.revenue,
                          profit: r.profit,
                          roi: r.roi,
                          conversions: r.conversions,
                          winners: r.winners,
                        })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════
          TRAFFIC SOURCES TAB
      ══════════════════════════════════════ */}
      {tab === "sources" && (
        <div className="space-y-5">
          {/* Charts */}
          {srcChartData.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card className="border border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Profit by Traffic Source</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={srcChartData} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${fmtK(v)}`} />
                      <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, "Profit"]} />
                      <Bar dataKey="profit" radius={[3, 3, 0, 0]}>
                        {srcChartData.map((e, i) => (
                          <Cell key={i} fill={e.profit >= 0 ? "#22c55e" : "#ef4444"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">ROI by Traffic Source</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={srcChartData} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                      <Tooltip formatter={(v: number) => [`${v}%`, "ROI"]} />
                      <Bar dataKey="roi" radius={[3, 3, 0, 0]}>
                        {srcChartData.map((e, i) => (
                          <Cell key={i} fill={e.roi >= 0 ? "#6366f1" : "#ef4444"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Table */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{sortedSrc.length} source{sortedSrc.length !== 1 ? "s" : ""}</p>
            <button
              onClick={() => exportCSV(
                "traffic-sources-report.csv",
                ["Traffic Source", "Batches", "Visits", "Spend", "Revenue", "Profit", "ROI%", "Conversions", "Winners", "Losers", "Win Rate%"],
                sortedSrc.map(r => [r.source, r.batches, r.clicks, fmt$(r.spend), fmt$(r.revenue), fmt$(r.profit), r.roi.toFixed(1), r.conversions, r.winners, r.losers, r.winnerRate.toFixed(1)])
              )}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <Download size={12} /> Export CSV
            </button>
          </div>

          <Card className="overflow-hidden border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100">
            <table className="w-full table-fixed">
              <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95">
                <tr>
                  <ThSort label="Source" col="source" sort={srcSort} onToggle={srcSort.toggle} />
                  <ThSort label="Batches" col="batches" sort={srcSort} onToggle={srcSort.toggle} />
                  <ThSort label="Visits" col="clicks" sort={srcSort} onToggle={srcSort.toggle} />
                  <ThSort label="Spend" col="spend" sort={srcSort} onToggle={srcSort.toggle} />
                  <ThSort label="Revenue" col="revenue" sort={srcSort} onToggle={srcSort.toggle} />
                  <ThSort label="Profit" col="profit" sort={srcSort} onToggle={srcSort.toggle} />
                  <ThSort label="ROI" col="roi" sort={srcSort} onToggle={srcSort.toggle} />
                  <th className="w-[16%] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Insight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedSrc.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-4">
                      <OperationalEmpty
                        icon={Globe}
                        title="No traffic source metrics in this range"
                        description="Import daily metrics or widen the date filter to see source breakdowns."
                        compact
                      />
                    </td>
                  </tr>
                ) : sortedSrc.map((r) => (
                  <tr key={r.source} className="hover:bg-slate-50/80">
                    <td className="truncate px-3 py-2.5 text-sm font-semibold text-slate-900" title={r.source}>{r.source}</td>
                    <td className="px-3 py-2.5 text-center text-sm text-slate-500">{r.batches}</td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-700">{fmtReportVisits(r.clicks)}</td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-500">{fmtReportMoney(r.spend)}</td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-800">{fmtReportMoney(r.revenue)}</td>
                    <td className={`px-3 py-2.5 text-right text-sm font-semibold tabular-nums ${reportProfitColor(r.profit)}`}>{fmtReportMoney(r.profit)}</td>
                    <td className={`px-3 py-2.5 text-right text-sm font-semibold tabular-nums ${reportRoiColor(r.roi)}`}>{fmtReportPct(r.roi)}</td>
                    <td className="px-3 py-2.5">
                      <ReportsInsightPill
                        insight={deriveReportInsight({
                          clicks: r.clicks,
                          spend: r.spend,
                          revenue: r.revenue,
                          profit: r.profit,
                          roi: r.roi,
                          conversions: r.conversions,
                          winners: r.winners,
                        })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════
          NETWORKS & GEOs TAB
      ══════════════════════════════════════ */}
      {tab === "networks" && (
        <div className="space-y-5">
          {netChartData.length > 0 && (
            <Card className="border border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Profit by Network / GEO</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={netChartData} margin={{ top: 4, right: 8, bottom: 40, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${fmtK(v)}`} />
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, "Profit"]} />
                    <Bar dataKey="profit" radius={[3, 3, 0, 0]}>
                      {netChartData.map((e, i) => (
                        <Cell key={i} fill={e.profit >= 0 ? "#6366f1" : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{sortedNet.length} combination{sortedNet.length !== 1 ? "s" : ""}</p>
            <button
              onClick={() => exportCSV(
                "network-geo-report.csv",
                ["Network", "GEO", "Batches", "Visits", "Spend", "Revenue", "Profit", "ROI%", "Conversions", "Winners", "Win Rate%", "Best Source"],
                sortedNet.map(r => [r.network, r.geo, r.batches, r.clicks, fmt$(r.spend), fmt$(r.revenue), fmt$(r.profit), r.roi.toFixed(1), r.conversions, r.winners, r.winnerRate.toFixed(1), r.bestSource])
              )}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <Download size={12} /> Export CSV
            </button>
          </div>

          <Card className="overflow-hidden border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100">
            <table className="w-full table-fixed">
              <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95">
                <tr>
                  <th className="w-[22%] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Network / GEO</th>
                  <ThSort label="Batches" col="batches" sort={netSort} onToggle={netSort.toggle} />
                  <ThSort label="Visits" col="clicks" sort={netSort} onToggle={netSort.toggle} />
                  <ThSort label="Spend" col="spend" sort={netSort} onToggle={netSort.toggle} />
                  <ThSort label="Revenue" col="revenue" sort={netSort} onToggle={netSort.toggle} />
                  <ThSort label="Profit" col="profit" sort={netSort} onToggle={netSort.toggle} />
                  <ThSort label="ROI" col="roi" sort={netSort} onToggle={netSort.toggle} />
                  <th className="w-[16%] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Insight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedNet.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-4">
                      <OperationalEmpty
                        icon={Network}
                        title="No network / GEO metrics in this range"
                        description="Adjust filters or import Voluum metrics for the selected period."
                        compact
                      />
                    </td>
                  </tr>
                ) : sortedNet.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2.5 text-xs leading-snug text-slate-700">
                      <div className="truncate font-semibold text-slate-900">{r.network}</div>
                      <div className="text-slate-500">{r.geo}</div>
                    </td>
                    <td className="px-3 py-2.5 text-center text-sm text-slate-500">{r.batches}</td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-700">{fmtReportVisits(r.clicks)}</td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-500">{fmtReportMoney(r.spend)}</td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-800">{fmtReportMoney(r.revenue)}</td>
                    <td className={`px-3 py-2.5 text-right text-sm font-semibold tabular-nums ${reportProfitColor(r.profit)}`}>{fmtReportMoney(r.profit)}</td>
                    <td className={`px-3 py-2.5 text-right text-sm font-semibold tabular-nums ${reportRoiColor(r.roi)}`}>{fmtReportPct(r.roi)}</td>
                    <td className="px-3 py-2.5">
                      <ReportsInsightPill
                        insight={deriveReportInsight({
                          clicks: r.clicks,
                          spend: r.spend,
                          revenue: r.revenue,
                          profit: r.profit,
                          roi: r.roi,
                          conversions: r.conversions,
                          winners: r.winners,
                        })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════
          EMPLOYEES TAB
      ══════════════════════════════════════ */}
      {tab === "employees" && (
        <div className="space-y-5">
          {/* Leaderboard cards */}
          {sortedEmp.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { title: "🏆 Top Performer", emp: [...empRows].sort((a, b) => b.profit - a.profit)[0], metric: (e: EmpRow) => fmt$(e.profit), label: "profit" },
                { title: "🥇 Most Winners", emp: [...empRows].sort((a, b) => b.winners - a.winners)[0], metric: (e: EmpRow) => String(e.winners), label: "winners" },
                { title: "🚀 Most Batches", emp: [...empRows].sort((a, b) => b.batches - a.batches)[0], metric: (e: EmpRow) => String(e.batches), label: "batches" },
              ].map(({ title, emp, metric, label }) => emp && (
                <Card key={title} className="border border-border shadow-sm">
                  <CardContent className="px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">{title}</p>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                        {emp.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{emp.name}</p>
                        <p className="text-xs text-muted-foreground">{metric(emp)} {label}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Employee comparison chart */}
          {empChartData.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card className="border border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Profit by Employee</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={empChartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${fmtK(v)}`} />
                      <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, "Profit"]} />
                      <Bar dataKey="profit" fill="#6366f1" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Winners by Employee</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={empChartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => [v, "Winners"]} />
                      <Bar dataKey="winners" fill="#22c55e" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Employee table */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{sortedEmp.length} employee{sortedEmp.length !== 1 ? "s" : ""}</p>
            <button
              onClick={() => exportCSV(
                "employee-performance-report.csv",
                ["Employee", "Batches", "Winners", "Losers", "Scale Tasks", "Tasks Completed", "Spend", "Revenue", "Profit", "ROI%"],
                sortedEmp.map(r => [r.name, r.batches, r.winners, r.losers, r.scaleTasksCreated, r.tasksCompleted, fmt$(r.spend), fmt$(r.revenue), fmt$(r.profit), r.roi.toFixed(1)])
              )}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <Download size={12} /> Export CSV
            </button>
          </div>

          <Card className="overflow-hidden border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100">
            <table className="w-full table-fixed">
              <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95">
                <tr>
                  <ThSort label="Employee" col="name" sort={empSort} onToggle={empSort.toggle} />
                  <ThSort label="Batches" col="batches" sort={empSort} onToggle={empSort.toggle} />
                  <ThSort label="Visits" col="clicks" sort={empSort} onToggle={empSort.toggle} />
                  <ThSort label="Spend" col="spend" sort={empSort} onToggle={empSort.toggle} />
                  <ThSort label="Revenue" col="revenue" sort={empSort} onToggle={empSort.toggle} />
                  <ThSort label="Profit" col="profit" sort={empSort} onToggle={empSort.toggle} />
                  <ThSort label="ROI" col="roi" sort={empSort} onToggle={empSort.toggle} />
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-slate-500">W / L</th>
                  <th className="w-[14%] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Insight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedEmp.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-4">
                      <OperationalEmpty
                        icon={Users}
                        title="No employee performance in this range"
                        description="Assign batches to employees or adjust filters to see breakdowns."
                        compact
                      />
                    </td>
                  </tr>
                ) : sortedEmp.map((r) => (
                  <tr key={r.employeeId} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {r.name.charAt(0)}
                        </div>
                        <span className="truncate text-sm font-medium text-slate-900">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center text-sm text-slate-500">{r.batches}</td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-700">{fmtReportVisits(r.clicks)}</td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-500">{fmtReportMoney(r.spend)}</td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-800">{fmtReportMoney(r.revenue)}</td>
                    <td className={`px-3 py-2.5 text-right text-sm font-semibold tabular-nums ${reportProfitColor(r.profit)}`}>{fmtReportMoney(r.profit)}</td>
                    <td className={`px-3 py-2.5 text-right text-sm font-semibold tabular-nums ${reportRoiColor(r.roi)}`}>{fmtReportPct(r.roi)}</td>
                    <td className="px-3 py-2.5 text-center text-xs font-semibold text-slate-700">
                      <span className="text-emerald-600">{r.winners}</span>
                      <span className="text-slate-400"> / </span>
                      <span className="text-red-500">{r.losers}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <ReportsInsightPill
                        insight={deriveReportInsight({
                          clicks: r.clicks,
                          spend: r.spend,
                          revenue: r.revenue,
                          profit: r.profit,
                          roi: r.roi,
                          winners: r.winners,
                        })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "winners" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{winnerRows.length} winner{winnerRows.length !== 1 ? "s" : ""}</p>
            <button
              type="button"
              onClick={() => {
                const ids = [...new Set(winnerRows.map((r) => r.offerId))].join(", ");
                void navigator.clipboard.writeText(ids);
              }}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
              disabled={winnerRows.length === 0}
            >
              <Copy size={12} /> Copy offer IDs
            </button>
          </div>

          <Card className="overflow-hidden border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100">
            {winnersLoading ? (
              <div className="p-4">
                <DataTableSkeleton rows={5} cols={6} />
              </div>
            ) : winnerRows.length === 0 ? (
              <div className="p-4">
                <OperationalEmpty
                  icon={Trophy}
                  title="No campaign winners recorded yet"
                  description="Winners appear when find-winners tasks complete or winners are entered manually."
                  compact
                />
              </div>
            ) : (
              <table className="w-full table-fixed">
                <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95">
                  <tr>
                    <th className="w-[22%] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Entity</th>
                    <th className="w-[10%] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Type</th>
                    <th className="w-[16%] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Network / GEO</th>
                    <th className="w-[10%] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Visits</th>
                    <th className="w-[10%] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">Profit</th>
                    <th className="w-[10%] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">ROI</th>
                    <th className="w-[22%] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Suggested Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {winnerRows.map((r, i) => (
                    <tr key={`${r.offerId}-${i}`} className="hover:bg-slate-50/80">
                      <td className="px-3 py-2.5">
                        <p className="truncate text-sm font-medium text-slate-900" title={r.campaignName}>{r.campaignName}</p>
                        <p className="truncate text-[10px] text-slate-500">{r.batchName ?? "—"}</p>
                      </td>
                      <td className="px-3 py-2.5 text-xs uppercase text-slate-600">{r.platform}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">
                        <div className="truncate">{r.trafficSourceName ?? "—"}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm text-slate-400">—</td>
                      <td className="px-3 py-2.5 text-right text-sm text-slate-400">—</td>
                      <td className="px-3 py-2.5 text-right text-sm text-slate-400">—</td>
                      <td className="px-3 py-2.5 text-xs text-primary">
                        {r.source === "manual" ? "Review manual entry" : "Scale or monitor batch"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
