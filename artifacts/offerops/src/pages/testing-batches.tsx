import { useEffect, useState } from "react";
import { wsQueryOpts } from "@/lib/ws-query";
import {
  useListTestingBatches,
  useCreateTestingBatch,
  useListVoluumMappings,
  useListAffiliateNetworks,
  useListGeos,
  useListWorkspaceTrafficSources,
  useListEmployees,
  useListTodoTasks,
  getListTestingBatchesQueryKey,
  getListVoluumMappingsQueryKey,
  getListAffiliateNetworksQueryKey,
  getListGeosQueryKey,
  getListWorkspaceTrafficSourcesQueryKey,
  getListEmployeesQueryKey,
  getListTodoTasksQueryKey,
  CreateTestingBatchBodyStatus,
} from "@workspace/api-client-react";
import { MissingVoluumBadge } from "@/components/voluum-entity-select";
import { VOLUUM_UI_ENABLED } from "@/lib/feature-flags";
import { useWorkspace } from "@/lib/workspace-context";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { authedFetch } from "@/lib/api-fetch";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { invalidateGoalSurfaces } from "@/lib/performance-engine/invalidate-goal-surfaces";
import {
  Plus, ChevronRight, Radio, Zap, CheckCircle2, RefreshCw,
  TrendingUp, Circle, Target, Link2, Clock, AlertCircle,
} from "lucide-react";

// Phase 9d: status config + ordering moved to shared helper so badges
// stay consistent across testing-batches, testing-batch-detail,
// tracker-campaigns and ops-queue.
import {
  BATCH_STATUS_FILTERS,
  batchStatusConfig,
  batchStatusSortKey,
} from "@/lib/batch-status";

function StatusBadge({ status }: { status: string }) {
  const cfg = batchStatusConfig(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.text} ${cfg.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.short}
    </span>
  );
}

/**
 * Step indicator: "step N of 6". Matches user pref for at-a-glance
 * lifecycle progress in the worker batches list.
 */
function StatusStep({ status }: { status: string }) {
  const cfg = batchStatusConfig(status);
  if (cfg.step === 0) return null;
  return (
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">
      Step {cfg.step}/6
    </span>
  );
}

function autoName(network: string, geo: string, count: string): string {
  if (!network || !geo) return "";
  const date = new Date();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(2);
  const countPart = count ? ` [${count} Offers]` : "";
  return `${network} - ${geo.toUpperCase()} - ${mm}/${dd}/${yy}${countPart}`;
}

// ────────────────────────────────────────────────────────────────
// Pivot Phase 3 (Task #26): manual batch creation form. All Voluum
// gating dropped — the form now uses the workspace-scoped lookups
// from Phase 2 (affiliate_networks, geos) plus the workspace traffic
// sources, and writes to the new POST /testing-batches contract.
// ────────────────────────────────────────────────────────────────

interface CreateBatchForm {
  batchTag: string;
  affiliateNetworkId: string;
  geoId: string;
  trafficSourceId: string;
  numberOfOffers: string;
  testRound: string;
  assignedWorkerId: string;
  startDate: string;
  status: string;
  notes: string;
}

const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "NEW_BATCH",                   label: "New batch" },
  { value: "WAITING_FOR_TRACKER_CAMPAIGNS", label: "Waiting for tracker campaigns" },
  { value: "OFFER_READY_FOR_LIVE_TESTING",  label: "Offer ready for live testing" },
  { value: "LIVE_TESTS",                  label: "Live tests" },
  { value: "TESTED",                      label: "Tested" },
  { value: "COMPLETED",                   label: "Completed" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

function makeEmptyForm(currentEmployeeId: number | undefined): CreateBatchForm {
  return {
    batchTag: "",
    affiliateNetworkId: "",
    geoId: "",
    trafficSourceId: "",
    numberOfOffers: "250",
    testRound: "1",
    assignedWorkerId: currentEmployeeId ? String(currentEmployeeId) : "",
    startDate: todayIso(),
    status: "NEW_BATCH",
    notes: "",
  };
}

function CreateBatchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateBatchForm>(() => makeEmptyForm(currentEmployee?.id));

  // Reset whenever the workspace switches — lookup IDs are
  // workspace-scoped and would dangle.
  useEffect(() => {
    setForm(makeEmptyForm(currentEmployee?.id));
  }, [activeWorkspaceId, currentEmployee?.id]);

  const lookupParams = { workspace_id: activeWorkspaceId ?? 0 };
  const enabled = !!activeWorkspaceId;

  const { data: affiliateNetworksAll = [], isLoading: anLoading } = useListAffiliateNetworks(
    lookupParams,
    wsQueryOpts(activeWorkspaceId, getListAffiliateNetworksQueryKey(lookupParams), { enabled }),
  );

  // CampaignOps: workers are restricted to networks an admin assigned them
  // via Settings → Worker Networks. Admins can pick any active network.
  const isAdmin = currentEmployee?.role === "admin";
  const [allowedNetworkIds, setAllowedNetworkIds] = useState<Set<number> | null>(null);
  useEffect(() => {
    if (!enabled || isAdmin || !currentEmployee?.id) {
      setAllowedNetworkIds(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/worker-affiliate-networks?workspace_id=${activeWorkspaceId}&employee_id=${currentEmployee.id}`;
        const r = await authedFetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const rows = (await r.json()) as Array<{ affiliateNetworkId: number }>;
        if (!cancelled) setAllowedNetworkIds(new Set(rows.map((x) => x.affiliateNetworkId)));
      } catch {
        if (!cancelled) setAllowedNetworkIds(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, isAdmin, currentEmployee?.id, activeWorkspaceId]);

  const affiliateNetworks = isAdmin || allowedNetworkIds === null
    ? affiliateNetworksAll
    : affiliateNetworksAll.filter((n) => allowedNetworkIds.has(n.id));
  const { data: geos = [], isLoading: geoLoading } = useListGeos(
    lookupParams,
    wsQueryOpts(activeWorkspaceId, getListGeosQueryKey(lookupParams), { enabled }),
  );
  const { data: trafficSources = [], isLoading: tsLoading } = useListWorkspaceTrafficSources(
    lookupParams,
    wsQueryOpts(activeWorkspaceId, getListWorkspaceTrafficSourcesQueryKey(lookupParams), { enabled }),
  );
  const empParams = activeWorkspaceId ? { workspace_id: activeWorkspaceId } : undefined;
  const { data: employees = [] } = useListEmployees(
    empParams,
    { query: { queryKey: getListEmployeesQueryKey(empParams), enabled, staleTime: 60_000 } },
  );

  const create = useCreateTestingBatch({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTestingBatchesQueryKey({ workspace_id: activeWorkspaceId ?? 0 }) });
        if (activeWorkspaceId) {
          invalidateGoalSurfaces(qc, activeWorkspaceId);
        }
        toast({ title: "Batch created", description: "It's now visible in the Batches list." });
        onClose();
        setForm(makeEmptyForm(currentEmployee?.id));
      },
      onError: (e: unknown) => toast({ title: "Failed to create batch", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
    },
  });

  const selectedNetwork = affiliateNetworks.find(n => String(n.id) === form.affiliateNetworkId);
  const selectedGeo = geos.find(g => String(g.id) === form.geoId);
  const batchName = autoName(
    selectedNetwork?.name ?? "",
    selectedGeo?.code ?? "",
    form.numberOfOffers,
  );

  const canSubmit = !!(
    activeWorkspaceId &&
    form.batchTag.trim() &&
    form.affiliateNetworkId &&
    form.geoId &&
    form.trafficSourceId &&
    form.assignedWorkerId &&
    batchName
  );

  function submit() {
    if (!canSubmit || !activeWorkspaceId) {
      if (!activeWorkspaceId) {
        toast({
          title: "Pick a workspace first",
          description: "Use the workspace switcher in the sidebar before creating a batch.",
          variant: "destructive",
        });
      }
      return;
    }
    create.mutate({
      data: {
        workspaceId: activeWorkspaceId,
        batchName,
        batchTag: form.batchTag.trim(),
        affiliateNetworkId: Number(form.affiliateNetworkId),
        geoId: Number(form.geoId),
        trafficSourceId: Number(form.trafficSourceId),
        assignedWorkerId: Number(form.assignedWorkerId),
        numberOfOffers: form.numberOfOffers ? Number(form.numberOfOffers) : null,
        testRound: form.testRound ? Number(form.testRound) : null,
        startDate: form.startDate || null,
        status: form.status as CreateTestingBatchBodyStatus,
        notes: form.notes || null,
      },
    });
  }

  const setField = <K extends keyof CreateBatchForm>(key: K, value: CreateBatchForm[K]) =>
    setForm(p => ({ ...p, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">New Testing Batch</DialogTitle>
        </DialogHeader>

        {!activeWorkspaceId ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5">
            <p className="text-xs font-semibold text-destructive">No workspace selected</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pick a workspace in the sidebar before creating a batch.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-muted bg-muted/30 px-4 py-1.5">
            <p className="text-[11px] text-muted-foreground">
              This batch will be created in workspace #{activeWorkspaceId}.
            </p>
          </div>
        )}

        {batchName && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
            <p className="text-xs text-muted-foreground mb-0.5">Batch name (auto-generated)</p>
            <p className="font-semibold text-foreground text-sm">{batchName}</p>
          </div>
        )}

        <div className="space-y-4 mt-1">
          <div>
            <Label htmlFor="batchTag" className="text-xs font-medium">Batch Tag *</Label>
            <Input
              id="batchTag"
              placeholder="sl_de_batch1"
              className="mt-1 h-9 font-mono"
              value={form.batchTag}
              onChange={e => setField("batchTag", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium">Affiliate Network *</Label>
              <Select value={form.affiliateNetworkId} onValueChange={v => setField("affiliateNetworkId", v)}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder={anLoading ? "Loading…" : "Select network…"} />
                </SelectTrigger>
                <SelectContent>
                  {affiliateNetworks.filter(n => n.isActive !== false).map(n => (
                    <SelectItem key={n.id} value={String(n.id)}>{n.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium">GEO / Country *</Label>
              <Select value={form.geoId} onValueChange={v => setField("geoId", v)}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder={geoLoading ? "Loading…" : "Select GEO…"} />
                </SelectTrigger>
                <SelectContent>
                  {geos.filter(g => g.isActive !== false).map(g => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.code}{g.name ? ` — ${g.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium">Traffic Source *</Label>
            <Select value={form.trafficSourceId} onValueChange={v => setField("trafficSourceId", v)}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder={tsLoading ? "Loading…" : "Select source…"} />
              </SelectTrigger>
              <SelectContent>
                {trafficSources.filter(s => s.isActive !== false).map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="offers" className="text-xs font-medium">Number of Offers</Label>
              <Input
                id="offers" type="number" placeholder="250" className="mt-1 h-9"
                value={form.numberOfOffers}
                onChange={e => setField("numberOfOffers", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="round" className="text-xs font-medium">Test Round</Label>
              <Input
                id="round" type="number" min={1} placeholder="1" className="mt-1 h-9"
                value={form.testRound}
                onChange={e => setField("testRound", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium">Assigned Worker *</Label>
              <Select value={form.assignedWorkerId} onValueChange={v => setField("assignedWorkerId", v)}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Pick a worker…" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map(e => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.name}{e.role === "admin" ? " (admin)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="startDate" className="text-xs font-medium">Start Date</Label>
              <Input
                id="startDate" type="date" className="mt-1 h-9"
                value={form.startDate}
                onChange={e => setField("startDate", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium">Status</Label>
              <Select value={form.status} onValueChange={v => setField("status", v)}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="notes" className="text-xs font-medium">Notes</Label>
              <Input
                id="notes" placeholder="Optional notes…" className="mt-1 h-9"
                value={form.notes}
                onChange={e => setField("notes", e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
          <Button
            onClick={submit}
            disabled={!canSubmit || create.isPending}
            size="sm"
          >
            {create.isPending ? "Creating…" : "Create Batch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_FILTERS = BATCH_STATUS_FILTERS;

export default function TestingBatches() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [, navigate] = useLocation();
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId: wsId } = useWorkspace();

  const batchListParams = currentEmployee?.role === "admin"
    ? (statusFilter !== "all" ? { status: statusFilter, workspace_id: wsId ?? 0 } : { workspace_id: wsId ?? 0 })
    : (statusFilter !== "all"
        ? { status: statusFilter, employee_id: currentEmployee?.id, workspace_id: wsId ?? 0 }
        : { employee_id: currentEmployee?.id, workspace_id: wsId ?? 0 });
  const mappingsParams = { workspace_id: wsId ?? 0 };
  const { data: batches, isLoading } = useListTestingBatches(
    batchListParams,
    wsQueryOpts(wsId, getListTestingBatchesQueryKey(batchListParams)),
  );

  const { data: mappings } = useListVoluumMappings(
    mappingsParams,
    wsQueryOpts(wsId, getListVoluumMappingsQueryKey(mappingsParams), { enabled: VOLUUM_UI_ENABLED && !!wsId }),
  );
  // Build a set of batchIds that have a Voluum mapping
  const mappedBatchIds = new Set((mappings ?? []).map(m => m.batchId));

  // Phase 9 (was Phase-3 fan-out): per-batch tracker-campaign progress.
  // Counts the auto-emitted create_voluum_campaign_ios +
  // create_voluum_campaign_android tasks for each batch, treating DONE
  // as the completion state (was legacy "completed" pre-Phase-2). We
  // fetch ios + android in parallel rather than ALL tasks to keep the
  // payload small, and sum them client-side.
  const iosTasksParams = { workspace_id: wsId ?? 0, task_type: "create_voluum_campaign_ios" as const };
  const andTasksParams = { workspace_id: wsId ?? 0, task_type: "create_voluum_campaign_android" as const };
  const { data: iosTasks } = useListTodoTasks(
    iosTasksParams,
    wsQueryOpts(wsId, getListTodoTasksQueryKey(iosTasksParams)),
  );
  const { data: andTasks } = useListTodoTasks(
    andTasksParams,
    wsQueryOpts(wsId, getListTodoTasksQueryKey(andTasksParams)),
  );
  const taskProgressByBatch = new Map<number, { total: number; done: number }>();
  for (const t of [...(iosTasks ?? []), ...(andTasks ?? [])]) {
    if (t.relatedBatchId == null) continue;
    const cur = taskProgressByBatch.get(t.relatedBatchId) ?? { total: 0, done: 0 };
    cur.total++;
    if (t.status === "DONE") cur.done++;
    taskProgressByBatch.set(t.relatedBatchId, cur);
  }

  const filtered = (batches ?? []).filter(b => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      b.batchName.toLowerCase().includes(q) ||
      b.affiliateNetwork.toLowerCase().includes(q) ||
      b.geo.toLowerCase().includes(q) ||
      b.trafficSource.toLowerCase().includes(q)
    );
  });

  // Sort: action-required statuses first (OFFER_READY_FOR_LIVE_TESTING + TESTED)
  const sorted = [...filtered].sort((a, b) => batchStatusSortKey(a.status) - batchStatusSortKey(b.status));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Batches</h1>
          <p className="text-muted-foreground text-sm mt-0.5">All offer batches and their test status.</p>
        </div>
        {/* Pivot Phase 3 (Task #26): manual batch creation is open to
            both admins and workers. The legacy auto-flow under /admin is
            superseded by the manual lookup-driven flow. */}
        <Button
          onClick={() => setShowCreate(true)}
          disabled={!wsId}
          title={!wsId ? "Pick a workspace in the sidebar first" : undefined}
        >
          <Plus size={15} className="mr-1.5" /> New Batch
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Input
            placeholder="Search batches…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 w-52 pl-8 text-sm"
          />
          <svg className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                statusFilter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_120px_80px_140px_160px_130px_44px] gap-0 px-4 py-2.5 border-b border-border bg-muted/40">
          {["Batch", "Network", "GEO", "Traffic Source", "Status", "Progress", ""].map(h => (
            <div key={h} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</div>
          ))}
        </div>

        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-16 text-center">
            <Target size={32} className="mx-auto text-muted-foreground opacity-40 mb-3" />
            <p className="text-muted-foreground font-medium">No batches found</p>
            <p className="text-muted-foreground text-sm mt-1">
              {search ? "Try a different search term." : "Create your first batch to get started."}
            </p>
            {!search && (
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowCreate(true)} disabled={!wsId}>
                <Plus size={14} className="mr-1.5" /> Create Batch
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sorted.map(batch => {
              const campaignName = batch.voluumCampaignName ?? null;
              const hasCampaign = !!campaignName || mappedBatchIds.has(batch.id);
              const hasThreshold = batch.clicksThreshold && batch.clicksThreshold > 0;

              return (
                <div
                  key={batch.id}
                  className="grid grid-cols-[1fr_120px_80px_140px_160px_130px_44px] gap-0 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors items-center"
                  onClick={() => navigate(`/testing-batches/${batch.id}`)}
                >
                  {/* Name */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{batch.batchName}</p>
                      {batch.batchTag && (
                        <span
                          title={`Voluum tag: ${batch.batchTag}`}
                          className="flex-shrink-0 text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                        >
                          {batch.batchTag}
                        </span>
                      )}
                      {VOLUUM_UI_ENABLED && hasCampaign && (
                        <span
                          title={campaignName ? `Inside Voluum campaign: ${campaignName}` : "Voluum campaign linked"}
                          className="flex items-center gap-1 flex-shrink-0 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded"
                        >
                          <Link2 size={10} />
                          <span className="truncate max-w-[140px]">{campaignName ?? "Linked"}</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs font-medium text-foreground" title="Assigned worker">
                        {batch.employeeName ?? "—"}
                      </span>
                      {batch.testRound != null && (
                        <span className="text-xs text-muted-foreground" title="Test round">
                          · Round {batch.testRound}
                        </span>
                      )}
                      {batch.startDate && (
                        <span className="text-xs text-muted-foreground" title="Scheduled start date">
                          · Start {new Date(batch.startDate).toLocaleDateString()}
                        </span>
                      )}
                      {batch.numberOfOffers != null && (
                        <span className="text-xs text-muted-foreground">· {batch.numberOfOffers} offers</span>
                      )}
                      <span
                        className="text-xs text-muted-foreground"
                        title={`Created ${new Date(batch.createdAt).toLocaleString()}`}
                      >
                        · Created {new Date(batch.createdAt).toLocaleDateString()}
                      </span>
                      {VOLUUM_UI_ENABLED && batch.lastSyncAt && (
                        <span
                          className="flex items-center gap-0.5 text-xs text-muted-foreground"
                          title={`Last Voluum sync ${new Date(batch.lastSyncAt).toLocaleString()}`}
                        >
                          <Clock size={10} /> Synced {new Date(batch.lastSyncAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Network */}
                  <div>
                    <div className="text-sm text-foreground font-medium truncate">{batch.affiliateNetwork}</div>
                    {VOLUUM_UI_ENABLED && !batch.affiliateNetworkVoluumId && (
                      <MissingVoluumBadge />
                    )}
                  </div>

                  {/* GEO */}
                  <div className="text-sm font-bold text-foreground">{batch.geo}</div>

                  {/* Traffic Source */}
                  <div>
                    <div className="text-sm text-foreground truncate">{batch.trafficSource}</div>
                    {VOLUUM_UI_ENABLED && !batch.trafficSourceVoluumId && (
                      <MissingVoluumBadge />
                    )}
                  </div>

                  {/* Status + step indicator */}
                  <div className="space-y-1">
                    <StatusBadge status={batch.status} />
                    <StatusStep status={batch.status} />
                  </div>

                  {/* Progress: test campaigns created (and click threshold target) */}
                  <div>
                    {(() => {
                      const prog = taskProgressByBatch.get(batch.id);
                      if (prog && prog.total > 0) {
                        const pct = Math.round((prog.done / prog.total) * 100);
                        return (
                          <div className="space-y-0.5">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{prog.done} / {prog.total} test campaigns</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden w-24">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      }
                      if (hasThreshold) {
                        return (
                          <div className="space-y-0.5">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Target: {Number(batch.clicksThreshold).toLocaleString()}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden w-24">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: "0%" }}
                              />
                            </div>
                          </div>
                        );
                      }
                      return <span className="text-xs text-muted-foreground">—</span>;
                    })()}
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-end">
                    <ChevronRight size={15} className="text-muted-foreground" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {sorted.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          {sorted.length} batch{sorted.length !== 1 ? "es" : ""}
          {statusFilter !== "all" && ` · filtered by "${STATUS_FILTERS.find(f => f.value === statusFilter)?.label}"`}
        </p>
      )}

      <CreateBatchModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
