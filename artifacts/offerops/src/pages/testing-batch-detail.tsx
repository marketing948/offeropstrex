import { useParams } from "wouter";
import { wsQueryOpts } from "@/lib/ws-query";
import {
  useGetTestingBatch,
  useListOffers,
  useClassifyOffer,
  useGoLiveBatch,
  useMarkBatchReady,
  useStartOptimization,
  useCompleteOptimization,
  useCreateOffer,
  useDeleteOffer,
  useUpdateTestingBatch,
  useCreateTodoTask,
  useListPerformance,
  useListVoluumMappings,
  useListWorkspaceTrafficSources,
  useListAffiliateNetworks,
  useListGeos,
  useListEmployees,
  useListTodoTasks,
  useListCampaigns,
  useListBatchResults,
  getListCampaignsQueryKey,
  getListBatchResultsQueryKey,
  getListOffersQueryKey,
  getGetTestingBatchQueryKey,
  getGetQueuesQueryKey,
  getListPerformanceQueryKey,
  getListVoluumMappingsQueryKey,
  getListWorkspaceTrafficSourcesQueryKey,
  getListAffiliateNetworksQueryKey,
  getListGeosQueryKey,
  getListEmployeesQueryKey,
  getListTodoTasksQueryKey,
} from "@workspace/api-client-react";
import { MissingVoluumBadge } from "@/components/voluum-entity-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VOLUUM_UI_ENABLED } from "@/lib/feature-flags";
import { useWorkspace } from "@/lib/workspace-context";
import type { TestingBatch, Offer, Performance, Campaign, BatchResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import {
  Radio, Zap, Trophy, ThumbsDown,
  TrendingUp, Plus, Trash2, ArrowLeft, Target, Globe,
  Network, Users, Download, Rocket, AlertCircle, Link2,
  DollarSign, MousePointerClick, BarChart3, Repeat, Settings,
  ChevronRight, Save, X, List, Clock,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────
// Status configs
// ────────────────────────────────────────────────────────────────
// Phase 9a: shared 6-state config; legacy 12-state map removed.
import { batchStatusConfig as sharedBatchStatusConfig } from "@/lib/batch-status";

// Phase 9a/10d: spec-canonical 4-state offer enum (Bible §7).
// Workflow states (scaling / moved_to_main / retest / rejected /
// closed / uploaded / testing) lived on the legacy 12-state machine
// and are gone — every dropped key would render as "Unknown" today.
const OFFER_STATUS_CFG: Record<string, { label: string; cls: string; activeBtn: string; inactiveBtn: string }> = {
  imported: { label: "Imported", cls: "bg-gray-100 text-gray-600",        activeBtn: "bg-gray-500 text-white",      inactiveBtn: "bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200" },
  tested:   { label: "Tested",   cls: "bg-blue-100 text-blue-700",         activeBtn: "bg-blue-500 text-white",      inactiveBtn: "bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" },
  winner:   { label: "Winner",   cls: "bg-green-100 text-green-700 font-semibold", activeBtn: "bg-green-500 text-white", inactiveBtn: "bg-green-50 text-green-600 hover:bg-green-100 border border-green-200" },
  loser:    { label: "Loser",    cls: "bg-red-100 text-red-600",           activeBtn: "bg-red-500 text-white",       inactiveBtn: "bg-red-50 text-red-500 hover:bg-red-100 border border-red-200" },
};

// ────────────────────────────────────────────────────────────────
// CSV export utility
// ────────────────────────────────────────────────────────────────
function exportWinnersCSV(batch: TestingBatch, winners: Offer[], campaignName: string | null) {
  const headers = [
    "batchName", "affiliateNetwork", "GEO", "trafficSource", "voluumCampaignName",
    "offerId", "offerName", "status", "notes", "detectedAt",
  ];
  const rows = winners.map(o => [
    batch.batchName,
    batch.affiliateNetwork,
    batch.geo,
    batch.trafficSource,
    campaignName ?? "",
    o.offerId ?? "",
    o.offerName,
    o.status,
    o.notes ?? "",
    new Date(o.createdAt).toISOString(),
  ]);
  const csvContent = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `winners-${batch.batchName.replace(/[^a-z0-9]/gi, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────────────────────────────
// Aggregated performance from daily rows
// ────────────────────────────────────────────────────────────────
function aggregatePerf(rows: Performance[]) {
  const a = { clicks: 0, spend: 0, revenue: 0, profit: 0, conversions: 0 };
  for (const r of rows) {
    a.clicks += Number(r.clicks ?? 0);
    a.spend += Number(r.spend ?? 0);
    a.revenue += Number(r.revenue ?? 0);
    a.profit += Number(r.profit ?? 0);
    a.conversions += Number(r.conversions ?? 0);
  }
  const roi = a.spend > 0 ? ((a.revenue - a.spend) / a.spend) * 100 : 0;
  return { ...a, roi };
}

function fmt(n: number, prefix = "", suffix = "", decimals = 2) {
  return `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: decimals })}${suffix}`;
}

// ────────────────────────────────────────────────────────────────
// Metric card
// ────────────────────────────────────────────────────────────────
function MetCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string; color?: string; icon?: React.ElementType;
}) {
  return (
    <Card className="border border-border shadow-sm">
      <CardContent className="px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          {Icon && <Icon size={13} className="text-muted-foreground opacity-50" />}
        </div>
        <p className={`text-lg font-bold ${color ?? "text-foreground"}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Tab type
// ────────────────────────────────────────────────────────────────
type Tab = "overview" | "offers" | "setup";

// ────────────────────────────────────────────────────────────────
// Batch Setup edit form
// ────────────────────────────────────────────────────────────────
function BatchSetupForm({
  batch,
  onSaved,
}: {
  batch: TestingBatch;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeWorkspaceId } = useWorkspace();
  const [form, setForm] = useState({
    affiliateNetworkId: batch.affiliateNetworkId != null ? String(batch.affiliateNetworkId) : "",
    geoId: batch.geoId != null ? String(batch.geoId) : "",
    // Pivot Phase 3: do NOT seed from `currentTrafficSourceId` — that
    // legacy column FK-targets `voluum_traffic_sources`, while the
    // manual flow validates trafficSourceId against
    // `workspace_traffic_sources`. Mixing the two would cause an
    // unchanged save on a legacy batch to fail with "trafficSourceId
    // not found in this workspace". Leave empty so the user picks
    // (and so PATCH only updates trafficSource when they do).
    trafficSourceId: "",
    assignedWorkerId: batch.employeeId != null ? String(batch.employeeId) : "",
    testRound: batch.testRound != null ? String(batch.testRound) : "1",
    startDate: batch.startDate ?? "",
    testDurationHours: batch.testDurationHours != null ? String(batch.testDurationHours) : "48",
    numberOfOffers: batch.numberOfOffers != null ? String(batch.numberOfOffers) : "",
    clicksThreshold: batch.clicksThreshold != null ? String(batch.clicksThreshold) : "",
    testBudget: batch.testBudget != null ? String(batch.testBudget) : "",
    notes: batch.notes ?? "",
  });

  const lookupParams = { workspace_id: activeWorkspaceId ?? 0 };
  const enabled = !!activeWorkspaceId;
  const { data: affiliateNetworks = [] } = useListAffiliateNetworks(
    lookupParams,
    wsQueryOpts(activeWorkspaceId, getListAffiliateNetworksQueryKey(lookupParams), { enabled }),
  );
  const { data: geos = [] } = useListGeos(
    lookupParams,
    wsQueryOpts(activeWorkspaceId, getListGeosQueryKey(lookupParams), { enabled }),
  );
  const { data: trafficSources = [] } = useListWorkspaceTrafficSources(
    lookupParams,
    wsQueryOpts(activeWorkspaceId, getListWorkspaceTrafficSourcesQueryKey(lookupParams), { enabled }),
  );
  const empParams = activeWorkspaceId ? { workspace_id: activeWorkspaceId } : undefined;
  const { data: employees = [] } = useListEmployees(
    empParams,
    { query: { queryKey: getListEmployeesQueryKey(empParams), enabled, staleTime: 60_000 } },
  );

  const update = useUpdateTestingBatch({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetTestingBatchQueryKey(batch.id) });
        toast({ title: "Batch settings saved" });
        onSaved();
      },
      onError: (e: unknown) => toast({ title: "Failed to save", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
    },
  });

  function save() {
    update.mutate({
      id: batch.id,
      data: {
        affiliateNetworkId: form.affiliateNetworkId ? Number(form.affiliateNetworkId) : undefined,
        geoId: form.geoId ? Number(form.geoId) : undefined,
        trafficSourceId: form.trafficSourceId ? Number(form.trafficSourceId) : undefined,
        assignedWorkerId: form.assignedWorkerId ? Number(form.assignedWorkerId) : undefined,
        testRound: form.testRound ? Number(form.testRound) : null,
        startDate: form.startDate || null,
        testDurationHours: form.testDurationHours ? Number(form.testDurationHours) : null,
        numberOfOffers: form.numberOfOffers ? Number(form.numberOfOffers) : null,
        clicksThreshold: form.clicksThreshold ? Number(form.clicksThreshold) : null,
        testBudget: form.testBudget ? Number(form.testBudget) : null,
        notes: form.notes || null,
      },
    });
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [key]: e.target.value })),
  });
  const setSel = (key: keyof typeof form) => (v: string) => setForm(p => ({ ...p, [key]: v }));

  return (
    <Card className="border border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Settings size={15} className="text-muted-foreground" />
          Batch Setup
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-medium">Affiliate Network</Label>
            <Select value={form.affiliateNetworkId} onValueChange={setSel("affiliateNetworkId")}>
              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder={batch.affiliateNetwork ?? "Select…"} /></SelectTrigger>
              <SelectContent>
                {affiliateNetworks.map(n => <SelectItem key={n.id} value={String(n.id)}>{n.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium">GEO</Label>
            <Select value={form.geoId} onValueChange={setSel("geoId")}>
              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder={batch.geo ?? "Select…"} /></SelectTrigger>
              <SelectContent>
                {geos.map(g => <SelectItem key={g.id} value={String(g.id)}>{g.code}{g.name ? ` — ${g.name}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium">Traffic Source</Label>
            <Select value={form.trafficSourceId} onValueChange={setSel("trafficSourceId")}>
              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder={batch.trafficSource ?? "Select…"} /></SelectTrigger>
              <SelectContent>
                {trafficSources.map(ts => <SelectItem key={ts.id} value={String(ts.id)}>{ts.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium">Assigned Worker</Label>
            <Select value={form.assignedWorkerId} onValueChange={setSel("assignedWorkerId")}>
              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick worker…" /></SelectTrigger>
              <SelectContent>
                {employees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium">Number of Offers</Label>
            <Input className="mt-1 h-9" type="number" placeholder="e.g. 250" {...field("numberOfOffers")} />
          </div>
          <div>
            <Label className="text-xs font-medium">Test Round</Label>
            <Input className="mt-1 h-9" type="number" min={1} placeholder="1" {...field("testRound")} />
          </div>
          <div>
            <Label className="text-xs font-medium">Start Date</Label>
            <Input className="mt-1 h-9" type="date" {...field("startDate")} />
          </div>
          <div>
            <Label className="text-xs font-medium">Test Duration (hours)</Label>
            <Input className="mt-1 h-9" type="number" min={1} placeholder="48" {...field("testDurationHours")} />
          </div>
          <div>
            <Label className="text-xs font-medium">Budget ($)</Label>
            <Input className="mt-1 h-9" type="number" placeholder="e.g. 500" {...field("testBudget")} />
          </div>
          <div>
            <Label className="text-xs font-medium">Click Threshold</Label>
            <Input className="mt-1 h-9" type="number" placeholder="e.g. 25000" {...field("clicksThreshold")} />
          </div>
        </div>
        <div>
          <Label className="text-xs font-medium">Notes</Label>
          <Textarea className="mt-1 min-h-[80px] text-sm" placeholder="Any notes about this batch…" {...field("notes")} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" onClick={save} disabled={update.isPending}>
            <Save size={13} className="mr-1.5" />
            {update.isPending ? "Saving…" : "Save Settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────
export default function TestingBatchDetail() {
  const params = useParams<{ id: string }>();
  const batchId = Number(params.id);
  const { currentEmployee } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>("overview");
  const [offerFilter, setOfferFilter] = useState<string>("all");
  const [newOfferName, setNewOfferName] = useState("");
  const [addingOffer, setAddingOffer] = useState(false);
  const [selectedWinners, setSelectedWinners] = useState<Set<number>>(new Set());

  const { activeWorkspaceId } = useWorkspace();
  const offersParams = { batch_id: batchId, workspace_id: activeWorkspaceId ?? 0 };
  const perfParams = { batch_id: batchId, workspace_id: activeWorkspaceId ?? 0 };
  const mappingsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const { data: batch, isLoading: batchLoading } = useGetTestingBatch(batchId);
  const { data: offers = [], isLoading: offersLoading } = useListOffers(
    offersParams,
    wsQueryOpts(activeWorkspaceId, getListOffersQueryKey(offersParams)),
  );
  const { data: perfRows = [] } = useListPerformance(
    perfParams,
    wsQueryOpts(activeWorkspaceId, getListPerformanceQueryKey(perfParams)),
  );
  const { data: mappings = [] } = useListVoluumMappings(
    mappingsParams,
    wsQueryOpts(activeWorkspaceId, getListVoluumMappingsQueryKey(mappingsParams), { enabled: VOLUUM_UI_ENABLED && !!activeWorkspaceId }),
  );

  // Phase 9 (was Phase-3 fan-out): tracker-campaign tasks for THIS
  // batch. After Phase 2 the engine emits one task per device
  // (CREATE_IOS_TRACKER_CAMPAIGN + CREATE_ANDROID_TRACKER_CAMPAIGN)
  // for the batch's CURRENT traffic source — never the legacy
  // create_test_campaign type. We fetch both and merge so the existing
  // detail-page panels can keep treating them as a single "test
  // campaign tasks" set without an API change.
  const iosBatchTasksParams = { workspace_id: activeWorkspaceId ?? 0, task_type: "CREATE_IOS_TRACKER_CAMPAIGN" as const };
  const andBatchTasksParams = { workspace_id: activeWorkspaceId ?? 0, task_type: "CREATE_ANDROID_TRACKER_CAMPAIGN" as const };
  const { data: iosBatchTasks = [] } = useListTodoTasks(
    iosBatchTasksParams,
    wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(iosBatchTasksParams)),
  );
  const { data: andBatchTasks = [] } = useListTodoTasks(
    andBatchTasksParams,
    wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(andBatchTasksParams)),
  );
  const testCampaignTasks = useMemo(
    () => [...iosBatchTasks, ...andBatchTasks].filter(t => t.relatedBatchId === batchId),
    [iosBatchTasks, andBatchTasks, batchId],
  );

  const campaignMapping = useMemo(
    () => mappings.find(m => m.batchId === batchId) ?? null,
    [mappings, batchId]
  );

  const perf = useMemo(() => aggregatePerf(perfRows), [perfRows]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getGetTestingBatchQueryKey(batchId) });
    qc.invalidateQueries({ queryKey: getListOffersQueryKey({ batch_id: batchId, workspace_id: activeWorkspaceId ?? 0 }) });
    qc.invalidateQueries({ queryKey: getGetQueuesQueryKey({ workspace_id: activeWorkspaceId ?? 0 }) });
  };

  const goLive      = useGoLiveBatch({ mutation: { onSuccess: () => { invalidateAll(); toast({ title: "Batch is now Live! Click tracking started." }); } } });
  const markReady   = useMarkBatchReady({ mutation: { onSuccess: () => { invalidateAll(); toast({ title: "Batch moved to Optimization Queue." }); } } });
  const startOpt    = useStartOptimization({ mutation: { onSuccess: () => { invalidateAll(); toast({ title: "Optimization started — classify your offers." }); setTab("offers"); } } });
  const completeOpt = useCompleteOptimization({ mutation: { onSuccess: () => { invalidateAll(); toast({ title: "Optimization complete! Next-source task created." }); } } });
  const classify    = useClassifyOffer({ mutation: { onSuccess: () => invalidateAll() } });
  const createOffer = useCreateOffer({ mutation: { onSuccess: () => { invalidateAll(); setNewOfferName(""); setAddingOffer(false); toast({ title: "Offer added" }); } } });
  const deleteOffer = useDeleteOffer({ mutation: { onSuccess: () => { invalidateAll(); toast({ title: "Offer removed" }); } } });
  const createTask  = useCreateTodoTask({
    mutation: {
      onSuccess: () => {
        toast({ title: "Scale task created!", description: "It's now in the Tasks tab." });
      },
      onError: (e: unknown) => toast({ title: "Failed to create task", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
    },
  });

  if (batchLoading) {
    return (
      <div className="space-y-4 max-w-5xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!batch) return <div className="py-12 text-center text-muted-foreground">Batch not found.</div>;

  const sc = sharedBatchStatusConfig(batch.status);

  // Offer stats
  const winnerOffers  = offers.filter(o => o.status === "winner");
  const loserOffers   = offers.filter(o => o.status === "loser");
  // Phase 10d: "retest" dropped from offer enum; kept as empty array
  // so existing call sites don't crash. Remove in a follow-up sweep.
  const retestOffers: typeof offers = [];
  // Phase 10d: "scaling" is no longer a valid offer status in the
  // spec-canonical 4-state enum (imported/tested/winner/loser). The
  // batch — not the offer — owns workflow state. This list is
  // intentionally empty so any UI hangers-on render as "no scaling
  // offers" rather than crash; remove call sites in a follow-up.
  const scalingOffers: typeof offers = [];
  // Phase 10d: pre-classification offers under the new enum are
  // those still in "imported" (newly synced) or "tested" (threshold
  // reached, awaiting Pick Winners). Replaces legacy "uploaded"+"testing".
  const pendingOffers = offers.filter(o => ["imported", "tested"].includes(o.status));
  const totalOffers   = offers.length;

  // Click threshold progress
  const threshold = batch.clicksThreshold ?? 0;
  const clickPct  = threshold > 0 ? Math.min(100, Math.round((perf.clicks / threshold) * 100)) : 0;

  // Offers filtered
  // Phase 9a: "pending" is a UI-only roll-up of imported+tested
  // (anything not yet classified by the worker). Other filter values
  // are 1:1 with the spec's 4-state offer enum.
  const displayOffers =
    offerFilter === "all"
      ? offers
      : offerFilter === "pending"
        ? pendingOffers
        : offers.filter(o => o.status === offerFilter);

  // Phase 9a: classification happens once thresholds are met
  // (TESTED) and may continue through COMPLETED for late winner edits.
  const canClassify = ["TESTED", "COMPLETED"].includes(batch.status);

  // Action banner content
  const needsSetup  = !batch.clicksThreshold && !batch.testBudget;
  const hasWinners  = winnerOffers.length > 0 || scalingOffers.length > 0;
  // Scale-prep task suggested once we know which offers won.
  const needsScaleTask = hasWinners && ["TESTED", "COMPLETED"].includes(batch.status);

  function handleCreateScaleTask() {
    if (!batch || !currentEmployee) return;
    const allWinners = [...winnerOffers, ...scalingOffers];
    const winnerNames = allWinners.map(o => o.offerName).join(", ");
    createTask.mutate({
      data: {
        employeeId: batch.employeeId,
        relatedBatchId: batch.id,
        title: `Move winners from ${batch.batchName} to Scale Campaign`,
        description: `Winners (${allWinners.length}): ${winnerNames}\n\nBatch: ${batch.batchName} | Network: ${batch.affiliateNetwork} | GEO: ${batch.geo} | Source: ${batch.trafficSource}${campaignMapping ? ` | Campaign: ${campaignMapping.campaignName}` : ""}`,
        // Phase 2: FIND_WINNERS replaces the legacy "move_to_main"
        // scale-prep task. Status enum is now TODO/IN_PROGRESS/BLOCKED/
        // DONE — TODO is the new "open".
        taskType: "FIND_WINNERS",
        priority: "high",
        status: "TODO",
      },
    });
  }

  function handleDownloadCSV() {
    if (!batch) return;
    const winners = [...winnerOffers, ...scalingOffers];
    if (!winners.length) {
      toast({ title: "No winners to export", description: "Classify offers as Winner first.", variant: "destructive" });
      return;
    }
    exportWinnersCSV(batch, winners, campaignMapping?.campaignName ?? null);
    toast({ title: "CSV downloaded", description: `${winners.length} winner${winners.length !== 1 ? "s" : ""} exported.` });
  }

  function markAllPendingAs(status: "winner" | "loser") {
    for (const o of pendingOffers) {
      classify.mutate({ id: o.id, data: { status } });
    }
  }

  // ── Tabs
  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "offers",   label: `Offers (${totalOffers})`, icon: List },
    { id: "setup",    label: "Setup",    icon: Settings },
  ];

  return (
    <div className="space-y-5 max-w-5xl">
      {/* ── Back link + header ── */}
      <div>
        <button
          onClick={() => navigate("/testing-batches")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft size={14} /> Back to Batches
        </button>

        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{batch.batchName}</h1>
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${sc.bg} ${sc.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                {sc.label}
              </span>
              {VOLUUM_UI_ENABLED && (batch.voluumCampaignName || campaignMapping) && (
                <span
                  className="flex items-center gap-1 text-xs text-primary font-medium bg-primary/10 px-2 py-0.5 rounded-full"
                  title={batch.voluumCampaignName ? "Detected by Voluum sync" : "Mapped manually"}
                >
                  <Link2 size={10} /> {batch.voluumCampaignName ?? campaignMapping!.campaignName}
                  {batch.voluumCampaignName && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">via sync</span>
                  )}
                </span>
              )}
              {VOLUUM_UI_ENABLED && batch.batchTag && (
                <span
                  title="Voluum tag"
                  className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-muted text-muted-foreground"
                >
                  {batch.batchTag}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5">
                <Network size={12} />{batch.affiliateNetwork}
                {VOLUUM_UI_ENABLED && !batch.affiliateNetworkVoluumId && <MissingVoluumBadge />}
              </span>
              <span className="flex items-center gap-1"><Globe size={12} />{batch.geo}</span>
              <span className="flex items-center gap-1.5">
                <Target size={12} />{batch.trafficSource}
                {VOLUUM_UI_ENABLED && !batch.trafficSourceVoluumId && <MissingVoluumBadge />}
              </span>
              {batch.employeeName && <span className="flex items-center gap-1"><Users size={12} />{batch.employeeName}</span>}
              <span
                className="flex items-center gap-1"
                title={`Created ${new Date(batch.createdAt).toLocaleString()}`}
              >
                <Clock size={12} />Created {new Date(batch.createdAt).toLocaleDateString()}
              </span>
              {batch.liveAt && <span className="flex items-center gap-1"><Clock size={12} />Live {new Date(batch.liveAt).toLocaleDateString()}</span>}
              {VOLUUM_UI_ENABLED && batch.lastSyncAt && (
                <span
                  className="flex items-center gap-1"
                  title={`Last Voluum sync ${new Date(batch.lastSyncAt).toLocaleString()}`}
                >
                  <Clock size={12} />Synced {new Date(batch.lastSyncAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          {/* Primary lifecycle action — Phase 9a: 6-state machine.
              Most transitions are now engine-driven (NEW_BATCH →
              WAITING_FOR_TRACKER_CAMPAIGNS happens automatically when
              the engine emits CREATE_*_TRACKER_CAMPAIGN tasks, then
              → OFFER_READY_FOR_LIVE_TESTING flips when both trackers
              are imported, → TESTED flips when click threshold is met,
              → COMPLETED flips when all offers are classified). The
              one manual step the worker owns is confirming live
              traffic has actually started in Voluum. */}
          <div className="flex items-center gap-2">
            {batch.status === "OFFER_READY_FOR_LIVE_TESTING" && (
              <Button
                className="bg-green-600 hover:bg-green-700 text-white h-9"
                disabled={goLive.isPending}
                onClick={() => goLive.mutate({ id: batchId })}
                title="Both tracker campaigns are imported — confirm live traffic has started in Voluum"
              >
                <Radio size={13} className="mr-1.5" />{goLive.isPending ? "Updating…" : "Live Tests Started"}
              </Button>
            )}
            {batch.status === "TESTED" && (
              <Button
                className="bg-purple-600 hover:bg-purple-700 text-white h-9"
                onClick={() => setTab("offers")}
                title="Click threshold reached — classify offers as winner or loser"
              >
                <Trophy size={13} className="mr-1.5" />Pick Winners
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Action banners ── */}
      {needsSetup && (
        <div
          className="flex items-center gap-3 p-3.5 rounded-lg border border-blue-200 bg-blue-50 cursor-pointer hover:bg-blue-100 transition-colors"
          onClick={() => setTab("setup")}
        >
          <AlertCircle size={15} className="text-blue-600 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-semibold text-blue-800">Complete batch setup</span>
            <span className="text-blue-700 ml-1">— set a click threshold and budget so progress can be tracked.</span>
          </div>
          <ChevronRight size={14} className="text-blue-500" />
        </div>
      )}

      {/* Phase 9a: engine flips LIVE_TESTS → TESTED automatically on
          click-threshold; this banner just announces the transition
          and routes the worker to the offers tab to classify winners. */}
      {batch.status === "TESTED" && threshold > 0 && (
        <div className="flex items-center gap-3 p-3.5 rounded-lg border border-purple-300 bg-purple-50">
          <Trophy size={15} className="text-purple-600 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-semibold text-purple-900">Click threshold reached!</span>
            <span className="text-purple-700 ml-1">Classify each offer as winner or loser.</span>
          </div>
          <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white h-7 text-xs" onClick={() => setTab("offers")}>
            Pick Winners
          </Button>
        </div>
      )}

      {needsScaleTask && (
        <div className="flex items-center gap-3 p-3.5 rounded-lg border border-purple-300 bg-purple-50">
          <Rocket size={15} className="text-purple-600 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-semibold text-purple-800">{winnerOffers.length + scalingOffers.length} winner{(winnerOffers.length + scalingOffers.length) !== 1 ? "s" : ""} ready to scale</span>
            <span className="text-purple-700 ml-1">— create a scale task and export winners.</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-100" onClick={handleDownloadCSV}>
              <Download size={11} className="mr-1" /> CSV
            </Button>
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white h-7 text-xs" onClick={handleCreateScaleTask} disabled={createTask.isPending}>
              <Rocket size={11} className="mr-1" />{createTask.isPending ? "Creating…" : "Create Scale Task"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted"
            }`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════
          OVERVIEW TAB
      ══════════════════════════════════════════════ */}
      {tab === "overview" && (
        <div className="space-y-5">
          {/* Performance summary */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Performance</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetCard label="Clicks" value={perf.clicks.toLocaleString()} icon={MousePointerClick} />
              <MetCard label="Spend" value={fmt(perf.spend, "$")} icon={DollarSign} />
              <MetCard label="Revenue" value={fmt(perf.revenue, "$")} icon={TrendingUp} />
              <MetCard
                label="Profit"
                value={fmt(perf.profit, "$")}
                icon={BarChart3}
                color={perf.profit > 0 ? "text-green-600" : perf.profit < 0 ? "text-red-500" : undefined}
              />
              <MetCard
                label="ROI"
                value={perf.clicks > 0 ? `${perf.roi.toFixed(1)}%` : "—"}
                icon={TrendingUp}
                color={perf.roi > 0 ? "text-green-600" : perf.roi < 0 ? "text-red-500" : undefined}
              />
              <MetCard label="Conversions" value={String(perf.conversions)} icon={Target} />
            </div>
          </div>

          {/* Click progress */}
          {threshold > 0 && (
            <Card className="border border-border shadow-sm">
              <CardContent className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">Click Progress</span>
                  <span className="text-sm text-muted-foreground">
                    {perf.clicks.toLocaleString()} / {threshold.toLocaleString()} ({clickPct}%)
                  </span>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${clickPct >= 100 ? "bg-green-500" : clickPct > 75 ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: `${clickPct}%` }}
                  />
                </div>
                {batch.testBudget && (
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span>Budget: ${Number(batch.testBudget).toLocaleString()}</span>
                    {perf.spend > 0 && <span>Spent: ${perf.spend.toFixed(2)} ({((perf.spend / Number(batch.testBudget)) * 100).toFixed(0)}%)</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Test campaign fan-out (one task per traffic source × device) */}
          {testCampaignTasks.length > 0 && (() => {
            // Phase 2 task statuses: DONE / IN_PROGRESS / TODO / BLOCKED.
            const done = testCampaignTasks.filter(t => t.status === "DONE").length;
            const total = testCampaignTasks.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            // Build (source, device) grid
            const sources = Array.from(new Set(testCampaignTasks.map(t => t.trafficSourceName ?? "—")));
            const devices = Array.from(new Set(testCampaignTasks.map(t => t.device ?? "—")));
            const byKey = new Map<string, typeof testCampaignTasks[number]>();
            for (const t of testCampaignTasks) {
              byKey.set(`${t.trafficSourceName ?? "—"}::${t.device ?? "—"}`, t);
            }
            const STATUS_DOT: Record<string, string> = {
              DONE:        "bg-green-500",
              IN_PROGRESS: "bg-amber-500",
              TODO:        "bg-slate-300",
              BLOCKED:     "bg-gray-300",
            };
            // Pull the originating Voluum campaign name out of the
            // auto-completion footer that detectBatchesInVoluumCampaigns
            // appends to the task description: `… campaign "NAME" (ID)]`.
            // Surfaces "why did this flip?" right next to the cell.
            const matchedCampaignName = (t: typeof testCampaignTasks[number]): string | null => {
              if (!t.description) return null;
              const m = /Auto-completed by Voluum sync.*?campaign "([^"]+)"/.exec(t.description);
              return m ? m[1] : null;
            };
            return (
              <Card className="border border-border shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <List size={15} className="text-muted-foreground" />
                    Test Campaigns
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      {done} / {total} created
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-green-500" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">Traffic Source</th>
                          {devices.map(d => (
                            <th key={d} className="py-1.5 px-2 font-medium text-center">{d}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sources.map(s => (
                          <tr key={s} className="border-t border-border">
                            <td className="py-1.5 pr-3 font-medium">{s}</td>
                            {devices.map(d => {
                              const t = byKey.get(`${s}::${d}`);
                              if (!t) return <td key={d} className="py-1.5 px-2 text-center text-muted-foreground">—</td>;
                              const camp = matchedCampaignName(t);
                              return (
                                <td key={d} className="py-1.5 px-2 text-center align-top">
                                  <div className="inline-flex flex-col items-center gap-0.5">
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[t.status] ?? "bg-gray-300"}`} />
                                      <span className="capitalize">{t.status.replace(/_/g, " ")}</span>
                                    </span>
                                    {camp && t.status === "DONE" && (
                                      <span
                                        title={`Auto-completed via Voluum campaign: ${camp}`}
                                        className="inline-flex items-center gap-1 text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded max-w-[180px] truncate"
                                      >
                                        <Link2 size={9} className="shrink-0" />
                                        <span className="truncate">{camp}</span>
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Offer summary */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Offer Summary</h2>
              <button
                onClick={() => setTab("offers")}
                className="text-xs text-primary hover:underline flex items-center gap-0.5"
              >
                Manage offers <ChevronRight size={11} />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetCard label="Total Offers" value={String(totalOffers)} icon={List} />
              <MetCard label="Winners" value={String(winnerOffers.length + scalingOffers.length)} color={winnerOffers.length + scalingOffers.length > 0 ? "text-green-600" : undefined} icon={Trophy} />
              <MetCard label="Losers" value={String(loserOffers.length)} color={loserOffers.length > 0 ? "text-red-500" : undefined} icon={ThumbsDown} />
              <MetCard
                label="Pending"
                value={String(pendingOffers.length)}
                sub={retestOffers.length > 0 ? `${retestOffers.length} for retest` : undefined}
                color={pendingOffers.length > 0 && canClassify ? "text-amber-600" : undefined}
                icon={Repeat}
              />
            </div>
          </div>

          {/* Winner actions */}
          {hasWinners && (
            <Card className="border border-border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Rocket size={15} className="text-purple-500" />
                  Winner Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {winnerOffers.length + scalingOffers.length} winner{(winnerOffers.length + scalingOffers.length) !== 1 ? "s" : ""} found in this batch.
                  Export them as a CSV or create a scale task to track the move.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={handleDownloadCSV}>
                    <Download size={13} className="mr-1.5" /> Download Winners CSV
                  </Button>
                  <Button size="sm" onClick={handleCreateScaleTask} disabled={createTask.isPending}>
                    <Rocket size={13} className="mr-1.5" />
                    {createTask.isPending ? "Creating…" : "Create Scale Task"}
                  </Button>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                  {[...winnerOffers, ...scalingOffers].map(o => (
                    <div key={o.id} className="flex items-center gap-2 px-3 py-2">
                      <Trophy size={12} className="text-green-600 flex-shrink-0" />
                      <span className="text-sm flex-1 truncate">{o.offerName}</span>
                      {o.offerId && <span className="text-xs text-muted-foreground">ID: {o.offerId}</span>}
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${OFFER_STATUS_CFG[o.status]?.cls ?? ""}`}>
                        {OFFER_STATUS_CFG[o.status]?.label ?? o.status}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {batch.notes && (
            <Card className="border border-border shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold text-muted-foreground">Notes</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-foreground whitespace-pre-wrap">{batch.notes}</CardContent>
            </Card>
          )}

          {/* Pivot Phase 5 (Task #28): Campaigns + Results sections */}
          <BatchCampaignsSection batchId={batchId} />
          <BatchResultsSection batchId={batchId} />
        </div>
      )}

      {/* ══════════════════════════════════════════════
          OFFERS TAB
      ══════════════════════════════════════════════ */}
      {tab === "offers" && (
        <div className="space-y-4">
          {/* Filter pills + add button */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Phase 9a: 4-state offer enum (Bible §7) — imported|tested|winner|loser.
                  "Pending" rolls up imported+tested for the worker (anything not yet classified). */}
              {[
                { value: "all",     label: `All (${totalOffers})` },
                { value: "winner",  label: `Winners (${winnerOffers.length})` },
                { value: "loser",   label: `Losers (${loserOffers.length})` },
                { value: "pending", label: `Pending (${pendingOffers.length})` },
              ].map(f => (
                <button
                  key={f.value}
                  onClick={() => setOfferFilter(f.value)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    offerFilter === f.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {canClassify && pendingOffers.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Bulk:</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
                    onClick={() => markAllPendingAs("winner")}
                    disabled={classify.isPending}
                  >
                    <Trophy size={11} className="mr-1" /> All Winners
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-red-300 text-red-600 hover:bg-red-50"
                    onClick={() => markAllPendingAs("loser")}
                    disabled={classify.isPending}
                  >
                    <ThumbsDown size={11} className="mr-1" /> All Losers
                  </Button>
                </div>
              )}
              {!addingOffer && (
                <Button variant="outline" size="sm" className="h-8" onClick={() => setAddingOffer(true)}>
                  <Plus size={13} className="mr-1.5" /> Add Offer
                </Button>
              )}
            </div>
          </div>

          {/* Add offer input */}
          {addingOffer && (
            <div className="flex gap-2">
              <Input
                placeholder="Offer name (e.g. Offer123 / CreditCard_DE)"
                value={newOfferName}
                onChange={e => setNewOfferName(e.target.value)}
                className="h-9 text-sm"
                onKeyDown={e => {
                  if (e.key === "Enter" && newOfferName.trim())
                    createOffer.mutate({ data: { batchId, offerName: newOfferName.trim() } });
                  if (e.key === "Escape") { setAddingOffer(false); setNewOfferName(""); }
                }}
                autoFocus
              />
              <Button
                size="sm"
                className="h-9"
                disabled={!newOfferName.trim() || createOffer.isPending}
                onClick={() => createOffer.mutate({ data: { batchId, offerName: newOfferName.trim() } })}
              >
                Add
              </Button>
              <Button variant="ghost" size="sm" className="h-9" onClick={() => { setAddingOffer(false); setNewOfferName(""); }}>
                <X size={14} />
              </Button>
            </div>
          )}

          {/* Offers list */}
          <Card className="border border-border shadow-sm">
            <CardContent className="p-0">
              {offersLoading ? (
                <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
              ) : displayOffers.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  {offerFilter === "all" ? (
                    <>
                      <List size={28} className="mx-auto opacity-30 mb-2" />
                      <p>No offers yet.</p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddingOffer(true)}>
                        <Plus size={13} className="mr-1.5" /> Add First Offer
                      </Button>
                    </>
                  ) : (
                    <p>No offers in this view.</p>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_80px_auto_28px] gap-2 px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground">
                    <span>Offer</span>
                    <span>Status</span>
                    {canClassify && <span className="text-center">Classify</span>}
                    <span />
                  </div>
                  {displayOffers.map(offer => {
                    const osc = OFFER_STATUS_CFG[offer.status] ?? { label: offer.status, cls: "bg-gray-100 text-gray-600", activeBtn: "", inactiveBtn: "" };
                    return (
                      <div key={offer.id} className="grid grid-cols-[1fr_80px_auto_28px] gap-2 px-4 py-2.5 hover:bg-muted/20 items-center">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{offer.offerName}</p>
                          {offer.offerId && <p className="text-xs text-muted-foreground">ID: {offer.offerId}</p>}
                        </div>

                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${osc.cls}`}>
                          {osc.label}
                        </span>

                        {canClassify ? (
                          <div className="flex items-center gap-1">
                            {/* Phase 9a: 4-state offer enum — only winner|loser are
                                worker-classifiable terminal states. "retest"/"scaling"
                                were dropped with the legacy 12-state batch machine. */}
                            {(["winner", "loser"] as const).map(s => {
                              const icons: Record<string, React.ElementType> = {
                                winner: Trophy, loser: ThumbsDown,
                              };
                              const titles: Record<string, string> = {
                                winner: "Winner", loser: "Loser",
                              };
                              const Icon = icons[s];
                              const cfg = OFFER_STATUS_CFG[s];
                              const active = offer.status === s;
                              return (
                                <button
                                  key={s}
                                  title={titles[s]}
                                  onClick={() => classify.mutate({ id: offer.id, data: { status: s } })}
                                  className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${active ? cfg.activeBtn : cfg.inactiveBtn}`}
                                >
                                  <Icon size={12} />
                                </button>
                              );
                            })}
                          </div>
                        ) : <div />}

                        <button
                          onClick={() => deleteOffer.mutate({ id: offer.id })}
                          className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Classify hint when optimization is active */}
          {canClassify && pendingOffers.length > 0 && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg border border-amber-200 bg-amber-50">
              <Zap size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                <span className="font-semibold">{pendingOffers.length} offer{pendingOffers.length !== 1 ? "s" : ""} pending classification.</span>
                {" "}Use the classify buttons to mark each as Winner or Loser.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════
          SETUP TAB
      ══════════════════════════════════════════════ */}
      {tab === "setup" && (
        <div className="space-y-4">
          <BatchSetupForm batch={batch} onSaved={() => setTab("overview")} />

          {/* Read-only batch info */}
          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground">Batch Information</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {[
                  { label: "GEO", value: batch.geo },
                  { label: "Number of Offers", value: batch.numberOfOffers ?? "—" },
                  { label: "Created", value: new Date(batch.createdAt).toLocaleDateString() },
                  { label: "Live since", value: batch.liveAt ? new Date(batch.liveAt).toLocaleString() : "—" },
                  ...(VOLUUM_UI_ENABLED
                    ? [
                        { label: "Last Voluum sync", value: batch.lastSyncAt ? new Date(batch.lastSyncAt).toLocaleString() : "—" },
                        { label: "Voluum tag", value: batch.batchTag ?? "—" },
                      ]
                    : []),
                  { label: "Conditions met", value: batch.conditionsMetAt ? new Date(batch.conditionsMetAt).toLocaleString() : "—" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                    <dd className="font-medium text-foreground mt-0.5">{String(value)}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Affiliate Network</dt>
                  <dd className="font-medium text-foreground mt-0.5 flex items-center gap-1.5">
                    {batch.affiliateNetwork}
                    {VOLUUM_UI_ENABLED && !batch.affiliateNetworkVoluumId && <MissingVoluumBadge />}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Traffic Source</dt>
                  <dd className="font-medium text-foreground mt-0.5 flex items-center gap-1.5">
                    {batch.trafficSource}
                    {VOLUUM_UI_ENABLED && !batch.trafficSourceVoluumId && <MissingVoluumBadge />}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs font-medium text-muted-foreground">Related Voluum Campaign</dt>
                  <dd className="font-medium text-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {batch.voluumCampaignName ? (
                      <>
                        <span>{batch.voluumCampaignName}</span>
                        {batch.voluumCampaignId && (
                          <span className="text-xs font-mono text-muted-foreground">({batch.voluumCampaignId})</span>
                        )}
                        <span className="text-[10px] uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          Detected by sync
                        </span>
                      </>
                    ) : campaignMapping?.campaignName ? (
                      <>
                        <span>{campaignMapping.campaignName}</span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          Mapped manually
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground flex items-center gap-1">
                        <MissingVoluumBadge label="No campaign mapped" />
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Pivot Phase 5 (Task #28): Campaigns + Results sections
// Read-only views surfaced on the batch overview tab. Workers
// create/edit campaigns and record results via the per-task-type
// drawer on the Tasks page; this is just the projection.
// ────────────────────────────────────────────────────────────────
function BatchCampaignsSection({ batchId }: { batchId: number }) {
  const { activeWorkspaceId } = useWorkspace();
  const params = { workspace_id: activeWorkspaceId ?? 0, batch_id: batchId };
  const { data: campaigns = [], isLoading } = useListCampaigns(
    params,
    wsQueryOpts(activeWorkspaceId, getListCampaignsQueryKey(params)),
  );
  return (
    <Card className="border border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-muted-foreground">Campaigns</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : campaigns.length === 0 ? (
          <div className="text-sm text-muted-foreground">No campaigns yet. Complete the <em>Create iOS/Android Campaign</em> tasks to add them.</div>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c: Campaign) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{c.platform}</span>
                  <span className="font-medium">{c.campaignName}</span>
                  {c.campaignUrl && (
                    <a href={c.campaignUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">↗</a>
                  )}
                </div>
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold ${
                  c.status === "live" ? "bg-green-100 text-green-700" :
                  c.status === "ready" ? "bg-blue-100 text-blue-700" :
                  c.status === "tested" ? "bg-purple-100 text-purple-700" :
                  c.status === "closed" ? "bg-gray-100 text-gray-600" :
                  "bg-amber-100 text-amber-700"
                }`}>{c.status}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BatchResultsSection({ batchId }: { batchId: number }) {
  const { activeWorkspaceId } = useWorkspace();
  const params = { workspace_id: activeWorkspaceId ?? 0, batch_id: batchId };
  const { data: results = [], isLoading } = useListBatchResults(
    params,
    wsQueryOpts(activeWorkspaceId, getListBatchResultsQueryKey(params)),
  );
  return (
    <Card className="border border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-muted-foreground">Results</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : results.length === 0 ? (
          <div className="text-sm text-muted-foreground">No results recorded yet. Complete the <em>Optimization Follow-Up</em> task to record them.</div>
        ) : (
          <div className="space-y-3">
            {results.map((r: BatchResult) => (
              <div key={r.id} className="rounded-md border border-border bg-background p-3">
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-sm">
                  <div><div className="text-[10px] uppercase text-muted-foreground">Clicks</div><div className="font-semibold">{r.clicks.toLocaleString()}</div></div>
                  <div><div className="text-[10px] uppercase text-muted-foreground">Cost</div><div className="font-semibold">${r.cost}</div></div>
                  <div><div className="text-[10px] uppercase text-muted-foreground">Revenue</div><div className="font-semibold">${r.revenue}</div></div>
                  <div><div className="text-[10px] uppercase text-muted-foreground">Conversions</div><div className="font-semibold">{r.conversions}</div></div>
                  <div><div className="text-[10px] uppercase text-muted-foreground">ROI</div><div className="font-semibold">{r.roi != null ? `${r.roi}%` : "—"}</div></div>
                  <div><div className="text-[10px] uppercase text-muted-foreground">Winners</div><div className="font-semibold">{r.winnersCount}</div></div>
                </div>
                {r.notes && <div className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{r.notes}</div>}
                <div className="mt-1.5 text-[10px] text-muted-foreground">Recorded {new Date(r.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
