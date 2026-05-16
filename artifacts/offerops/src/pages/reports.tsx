import { useEffect, useMemo, useState } from "react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useLocation } from "wouter";
import {
  useListTestingBatches,
  useListPerformance,
  useListOffers,
  useListTodoTasks,
  useListEmployees,
  getListEmployeesQueryKey,
  getListTestingBatchesQueryKey,
  getListPerformanceQueryKey,
  getListOffersQueryKey,
  getListTodoTasksQueryKey,
} from "@workspace/api-client-react";
import { useWorkspace } from "@/lib/workspace-context";
import type {
  TestingBatch,
  Performance,
  Offer,
  TodoTask,
  Employee,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell,
} from "recharts";
import {
  BarChart3, Download, TrendingUp, TrendingDown,
  Users, Globe, Network, Target, Trophy, Rocket,
  ChevronUp, ChevronDown, ArrowRight, Minus,
} from "lucide-react";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function fmt$(n: number) { return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`; }
function fmtPct(n: number) { return `${n.toFixed(1)}%`; }
function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

function roiColor(roi: number) {
  if (roi > 10) return "text-green-600";
  if (roi > 0) return "text-emerald-500";
  if (roi < 0) return "text-red-500";
  return "text-muted-foreground";
}
function profitColor(p: number) { return p > 0 ? "text-green-600" : p < 0 ? "text-red-500" : "text-muted-foreground"; }

function RoiBadge({ roi }: { roi: number }) {
  const positive = roi > 0;
  const zero = roi === 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${positive ? "text-green-600" : zero ? "text-muted-foreground" : "text-red-500"}`}>
      {positive ? <ChevronUp size={12} /> : zero ? <Minus size={12} /> : <ChevronDown size={12} />}
      {fmtPct(Math.abs(roi))}
    </span>
  );
}

function TrendChip({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (value > 0) return <span className="text-xs text-green-600 font-medium flex items-center gap-0.5"><TrendingUp size={11} />+{value}{suffix}</span>;
  if (value < 0) return <span className="text-xs text-red-500 font-medium flex items-center gap-0.5"><TrendingDown size={11} />{value}{suffix}</span>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

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

function ThSort({ label, col, sort, onToggle }: { label: string; col: string; sort: { col: string; dir: SortDir }; onToggle: (c: string) => void }) {
  const active = sort.col === col;
  return (
    <th
      className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 cursor-pointer whitespace-nowrap hover:text-foreground select-none"
      onClick={() => onToggle(col)}
    >
      <span className="flex items-center gap-1">
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
interface BatchRow {
  id: number; batchName: string; network: string; geo: string; trafficSource: string;
  employee: string; status: string; clicks: number; spend: number; revenue: number;
  profit: number; roi: number; conversions: number; winners: number; losers: number;
  totalOffers: number; daysRunning: number; liveAt: string | null;
}
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
  scaleTasksCreated: number; tasksCompleted: number; spend: number; revenue: number;
  profit: number; roi: number;
}

// Phase 10c: status badges now mirror the shared 6-state helper so
// reports look identical to the worker pages and Operations Hub.
import { batchStatusConfig as _bsc } from "@/lib/batch-status";
const STATUS_DOT: Record<string, string> = {
  NEW_BATCH:                     "bg-slate-400",
  WAITING_FOR_TRACKER_CAMPAIGNS: "bg-amber-500",
  OFFER_READY_FOR_LIVE_TESTING:  "bg-orange-500",
  LIVE_TESTS:                    "bg-green-500",
  TESTED:                        "bg-purple-500",
  COMPLETED:                     "bg-teal-500",
};
const STATUS_LABEL: Record<string, string> = {
  NEW_BATCH:                     "New",
  WAITING_FOR_TRACKER_CAMPAIGNS: "Waiting Trackers",
  OFFER_READY_FOR_LIVE_TESTING:  "Ready for Live",
  LIVE_TESTS:                    "Live Tests",
  TESTED:                        "Pick Winners",
  COMPLETED:                     "Completed",
};

type ReportTab = "batches" | "sources" | "networks" | "employees" | "ops";

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export default function Reports() {
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [, navigate] = useLocation();
  const isAdmin = currentEmployee?.role === "admin";

  // Global filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [filterEmployee, setFilterEmployee] = useState<number | "">("");
  const [filterNetwork, setFilterNetwork]   = useState("");
  const [filterGeo, setFilterGeo]           = useState("");
  const [filterSource, setFilterSource]     = useState("");
  const [filterStatus, setFilterStatus]     = useState("");

  // Reset workspace-sensitive filters when the active workspace changes
  useEffect(() => {
    setFilterNetwork("");
    setFilterGeo("");
    setFilterSource("");
    setFilterStatus("");
    setFilterEmployee("");
  }, [activeWorkspaceId]);

  const [tab, setTab] = useState<ReportTab>("batches");

  // Data
  const wsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const perfParams = {
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
    workspace_id: activeWorkspaceId ?? 0,
  };
  const { data: batches = [] }  = useListTestingBatches(wsParams, wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(wsParams)));
  const { data: perfAll = [] }  = useListPerformance(perfParams, wsQueryOpts(activeWorkspaceId, getListPerformanceQueryKey(perfParams)));
  const { data: offers = [] }   = useListOffers(wsParams, wsQueryOpts(activeWorkspaceId, getListOffersQueryKey(wsParams)));
  const { data: tasks = [] }    = useListTodoTasks(wsParams, wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(wsParams)));
  const { data: employees = [] } = useListEmployees(wsParams, wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(wsParams)));

  // Build batch perf lookup: batchId → aggregated perf
  const perfByBatch = useMemo(() => {
    const map = new Map<number, { clicks: number; spend: number; revenue: number; profit: number; conversions: number }>();
    for (const p of perfAll) {
      const e = map.get(p.batchId) ?? { clicks: 0, spend: 0, revenue: 0, profit: 0, conversions: 0 };
      e.clicks      += Number(p.clicks ?? 0);
      e.spend       += Number(p.spend ?? 0);
      e.revenue     += Number(p.revenue ?? 0);
      e.profit      += Number(p.profit ?? 0);
      e.conversions += Number(p.conversions ?? 0);
      map.set(p.batchId, e);
    }
    return map;
  }, [perfAll]);

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

  // Filter batches
  const filteredBatches = useMemo(() => batches.filter(b => {
    if (filterEmployee && b.employeeId !== filterEmployee) return false;
    if (filterNetwork && b.affiliateNetwork !== filterNetwork) return false;
    if (filterGeo && b.geo !== filterGeo) return false;
    if (filterSource && b.trafficSource !== filterSource) return false;
    if (filterStatus && b.status !== filterStatus) return false;
    return true;
  }), [batches, filterEmployee, filterNetwork, filterGeo, filterSource, filterStatus]);

  // ── Batch rows
  const batchRows = useMemo<BatchRow[]>(() => filteredBatches.map(b => {
    const p  = perfByBatch.get(b.id) ?? { clicks: 0, spend: 0, revenue: 0, profit: 0, conversions: 0 };
    const oc = offersByBatch.get(b.id) ?? { winners: 0, losers: 0, retest: 0, total: 0 };
    const roi = p.spend > 0 ? ((p.revenue - p.spend) / p.spend) * 100 : 0;
    const daysRunning = b.liveAt ? Math.floor((Date.now() - new Date(b.liveAt).getTime()) / 86400000) : 0;
    return {
      id: b.id, batchName: b.batchName, network: b.affiliateNetwork, geo: b.geo,
      trafficSource: b.trafficSource, employee: b.employeeName ?? "—", status: b.status,
      clicks: p.clicks, spend: p.spend, revenue: p.revenue, profit: p.profit, roi,
      conversions: p.conversions, winners: oc.winners, losers: oc.losers,
      totalOffers: oc.total, daysRunning, liveAt: b.liveAt ?? null,
    };
  }), [filteredBatches, perfByBatch, offersByBatch]);

  // ── Source rows
  const sourceRows = useMemo<SourceRow[]>(() => {
    const map = new Map<string, SourceRow>();
    for (const b of filteredBatches) {
      const s = b.trafficSource;
      const p = perfByBatch.get(b.id) ?? { clicks: 0, spend: 0, revenue: 0, profit: 0, conversions: 0 };
      const oc = offersByBatch.get(b.id) ?? { winners: 0, losers: 0, retest: 0, total: 0 };
      const e = map.get(s) ?? { source: s, batches: 0, clicks: 0, spend: 0, revenue: 0, profit: 0, roi: 0, conversions: 0, winners: 0, losers: 0, winnerRate: 0 };
      e.batches++; e.clicks += p.clicks; e.spend += p.spend; e.revenue += p.revenue;
      e.profit += p.profit; e.conversions += p.conversions; e.winners += oc.winners; e.losers += oc.losers;
      map.set(s, e);
    }
    return [...map.values()].map(r => ({
      ...r,
      roi: r.spend > 0 ? ((r.revenue - r.spend) / r.spend) * 100 : 0,
      winnerRate: (r.winners + r.losers) > 0 ? (r.winners / (r.winners + r.losers)) * 100 : 0,
    }));
  }, [filteredBatches, perfByBatch, offersByBatch]);

  // ── Network/GEO rows
  const networkGeoRows = useMemo<NetworkGeoRow[]>(() => {
    const map = new Map<string, {
      network: string; geo: string; batches: number; clicks: number; spend: number;
      revenue: number; profit: number; conversions: number; winners: number; losers: number;
      sourceProfits: Map<string, number>;
    }>();
    for (const b of filteredBatches) {
      const key = `${b.affiliateNetwork}|${b.geo}`;
      const p = perfByBatch.get(b.id) ?? { clicks: 0, spend: 0, revenue: 0, profit: 0, conversions: 0 };
      const oc = offersByBatch.get(b.id) ?? { winners: 0, losers: 0, retest: 0, total: 0 };
      const e = map.get(key) ?? {
        network: b.affiliateNetwork, geo: b.geo, batches: 0, clicks: 0, spend: 0,
        revenue: 0, profit: 0, conversions: 0, winners: 0, losers: 0,
        sourceProfits: new Map<string, number>(),
      };
      e.batches++; e.clicks += p.clicks; e.spend += p.spend; e.revenue += p.revenue;
      e.profit += p.profit; e.conversions += p.conversions; e.winners += oc.winners; e.losers += oc.losers;
      const sp = e.sourceProfits.get(b.trafficSource) ?? 0;
      e.sourceProfits.set(b.trafficSource, sp + p.profit);
      map.set(key, e);
    }
    return [...map.values()].map(r => {
      let bestSource = "—";
      let bestProfit = -Infinity;
      for (const [src, pft] of r.sourceProfits) {
        if (pft > bestProfit) { bestProfit = pft; bestSource = src; }
      }
      return {
        network: r.network, geo: r.geo, batches: r.batches,
        clicks: r.clicks, spend: r.spend, revenue: r.revenue, profit: r.profit,
        roi: r.spend > 0 ? ((r.revenue - r.spend) / r.spend) * 100 : 0,
        conversions: r.conversions, winners: r.winners, losers: r.losers,
        winnerRate: (r.winners + r.losers) > 0 ? (r.winners / (r.winners + r.losers)) * 100 : 0,
        bestSource,
      };
    });
  }, [filteredBatches, perfByBatch, offersByBatch]);

  // ── Employee rows
  const empRows = useMemo<EmpRow[]>(() => {
    const map = new Map<number, EmpRow>();
    for (const emp of employees) {
      map.set(emp.id, {
        employeeId: emp.id, name: emp.name, batches: 0, winners: 0, losers: 0,
        scaleTasksCreated: 0, tasksCompleted: 0, spend: 0, revenue: 0, profit: 0, roi: 0,
      });
    }
    for (const b of filteredBatches) {
      const row = map.get(b.employeeId);
      if (!row) continue;
      const p  = perfByBatch.get(b.id) ?? { clicks: 0, spend: 0, revenue: 0, profit: 0, conversions: 0 };
      const oc = offersByBatch.get(b.id) ?? { winners: 0, losers: 0, retest: 0, total: 0 };
      row.batches++;
      row.winners += oc.winners;
      row.losers  += oc.losers;
      row.spend   += p.spend;
      row.revenue += p.revenue;
      row.profit  += p.profit;
    }
    for (const t of tasks) {
      const row = map.get(t.employeeId);
      if (!row) continue;
      // Phase 2: FIND_WINNERS is the post-test scale-prep task; DONE is
      // the only completed terminal state.
      if (t.taskType === "FIND_WINNERS") row.scaleTasksCreated++;
      if (t.status === "DONE") row.tasksCompleted++;
    }
    return [...map.values()].map(r => ({
      ...r,
      roi: r.spend > 0 ? ((r.revenue - r.spend) / r.spend) * 100 : 0,
    }));
  }, [employees, filteredBatches, perfByBatch, offersByBatch, tasks]);

  // ── Ops summary
  const opsSummary = useMemo(() => {
    const total = filteredBatches.length;
    // Phase 9: 6-state lifecycle. "live" = trackers active (LIVE_TESTS),
    // "ready" = thresholds met awaiting winner classification (TESTED),
    // "optimizing" folds into TESTED (no separate state), "scaling"
    // and "completed" both become COMPLETED.
    const live = filteredBatches.filter(b => b.status === "LIVE_TESTS").length;
    const ready = filteredBatches.filter(b => b.status === "TESTED").length;
    const optimizing = filteredBatches.filter(b => b.status === "TESTED").length;
    const scaling = filteredBatches.filter(b => b.status === "COMPLETED").length;
    const completed = filteredBatches.filter(b => b.status === "COMPLETED").length;
    const totalWinners = offers.filter(o => o.status === "winner").length;
    const totalLosers  = offers.filter(o => o.status === "loser").length;
    const openTasks  = tasks.filter(t => t.status === "TODO" || t.status === "IN_PROGRESS").length;
    const doneTasks  = tasks.filter(t => t.status === "DONE").length;
    const scaleTasks = tasks.filter(t => t.taskType === "FIND_WINNERS").length;

    const totalSpend = batchRows.reduce((a, b) => a + b.spend, 0);
    const totalRevenue = batchRows.reduce((a, b) => a + b.revenue, 0);
    const totalProfit = batchRows.reduce((a, b) => a + b.profit, 0);
    const avgROI = batchRows.length > 0 ? batchRows.reduce((a, b) => a + b.roi, 0) / batchRows.length : 0;

    // Phase 10c: chart bins follow the 6-state lifecycle. "New" rolls
    // up the two pre-tracker states (NEW_BATCH +
    // WAITING_FOR_TRACKER_CAMPAIGNS) since they're operationally the
    // same line item from a reporting POV: "not yet running".
    const newCount = filteredBatches.filter(b =>
      b.status === "NEW_BATCH" || b.status === "WAITING_FOR_TRACKER_CAMPAIGNS"
    ).length;
    const readyForLive = filteredBatches.filter(b => b.status === "OFFER_READY_FOR_LIVE_TESTING").length;
    const statusChart = [
      { name: "New",          value: newCount,    fill: "#94a3b8" },
      { name: "Ready",        value: readyForLive, fill: "#f97316" },
      { name: "Live Tests",   value: live,         fill: "#22c55e" },
      { name: "Pick Winners", value: ready,        fill: "#a855f7" },
      { name: "Completed",    value: completed,    fill: "#14b8a6" },
    ].filter(d => d.value > 0);

    return { total, live, ready, optimizing, scaling, completed, totalWinners, totalLosers, openTasks, doneTasks, scaleTasks, totalSpend, totalRevenue, totalProfit, avgROI, statusChart };
  }, [filteredBatches, offers, tasks, batchRows]);

  // ── Unique filter options
  const networks   = [...new Set(batches.map(b => b.affiliateNetwork))].sort();
  const geos       = [...new Set(batches.map(b => b.geo))].sort();
  const sources    = [...new Set(batches.map(b => b.trafficSource))].sort();
  const statuses   = [...new Set(batches.map(b => b.status))].sort();

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

  const TABS: { id: ReportTab; label: string; icon: React.ElementType }[] = [
    { id: "ops",       label: "Operations",     icon: BarChart3 },
    { id: "batches",   label: "Batches",        icon: Target },
    { id: "sources",   label: "Traffic Sources", icon: Globe },
    { id: "networks",  label: "Networks & GEOs", icon: Network },
    { id: "employees", label: "Employees",       icon: Users },
  ];

  const selFilter = "h-8 text-sm px-2 rounded-md border border-input bg-background w-full";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Historical analysis, employee performance, and business insights</p>
        </div>
      </div>

      {/* Global filters */}
      <Card className="border border-border shadow-sm">
        <CardContent className="py-3 px-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={selFilter} />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={selFilter} />
            </div>
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
          </div>
          {(dateFrom || dateTo || filterEmployee || filterNetwork || filterGeo || filterSource || filterStatus) && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
              <span className="text-xs text-muted-foreground">{filteredBatches.length} batch{filteredBatches.length !== 1 ? "es" : ""} in view</span>
              <button
                onClick={() => { setDateFrom(""); setDateTo(""); setFilterEmployee(""); setFilterNetwork(""); setFilterGeo(""); setFilterSource(""); setFilterStatus(""); }}
                className="text-xs text-primary hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </CardContent>
      </Card>

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
          OPERATIONS TAB
      ══════════════════════════════════════ */}
      {tab === "ops" && (
        <div className="space-y-5">
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Batches",   value: opsSummary.total,       sub: `${opsSummary.live} live`, icon: Target, color: "" },
              { label: "Total Winners",   value: opsSummary.totalWinners, sub: `${opsSummary.totalLosers} losers`, icon: Trophy, color: "text-green-600" },
              { label: "Scale Tasks",     value: opsSummary.scaleTasks,  sub: `${opsSummary.doneTasks} tasks completed`, icon: Rocket, color: "text-purple-600" },
              { label: "Open Tasks",      value: opsSummary.openTasks,   sub: `${opsSummary.doneTasks} done`, icon: BarChart3, color: opsSummary.openTasks > 10 ? "text-red-500" : "" },
            ].map(({ label, value, sub, icon: Icon, color }) => (
              <Card key={label} className="border border-border shadow-sm">
                <CardContent className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-muted-foreground font-medium">{label}</p>
                    <Icon size={13} className="text-muted-foreground opacity-40" />
                  </div>
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* P&L summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Spend",   value: fmt$(opsSummary.totalSpend), color: "" },
              { label: "Total Revenue", value: fmt$(opsSummary.totalRevenue), color: "" },
              { label: "Total Profit",  value: fmt$(opsSummary.totalProfit), color: profitColor(opsSummary.totalProfit) },
              { label: "Average ROI",   value: fmtPct(opsSummary.avgROI), color: roiColor(opsSummary.avgROI) },
            ].map(({ label, value, color }) => (
              <Card key={label} className="border border-border shadow-sm">
                <CardContent className="px-4 py-3">
                  <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Status breakdown + pipeline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="border border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Batch Pipeline</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {opsSummary.statusChart.map(s => (
                    <div key={s.name} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{s.name}</span>
                      <div className="flex-1 h-5 rounded bg-muted overflow-hidden">
                        <div className="h-full rounded transition-all" style={{ width: `${opsSummary.total > 0 ? (s.value / opsSummary.total) * 100 : 0}%`, background: s.fill }} />
                      </div>
                      <span className="text-xs font-semibold text-foreground w-5 text-right">{s.value}</span>
                    </div>
                  ))}
                  {opsSummary.statusChart.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No batches yet</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Win/Loss Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Winners found</span>
                    <span className="text-sm font-bold text-green-600">{opsSummary.totalWinners}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Losers identified</span>
                    <span className="text-sm font-bold text-red-500">{opsSummary.totalLosers}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-sm text-muted-foreground">Win rate</span>
                    <span className="text-sm font-bold">
                      {(opsSummary.totalWinners + opsSummary.totalLosers) > 0
                        ? fmtPct((opsSummary.totalWinners / (opsSummary.totalWinners + opsSummary.totalLosers)) * 100)
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Scale tasks created</span>
                    <span className="text-sm font-bold text-purple-600">{opsSummary.scaleTasks}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Batches scaling</span>
                    <span className="text-sm font-bold">{opsSummary.scaling}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          BATCHES TAB
      ══════════════════════════════════════ */}
      {tab === "batches" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{sortedBatches.length} batch{sortedBatches.length !== 1 ? "es" : ""}</p>
            <button
              onClick={() => exportCSV(
                "batches-report.csv",
                ["Batch", "Network", "GEO", "Source", "Employee", "Status", "Clicks", "Spend", "Revenue", "Profit", "ROI%", "Conversions", "Winners", "Losers", "Days Running"],
                sortedBatches.map(r => [r.batchName, r.network, r.geo, r.trafficSource, r.employee, r.status, r.clicks, fmt$(r.spend), fmt$(r.revenue), fmt$(r.profit), r.roi.toFixed(1), r.conversions, r.winners, r.losers, r.daysRunning])
              )}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <Download size={12} /> Export CSV
            </button>
          </div>

          <Card className="border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-muted/30">
                  <tr>
                    <ThSort label="Batch" col="batchName" sort={batchSort} onToggle={batchSort.toggle} />
                    <ThSort label="Network" col="network" sort={batchSort} onToggle={batchSort.toggle} />
                    <ThSort label="GEO" col="geo" sort={batchSort} onToggle={batchSort.toggle} />
                    <ThSort label="Source" col="trafficSource" sort={batchSort} onToggle={batchSort.toggle} />
                    {isAdmin && <ThSort label="Employee" col="employee" sort={batchSort} onToggle={batchSort.toggle} />}
                    <th className="text-left text-xs font-semibold text-muted-foreground py-2 px-3">Status</th>
                    <ThSort label="Clicks" col="clicks" sort={batchSort} onToggle={batchSort.toggle} />
                    <ThSort label="Spend" col="spend" sort={batchSort} onToggle={batchSort.toggle} />
                    <ThSort label="Revenue" col="revenue" sort={batchSort} onToggle={batchSort.toggle} />
                    <ThSort label="Profit" col="profit" sort={batchSort} onToggle={batchSort.toggle} />
                    <ThSort label="ROI" col="roi" sort={batchSort} onToggle={batchSort.toggle} />
                    <ThSort label="W" col="winners" sort={batchSort} onToggle={batchSort.toggle} />
                    <ThSort label="L" col="losers" sort={batchSort} onToggle={batchSort.toggle} />
                    <ThSort label="Days" col="daysRunning" sort={batchSort} onToggle={batchSort.toggle} />
                    <th className="py-2 px-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedBatches.length === 0 ? (
                    <tr><td colSpan={15} className="text-center py-10 text-sm text-muted-foreground">No batches match the current filters.</td></tr>
                  ) : sortedBatches.map(r => (
                    <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-3">
                        <p className="text-sm font-medium text-foreground max-w-[180px] truncate">{r.batchName}</p>
                      </td>
                      <td className="py-2.5 px-3 text-sm text-muted-foreground whitespace-nowrap">{r.network}</td>
                      <td className="py-2.5 px-3 text-sm font-medium text-foreground">{r.geo}</td>
                      <td className="py-2.5 px-3 text-sm text-muted-foreground whitespace-nowrap">{r.trafficSource}</td>
                      {isAdmin && <td className="py-2.5 px-3 text-sm text-muted-foreground">{r.employee}</td>}
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[r.status] ?? "bg-gray-400"}`} />
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums">{fmtK(r.clicks)}</td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums text-muted-foreground">{fmt$(r.spend)}</td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums">{fmt$(r.revenue)}</td>
                      <td className={`py-2.5 px-3 text-sm text-right tabular-nums font-semibold ${profitColor(r.profit)}`}>{fmt$(r.profit)}</td>
                      <td className="py-2.5 px-3 text-right"><RoiBadge roi={r.roi} /></td>
                      <td className="py-2.5 px-3 text-center text-xs font-semibold text-green-700">{r.winners > 0 ? r.winners : "—"}</td>
                      <td className="py-2.5 px-3 text-center text-xs font-semibold text-red-500">{r.losers > 0 ? r.losers : "—"}</td>
                      <td className="py-2.5 px-3 text-sm text-right text-muted-foreground">{r.daysRunning > 0 ? `${r.daysRunning}d` : "—"}</td>
                      <td className="py-2.5 px-3">
                        <button
                          onClick={() => navigate(`/testing-batches/${r.id}`)}
                          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <ArrowRight size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
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
                ["Traffic Source", "Batches", "Clicks", "Spend", "Revenue", "Profit", "ROI%", "Conversions", "Winners", "Losers", "Win Rate%"],
                sortedSrc.map(r => [r.source, r.batches, r.clicks, fmt$(r.spend), fmt$(r.revenue), fmt$(r.profit), r.roi.toFixed(1), r.conversions, r.winners, r.losers, r.winnerRate.toFixed(1)])
              )}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <Download size={12} /> Export CSV
            </button>
          </div>

          <Card className="border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-muted/30">
                  <tr>
                    <ThSort label="Traffic Source" col="source" sort={srcSort} onToggle={srcSort.toggle} />
                    <ThSort label="Batches" col="batches" sort={srcSort} onToggle={srcSort.toggle} />
                    <ThSort label="Clicks" col="clicks" sort={srcSort} onToggle={srcSort.toggle} />
                    <ThSort label="Spend" col="spend" sort={srcSort} onToggle={srcSort.toggle} />
                    <ThSort label="Revenue" col="revenue" sort={srcSort} onToggle={srcSort.toggle} />
                    <ThSort label="Profit" col="profit" sort={srcSort} onToggle={srcSort.toggle} />
                    <ThSort label="ROI" col="roi" sort={srcSort} onToggle={srcSort.toggle} />
                    <ThSort label="Conversions" col="conversions" sort={srcSort} onToggle={srcSort.toggle} />
                    <ThSort label="Winners" col="winners" sort={srcSort} onToggle={srcSort.toggle} />
                    <ThSort label="Win Rate" col="winnerRate" sort={srcSort} onToggle={srcSort.toggle} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedSrc.length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-10 text-sm text-muted-foreground">No data available.</td></tr>
                  ) : sortedSrc.map(r => (
                    <tr key={r.source} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-3 text-sm font-semibold text-foreground">{r.source}</td>
                      <td className="py-2.5 px-3 text-sm text-center text-muted-foreground">{r.batches}</td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums">{fmtK(r.clicks)}</td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums text-muted-foreground">{fmt$(r.spend)}</td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums">{fmt$(r.revenue)}</td>
                      <td className={`py-2.5 px-3 text-sm text-right tabular-nums font-semibold ${profitColor(r.profit)}`}>{fmt$(r.profit)}</td>
                      <td className="py-2.5 px-3 text-right"><RoiBadge roi={r.roi} /></td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums">{r.conversions}</td>
                      <td className="py-2.5 px-3 text-sm text-center font-semibold text-green-700">{r.winners > 0 ? r.winners : "—"}</td>
                      <td className="py-2.5 px-3 text-sm text-right">
                        <span className={`font-semibold ${r.winnerRate > 50 ? "text-green-600" : r.winnerRate > 25 ? "text-amber-600" : "text-muted-foreground"}`}>
                          {(r.winners + r.losers) > 0 ? fmtPct(r.winnerRate) : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                ["Network", "GEO", "Batches", "Clicks", "Spend", "Revenue", "Profit", "ROI%", "Conversions", "Winners", "Win Rate%", "Best Source"],
                sortedNet.map(r => [r.network, r.geo, r.batches, r.clicks, fmt$(r.spend), fmt$(r.revenue), fmt$(r.profit), r.roi.toFixed(1), r.conversions, r.winners, r.winnerRate.toFixed(1), r.bestSource])
              )}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <Download size={12} /> Export CSV
            </button>
          </div>

          <Card className="border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-muted/30">
                  <tr>
                    <ThSort label="Network" col="network" sort={netSort} onToggle={netSort.toggle} />
                    <ThSort label="GEO" col="geo" sort={netSort} onToggle={netSort.toggle} />
                    <ThSort label="Batches" col="batches" sort={netSort} onToggle={netSort.toggle} />
                    <ThSort label="Clicks" col="clicks" sort={netSort} onToggle={netSort.toggle} />
                    <ThSort label="Spend" col="spend" sort={netSort} onToggle={netSort.toggle} />
                    <ThSort label="Revenue" col="revenue" sort={netSort} onToggle={netSort.toggle} />
                    <ThSort label="Profit" col="profit" sort={netSort} onToggle={netSort.toggle} />
                    <ThSort label="ROI" col="roi" sort={netSort} onToggle={netSort.toggle} />
                    <ThSort label="Winners" col="winners" sort={netSort} onToggle={netSort.toggle} />
                    <ThSort label="Win Rate" col="winnerRate" sort={netSort} onToggle={netSort.toggle} />
                    <th className="text-left text-xs font-semibold text-muted-foreground py-2 px-3">Best Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedNet.length === 0 ? (
                    <tr><td colSpan={11} className="text-center py-10 text-sm text-muted-foreground">No data available.</td></tr>
                  ) : sortedNet.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-3 text-sm font-semibold text-foreground">{r.network}</td>
                      <td className="py-2.5 px-3 text-sm font-semibold text-foreground">{r.geo}</td>
                      <td className="py-2.5 px-3 text-sm text-center text-muted-foreground">{r.batches}</td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums">{fmtK(r.clicks)}</td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums text-muted-foreground">{fmt$(r.spend)}</td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums">{fmt$(r.revenue)}</td>
                      <td className={`py-2.5 px-3 text-sm text-right tabular-nums font-semibold ${profitColor(r.profit)}`}>{fmt$(r.profit)}</td>
                      <td className="py-2.5 px-3 text-right"><RoiBadge roi={r.roi} /></td>
                      <td className="py-2.5 px-3 text-sm text-center font-semibold text-green-700">{r.winners > 0 ? r.winners : "—"}</td>
                      <td className="py-2.5 px-3 text-sm text-right">
                        <span className={`font-semibold ${r.winnerRate > 50 ? "text-green-600" : r.winnerRate > 25 ? "text-amber-600" : "text-muted-foreground"}`}>
                          {(r.winners + r.losers) > 0 ? fmtPct(r.winnerRate) : "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">{r.bestSource}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

          <Card className="border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-muted/30">
                  <tr>
                    <ThSort label="Employee" col="name" sort={empSort} onToggle={empSort.toggle} />
                    <ThSort label="Batches" col="batches" sort={empSort} onToggle={empSort.toggle} />
                    <ThSort label="Winners" col="winners" sort={empSort} onToggle={empSort.toggle} />
                    <ThSort label="Losers" col="losers" sort={empSort} onToggle={empSort.toggle} />
                    <ThSort label="Scale Tasks" col="scaleTasksCreated" sort={empSort} onToggle={empSort.toggle} />
                    <ThSort label="Tasks Done" col="tasksCompleted" sort={empSort} onToggle={empSort.toggle} />
                    <ThSort label="Spend" col="spend" sort={empSort} onToggle={empSort.toggle} />
                    <ThSort label="Revenue" col="revenue" sort={empSort} onToggle={empSort.toggle} />
                    <ThSort label="Profit" col="profit" sort={empSort} onToggle={empSort.toggle} />
                    <ThSort label="ROI" col="roi" sort={empSort} onToggle={empSort.toggle} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedEmp.length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-10 text-sm text-muted-foreground">No employee data.</td></tr>
                  ) : sortedEmp.map(r => (
                    <tr key={r.employeeId} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                            {r.name.charAt(0)}
                          </div>
                          <span className="text-sm font-medium text-foreground">{r.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-sm text-center text-muted-foreground">{r.batches}</td>
                      <td className="py-2.5 px-3 text-sm text-center font-semibold text-green-700">{r.winners > 0 ? r.winners : "—"}</td>
                      <td className="py-2.5 px-3 text-sm text-center font-semibold text-red-500">{r.losers > 0 ? r.losers : "—"}</td>
                      <td className="py-2.5 px-3 text-sm text-center text-purple-600 font-semibold">{r.scaleTasksCreated > 0 ? r.scaleTasksCreated : "—"}</td>
                      <td className="py-2.5 px-3 text-sm text-center text-muted-foreground">{r.tasksCompleted}</td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums text-muted-foreground">{fmt$(r.spend)}</td>
                      <td className="py-2.5 px-3 text-sm text-right tabular-nums">{fmt$(r.revenue)}</td>
                      <td className={`py-2.5 px-3 text-sm text-right tabular-nums font-semibold ${profitColor(r.profit)}`}>{fmt$(r.profit)}</td>
                      <td className="py-2.5 px-3 text-right"><RoiBadge roi={r.roi} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
