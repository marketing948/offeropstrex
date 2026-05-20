// CampaignOps redesign — Live Campaigns page.
//
// Lists live Campaigns in the workspace with rich filtering. The page
// is the operator's view of which iOS / Android creatives are running
// against which traffic sources, when each went live, and the current
// per-Campaign performance numbers (populated by the find_winners
// task completion flow).

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace-context";
import { authedJson } from "@/lib/api-fetch";
import { ProductionLiveCampaignForm } from "@/components/production-live-campaign-form";
import { ManualCloseCampaignDialog } from "@/components/manual-close-campaign-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type CampaignPurpose = "testing" | "working" | "scaling";

type Campaign = {
  id: number;
  workspaceId: number;
  batchId: number | null;
  campaignPurpose: CampaignPurpose;
  platform: "ios" | "android";
  campaignName: string;
  status: "draft" | "ready" | "voluum_created" | "live" | "tested" | "closed";
  trafficSourceId: number | null;
  voluumCampaignId: string | null;
  voluumCampaignName: string | null;
  trafficSourceCampaignId: string | null;
  trafficSourceCampaignUrl: string | null;
  liveStartedAt: string | null;
  winnersCount: number | null;
  revenue: string | null;
  cost: string | null;
  clicks: number | null;
  conversions: number | null;
  roi: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  batchName: string | null;
  batchGeo: string | null;
  batchAffiliateNetwork: string | null;
  employeeName: string | null;
  trafficSourceName: string | null;
};

type LiveCampaignsResponse = {
  items: Campaign[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};

const STATUS_COLORS: Record<Campaign["status"], { dot: string; bg: string; text: string }> = {
  draft:           { dot: "bg-slate-400",  bg: "bg-slate-100 dark:bg-slate-900/40", text: "text-slate-700 dark:text-slate-300" },
  ready:           { dot: "bg-blue-500",   bg: "bg-blue-100 dark:bg-blue-900/40",   text: "text-blue-700 dark:text-blue-300" },
  voluum_created:  { dot: "bg-purple-500", bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300" },
  live:            { dot: "bg-emerald-500",bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300" },
  tested:          { dot: "bg-amber-500",  bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300" },
  closed:          { dot: "bg-zinc-400",   bg: "bg-zinc-100 dark:bg-zinc-900/40",   text: "text-zinc-600 dark:text-zinc-400" },
};

function StatusBadge({ status }: { status: Campaign["status"] }) {
  const c = STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {status.replace(/_/g, " ")}
    </span>
  );
}

const PURPOSE_LABELS: Record<CampaignPurpose, string> = {
  testing: "Testing",
  working: "Working",
  scaling: "Scaling",
};

function PurposeBadge({ purpose }: { purpose: CampaignPurpose }) {
  if (purpose === "testing") {
    return (
      <Badge variant="secondary" className="text-[10px] font-medium">
        {PURPOSE_LABELS.testing}
      </Badge>
    );
  }
  const variant = purpose === "working" ? "default" : "outline";
  return (
    <Badge variant={variant} className="text-[10px] font-medium">
      {PURPOSE_LABELS[purpose]}
    </Badge>
  );
}

function fmtMoney(v: string | null): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return `$${n.toFixed(2)}`;
}
function fmtPct(v: string | null): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return `${(n * 100).toFixed(1)}%`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function toNextDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function yesterdayIsoDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type DailyMetricRow = {
  campaignId: number;
  cost: string;
  revenue: string;
  conversions: number;
  visits: number;
  profit: string;
  roi: string | null;
};

type MetricDraft = {
  cost: string;
  revenue: string;
  conversions: string;
  visits: string;
};

function deriveProfitRoi(cost: string, revenue: string): { profit: string; roi: string | null } {
  const c = Number(cost);
  const r = Number(revenue);
  if (!Number.isFinite(c) || !Number.isFinite(r)) {
    return { profit: "—", roi: null };
  }
  const profit = r - c;
  const roi = c > 0 ? profit / c : null;
  return {
    profit: profit.toFixed(2),
    roi: roi != null ? String(roi) : null,
  };
}

function defaultDraft(): MetricDraft {
  return { cost: "0", revenue: "0", conversions: "0", visits: "0" };
}

function draftFromMetric(m: DailyMetricRow): MetricDraft {
  return {
    cost: m.cost,
    revenue: m.revenue,
    conversions: String(m.conversions),
    visits: String(m.visits),
  };
}

export default function LiveCampaigns() {
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const isAdmin = currentEmployee?.role === "admin";
  const [addOpen, setAddOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<{ id: number; name: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("live");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [trafficSourceFilter, setTrafficSourceFilter] = useState<string>("all");
  const [geoFilter, setGeoFilter] = useState<string>("all");
  const [networkFilter, setNetworkFilter] = useState<string>("all");
  const [batchFilter, setBatchFilter] = useState<string>("all");
  const [liveDateFilter, setLiveDateFilter] = useState("");
  const [metricsDate, setMetricsDate] = useState(yesterdayIsoDate);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [metricDrafts, setMetricDrafts] = useState<Record<number, MetricDraft>>({});
  const [saveState, setSaveState] = useState<Record<number, "idle" | "saving" | "saved" | "error">>({});
  const pageSize = 50;

  useEffect(() => {
    setStatusFilter("live");
    setPlatformFilter("all");
    setTrafficSourceFilter("all");
    setGeoFilter("all");
    setNetworkFilter("all");
    setBatchFilter("all");
    setLiveDateFilter("");
    setMetricsDate(yesterdayIsoDate());
    setSearch("");
    setOffset(0);
  }, [activeWorkspaceId]);

  useEffect(() => {
    setOffset(0);
  }, [statusFilter, platformFilter, trafficSourceFilter, geoFilter, networkFilter, batchFilter, liveDateFilter, search]);

  const optionParams = new URLSearchParams();
  if (activeWorkspaceId) optionParams.set("workspace_id", String(activeWorkspaceId));
  optionParams.set("status", statusFilter);
  optionParams.set("limit", "200");

  const { data: optionResponse, isError: isOptionsError, error: optionsError } = useQuery<LiveCampaignsResponse>({
    queryKey: ["live-campaign-filter-options", activeWorkspaceId, statusFilter],
    enabled: !!activeWorkspaceId,
    queryFn: () => authedJson(`/api/live-campaigns?${optionParams.toString()}`),
  });
  const optionCampaigns = optionResponse?.items ?? [];

  const params = new URLSearchParams();
  if (activeWorkspaceId) params.set("workspace_id", String(activeWorkspaceId));
  params.set("status", statusFilter);
  params.set("limit", String(pageSize));
  params.set("offset", String(offset));
  if (platformFilter !== "all") params.set("platform", platformFilter);
  if (trafficSourceFilter !== "all") params.set("traffic_source_id", trafficSourceFilter);
  if (geoFilter !== "all") params.set("geo", geoFilter);
  if (networkFilter !== "all") params.set("affiliate_network", networkFilter);
  if (batchFilter !== "all") params.set("batch_id", batchFilter);
  if (liveDateFilter) {
    params.set("date_from", liveDateFilter);
    params.set("date_to", toNextDate(liveDateFilter));
  }

  const { data: response, isLoading, isError, error } = useQuery<LiveCampaignsResponse>({
    queryKey: [
      "live-campaigns",
      activeWorkspaceId,
      statusFilter,
      platformFilter,
      trafficSourceFilter,
      geoFilter,
      networkFilter,
      batchFilter,
      liveDateFilter,
      offset,
    ],
    enabled: !!activeWorkspaceId,
    queryFn: () => authedJson(`/api/live-campaigns?${params.toString()}`),
  });
  const campaigns = response?.items ?? [];
  const pagination = response?.pagination;
  const errorMessage = error instanceof Error ? error.message : "Unable to load live campaigns.";

  const metricsParams = new URLSearchParams();
  if (activeWorkspaceId) metricsParams.set("workspace_id", String(activeWorkspaceId));
  metricsParams.set("date", metricsDate);
  metricsParams.set("status", statusFilter);

  const { data: metricsResponse } = useQuery<{ date: string; items: DailyMetricRow[] }>({
    queryKey: ["campaign-daily-metrics", activeWorkspaceId, metricsDate, statusFilter],
    enabled: !!activeWorkspaceId && !!metricsDate,
    queryFn: () => authedJson(`/api/campaign-daily-metrics?${metricsParams.toString()}`),
  });

  const metricsByCampaignId = useMemo(() => {
    const map = new Map<number, DailyMetricRow>();
    for (const row of metricsResponse?.items ?? []) {
      map.set(row.campaignId, row);
    }
    return map;
  }, [metricsResponse?.items]);

  useEffect(() => {
    const next: Record<number, MetricDraft> = {};
    for (const c of campaigns) {
      const saved = metricsByCampaignId.get(c.id);
      next[c.id] = saved ? draftFromMetric(saved) : defaultDraft();
    }
    setMetricDrafts(next);
    setSaveState({});
  }, [campaigns, metricsByCampaignId, metricsDate]);

  async function saveMetricsForCampaign(campaignId: number) {
    if (!activeWorkspaceId) return;
    const draft = metricDrafts[campaignId] ?? defaultDraft();
    setSaveState((s) => ({ ...s, [campaignId]: "saving" }));
    try {
      await authedJson("/api/campaign-daily-metrics", {
        method: "PUT",
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          campaignId,
          date: metricsDate,
          cost: draft.cost,
          revenue: draft.revenue,
          conversions: Number(draft.conversions),
          visits: Number(draft.visits),
        }),
      });
      setSaveState((s) => ({ ...s, [campaignId]: "saved" }));
      void queryClient.invalidateQueries({ queryKey: ["campaign-daily-metrics"] });
      window.setTimeout(() => {
        setSaveState((s) => (s[campaignId] === "saved" ? { ...s, [campaignId]: "idle" } : s));
      }, 2000);
    } catch {
      setSaveState((s) => ({ ...s, [campaignId]: "error" }));
    }
  }

  function updateDraft(campaignId: number, patch: Partial<MetricDraft>) {
    setMetricDrafts((prev) => ({
      ...prev,
      [campaignId]: { ...(prev[campaignId] ?? defaultDraft()), ...patch },
    }));
    setSaveState((s) => (s[campaignId] === "saved" ? { ...s, [campaignId]: "idle" } : s));
  }

  const trafficSourceOptions = useMemo(
    () =>
      Array.from(
        new Map(
          optionCampaigns
            .filter((c) => c.trafficSourceId != null && c.trafficSourceName)
            .map((c) => [String(c.trafficSourceId), c.trafficSourceName as string]),
        ).entries(),
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [optionCampaigns],
  );
  const geoOptions = useMemo(
    () => Array.from(new Set(optionCampaigns.map((c) => c.batchGeo).filter((value): value is string => Boolean(value)))).sort(),
    [optionCampaigns],
  );
  const networkOptions = useMemo(
    () => Array.from(new Set(optionCampaigns.map((c) => c.batchAffiliateNetwork).filter((value): value is string => Boolean(value)))).sort(),
    [optionCampaigns],
  );
  const batchOptions = useMemo(
    () =>
      Array.from(
        new Map(
          optionCampaigns
            .filter((c) => c.batchId != null)
            .map((c) => [String(c.batchId), c.batchName ?? `Batch #${c.batchId}`]),
        ).entries(),
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [optionCampaigns],
  );

  const workingParentCampaigns = useMemo(
    () =>
      optionCampaigns
        .filter((c) => c.campaignPurpose === "working" && c.status === "live")
        .map((c) => ({ id: c.id, campaignName: c.campaignName, campaignPurpose: c.campaignPurpose })),
    [optionCampaigns],
  );

  const q = search.trim().toLowerCase();
  const filtered = campaigns.filter((c) => {
    if (!q) return true;
    return (
        [c.campaignName, c.batchName, c.voluumCampaignName, c.trafficSourceName, c.employeeName]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q))
    );
  });
  const total = pagination?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + pageSize, total);
  const canGoPrevious = offset > 0;
  const canGoNext = offset + pageSize < total;
  const optionsErrorMessage = optionsError instanceof Error ? optionsError.message : "Some filter options could not be loaded.";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Testing campaigns appear after take-campaign-live. Production working/scaling campaigns are added manually and skip CampaignOps.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add production campaign
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="tested">Tested</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Platform</label>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="ios">iOS</SelectItem>
              <SelectItem value="android">Android</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Traffic source</label>
          <Select value={trafficSourceFilter} onValueChange={setTrafficSourceFilter}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {trafficSourceOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Search</label>
          <Input className="mt-1 h-9" placeholder="Name, batch, worker…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Affiliate Network</label>
          <Select value={networkFilter} onValueChange={setNetworkFilter}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All networks</SelectItem>
              {networkOptions.map((network) => (
                <SelectItem key={network} value={network}>{network}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">GEO</label>
          <Select value={geoFilter} onValueChange={setGeoFilter}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All GEOs</SelectItem>
              {geoOptions.map((geo) => (
                <SelectItem key={geo} value={geo}>{geo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Batch</label>
          <Select value={batchFilter} onValueChange={setBatchFilter}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All batches</SelectItem>
              {batchOptions.map(([id, label]) => (
                <SelectItem key={id} value={id}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Date went live</label>
          <Input className="mt-1 h-9" type="date" value={liveDateFilter} onChange={(e) => setLiveDateFilter(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Metrics date</label>
          <Input
            className="mt-1 h-9"
            type="date"
            value={metricsDate}
            onChange={(e) => setMetricsDate(e.target.value)}
          />
        </div>
      </div>

      {isOptionsError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {optionsErrorMessage}
        </div>
      )}

      <div className="rounded-md border border-border bg-card/50 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Traffic source</TableHead>
              <TableHead>Network / GEO</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Live since</TableHead>
              <TableHead className="text-right min-w-[72px]">Cost</TableHead>
              <TableHead className="text-right min-w-[72px]">Revenue</TableHead>
              <TableHead className="text-right min-w-[56px]">Conv.</TableHead>
              <TableHead className="text-right min-w-[56px]">Visits</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">ROI</TableHead>
              <TableHead className="w-[72px]">Save</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">ROI</TableHead>
              <TableHead className="text-right">Winners</TableHead>
              <TableHead>Worker</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={20} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={20} className="text-center py-8 text-destructive">{errorMessage}</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={20} className="text-center py-8 text-muted-foreground">No campaigns match these filters.</TableCell></TableRow>
            ) : (
              filtered.map((c) => {
                const draft = metricDrafts[c.id] ?? defaultDraft();
                const derived = deriveProfitRoi(draft.cost, draft.revenue);
                const rowSave = saveState[c.id] ?? "idle";
                return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <div>{c.campaignName}</div>
                    {c.batchName && <div className="text-[11px] text-muted-foreground">Batch: {c.batchName}{c.batchGeo ? ` • ${c.batchGeo}` : ""}</div>}
                    {c.voluumCampaignId && <div className="text-[11px] text-muted-foreground font-mono">Voluum: {c.voluumCampaignId}</div>}
                  </TableCell>
                  <TableCell>
                    <PurposeBadge purpose={c.campaignPurpose ?? "testing"} />
                  </TableCell>
                  <TableCell><Badge variant="outline" className="uppercase text-[10px]">{c.platform}</Badge></TableCell>
                  <TableCell>{c.trafficSourceName ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    <div>{c.batchAffiliateNetwork ?? "—"}</div>
                    <div className="text-muted-foreground">{c.batchGeo ?? "—"}</div>
                  </TableCell>
                  <TableCell><StatusBadge status={c.status} /></TableCell>
                  <TableCell className="text-xs">{fmtDate(c.liveStartedAt)}</TableCell>
                  <TableCell className="p-1">
                    <Input
                      className="h-8 text-right tabular-nums text-xs"
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.cost}
                      onChange={(e) => updateDraft(c.id, { cost: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      className="h-8 text-right tabular-nums text-xs"
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.revenue}
                      onChange={(e) => updateDraft(c.id, { revenue: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      className="h-8 text-right tabular-nums text-xs w-16"
                      type="number"
                      min="0"
                      step="1"
                      value={draft.conversions}
                      onChange={(e) => updateDraft(c.id, { conversions: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      className="h-8 text-right tabular-nums text-xs w-16"
                      type="number"
                      min="0"
                      step="1"
                      value={draft.visits}
                      onChange={(e) => updateDraft(c.id, { visits: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{fmtMoney(derived.profit)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{fmtPct(derived.roi)}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] px-2"
                      disabled={rowSave === "saving"}
                      onClick={() => void saveMetricsForCampaign(c.id)}
                    >
                      {rowSave === "saving" ? "…" : rowSave === "saved" ? "Saved" : rowSave === "error" ? "Error" : "Save"}
                    </Button>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(c.cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(c.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(c.roi)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.winnersCount ?? "—"}</TableCell>
                  <TableCell className="text-xs">{c.employeeName ?? "—"}</TableCell>
                  <TableCell>
                    {c.status !== "closed" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setCloseTarget({ id: c.id, name: c.campaignName })}
                      >
                        Close
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div>
          {isLoading ? "Loading live campaigns…" : `Showing ${pageStart}-${pageEnd} of ${total} campaigns`}
          {q && filtered.length !== campaigns.length ? ` (${filtered.length} match search on this page)` : ""}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50"
            disabled={!canGoPrevious}
            onClick={() => setOffset((current) => Math.max(0, current - pageSize))}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50"
            disabled={!canGoNext}
            onClick={() => setOffset((current) => current + pageSize)}
          >
            Next
          </button>
        </div>
      </div>

      {closeTarget && (
        <ManualCloseCampaignDialog
          open={!!closeTarget}
          onOpenChange={(open) => !open && setCloseTarget(null)}
          campaignId={closeTarget.id}
          campaignName={closeTarget.name}
          onClosed={() => {
            void queryClient.invalidateQueries({ queryKey: ["live-campaigns"] });
            void queryClient.invalidateQueries({ queryKey: ["live-campaign-filter-options"] });
          }}
        />
      )}

      {isAdmin && (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add production live campaign</DialogTitle>
            </DialogHeader>
            <ProductionLiveCampaignForm
              workingParents={workingParentCampaigns}
              onCreated={() => setAddOpen(false)}
              onCancel={() => setAddOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
