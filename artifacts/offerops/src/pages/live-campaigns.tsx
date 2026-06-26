// CampaignOps redesign — Live Campaigns page.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Upload } from "lucide-react";
import { VoluumMetricsImportDialog } from "@/components/voluum-metrics-import-dialog";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace-context";
import { authedJson } from "@/lib/api-fetch";
import { ProductionLiveCampaignForm } from "@/components/production-live-campaign-form";
import { ManualCloseCampaignDialog } from "@/components/manual-close-campaign-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDateFilterState } from "@/hooks/use-date-filter-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useListOffers,
  getListOffersQueryKey,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useAlertRules } from "@/hooks/use-alert-rules";
import type { MonitoringCampaign } from "@/components/live-campaigns/live-campaigns-monitoring-table";
import { LiveCampaignsSummaryTable } from "@/components/live-campaigns/live-campaigns-summary-table";
import { LiveCampaignDrawer } from "@/components/live-campaigns/live-campaign-drawer";
import { PerformanceRangePicker } from "@/components/live-campaigns/performance-range-picker";
import { formatPerformanceRangeLabel } from "@/components/live-campaigns/live-campaign-labels";
import { LiveCampaignsAdminDeleteDialog } from "@/components/live-campaigns/live-campaigns-admin-delete-dialog";
import { RefreshingHint } from "@/components/operational-state/refreshing-hint";
import { operationalErrorMessage } from "@/lib/operational-feedback";

type Campaign = MonitoringCampaign & {
  workspaceId: number;
  trafficSourceId: number | null;
  voluumCampaignName: string | null;
  trafficSourceCampaignId: string | null;
  trafficSourceCampaignUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type LiveCampaignsResponse = {
  items: Campaign[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};

type DailyMetricRow = {
  campaignId: number;
  cost: string;
  revenue: string;
  conversions: number;
  visits: number;
  profit: string;
  roi: string | null;
  epc: string | null;
};

type RangeMetricsResponse = {
  dateFrom: string;
  dateTo: string;
  items: DailyMetricRow[];
};

export default function LiveCampaigns() {
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const { rules } = useAlertRules();
  const queryClient = useQueryClient();
  const isAdmin = currentEmployee?.role === "admin";
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<{ id: number; name: string } | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<MonitoringCampaign | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("live");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [trafficSourceFilter, setTrafficSourceFilter] = useState<string>("all");
  const [geoFilter, setGeoFilter] = useState<string>("all");
  const [networkFilter, setNetworkFilter] = useState<string>("all");
  const [batchFilter, setBatchFilter] = useState<string>("all");
  const perfRange = useDateFilterState({
    storageKey: "offerops.dateFilter.livePerformanceRange",
    defaultPreset: "last7",
    syncUrl: false,
  });
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const pageSize = 50;

  const performanceRangeLabel = formatPerformanceRangeLabel(
    (perfRange.preset === "all" ? "last7" : perfRange.preset) as import("@/lib/date-filter-presets").DateRangePreset,
    perfRange.dateFrom,
    perfRange.dateTo,
  );

  useEffect(() => {
    setStatusFilter("live");
    setPlatformFilter("all");
    setTrafficSourceFilter("all");
    setGeoFilter("all");
    setNetworkFilter("all");
    setBatchFilter("all");
    perfRange.clearToDefault();
    setSearch("");
    setOffset(0);
  }, [activeWorkspaceId]);

  useEffect(() => {
    setOffset(0);
  }, [
    statusFilter,
    platformFilter,
    trafficSourceFilter,
    geoFilter,
    networkFilter,
    batchFilter,
    perfRange.dateFrom,
    perfRange.dateTo,
    search,
  ]);

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

  const {
    data: response,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<LiveCampaignsResponse>({
    queryKey: [
      "live-campaigns",
      activeWorkspaceId,
      statusFilter,
      platformFilter,
      trafficSourceFilter,
      geoFilter,
      networkFilter,
      batchFilter,
      offset,
    ],
    enabled: !!activeWorkspaceId,
    queryFn: () => authedJson(`/api/live-campaigns?${params.toString()}`),
  });
  const campaignItems = response?.items;
  const campaigns = campaignItems ?? [];
  const pagination = response?.pagination;
  const loadErrorMessage = operationalErrorMessage(
    error,
    "Couldn't load live campaigns.",
  );

  const metricsParams = new URLSearchParams();
  if (activeWorkspaceId) metricsParams.set("workspace_id", String(activeWorkspaceId));
  metricsParams.set("date_from", perfRange.dateFrom);
  metricsParams.set("date_to", perfRange.dateTo);
  metricsParams.set("status", statusFilter);

  const { data: metricsResponse } = useQuery<RangeMetricsResponse>({
    queryKey: [
      "campaign-daily-metrics-range",
      activeWorkspaceId,
      perfRange.dateFrom,
      perfRange.dateTo,
      statusFilter,
    ],
    enabled: !!activeWorkspaceId,
    queryFn: () => authedJson(`/api/campaign-daily-metrics?${metricsParams.toString()}`),
  });

  const metricsByCampaignId = useMemo(() => {
    const map = new Map<number, DailyMetricRow>();
    for (const row of metricsResponse?.items ?? []) {
      map.set(row.campaignId, row);
    }
    return map;
  }, [metricsResponse?.items]);

  const offerParams = useMemo(
    () => ({ workspace_id: activeWorkspaceId ?? 0 }),
    [activeWorkspaceId],
  );
  const { data: offers = [] } = useListOffers(
    offerParams,
    wsQueryOpts(activeWorkspaceId, getListOffersQueryKey(offerParams)),
  );
  const offersPerBatch = useMemo(() => {
    const m = new Map<number, number>();
    for (const o of offers) {
      if (o.batchId == null) continue;
      m.set(o.batchId, (m.get(o.batchId) ?? 0) + 1);
    }
    return m;
  }, [offers]);

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
  const optionsErrorMessage = operationalErrorMessage(
    optionsError,
    "Some filter options could not be loaded.",
  );

  const selectedOfferCount =
    selectedCampaign?.batchId != null ? offersPerBatch.get(selectedCampaign.batchId) ?? 0 : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Live Campaigns</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Campaign monitoring — scan health, traffic pacing, and performance at a glance.
            Daily metrics come from Voluum CSV import; lifetime totals from campaign records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-1.5 h-4 w-4" />
            Import Voluum CSV
          </Button>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete metrics data
            </Button>
          )}
          {/* Manual production campaign: available to all workspace members.
              Ownership is enforced server-side from the auth token. */}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add manual campaign
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
          <label className="text-xs font-medium text-muted-foreground">OS</label>
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
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200/90 bg-gradient-to-b from-white to-slate-50/40 px-4 py-3 shadow-sm">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Performance Range
          </p>
          <div className="mt-2 max-w-xl">
            <PerformanceRangePicker
              preset={(perfRange.preset === "all" ? "last7" : perfRange.preset) as import("@/lib/date-filter-presets").DateRangePreset}
              dateFrom={perfRange.dateFrom}
              dateTo={perfRange.dateTo}
              onPresetChange={perfRange.setPreset}
              onCustomRangeChange={perfRange.setCustomRange}
            />
          </div>
        </div>
      </div>

      {isOptionsError && (
        <p className="rounded-md border border-amber-200/80 bg-amber-50/50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
          {optionsErrorMessage} Filters may be limited until options reload.
        </p>
      )}

      <LiveCampaignsSummaryTable
        campaigns={filtered}
        metricsByCampaignId={metricsByCampaignId}
        offersPerBatch={offersPerBatch}
        performanceRangeLabel={performanceRangeLabel}
        rules={rules}
        isLoading={isLoading}
        isError={isError}
        loadErrorMessage={loadErrorMessage}
        error={error}
        onRetry={() => void refetch()}
        retrying={isFetching}
        onSelectCampaign={setSelectedCampaign}
      />

      <LiveCampaignDrawer
        campaign={selectedCampaign}
        rangeMetrics={selectedCampaign ? metricsByCampaignId.get(selectedCampaign.id) : undefined}
        performanceRangeLabel={performanceRangeLabel}
        offerCount={selectedOfferCount}
        rules={rules}
        open={selectedCampaign != null}
        onClose={() => setSelectedCampaign(null)}
        onImportCsv={() => {
          setSelectedCampaign(null);
          setImportOpen(true);
        }}
        onCloseCampaign={setCloseTarget}
      />

      <RefreshingHint visible={isFetching && !isLoading} className="mb-1" />

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div>
          {isLoading
            ? "Loading campaigns…"
            : `Showing ${pageStart}-${pageEnd} of ${total} campaigns`}
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

      <VoluumMetricsImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        workspaceId={activeWorkspaceId ?? 0}
        metricsDate={perfRange.dateTo}
        onMetricsDateChange={(d) => perfRange.setCustomRange(d, d)}
        statusFilter={statusFilter}
      />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add manual campaign</DialogTitle>
          </DialogHeader>
          <ProductionLiveCampaignForm
            workingParents={workingParentCampaigns}
            onCreated={() => setAddOpen(false)}
            onCancel={() => setAddOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {isAdmin && (
        <LiveCampaignsAdminDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          workspaceId={activeWorkspaceId ?? 0}
          onDeleted={() => {
            void queryClient.invalidateQueries({ queryKey: ["campaign-daily-metrics"] });
          }}
        />
      )}
    </div>
  );
}
