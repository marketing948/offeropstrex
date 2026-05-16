import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAffiliateNetworks,
  useCreateAffiliateNetwork,
  useUpdateAffiliateNetwork,
  useDeleteAffiliateNetwork,
  getListAffiliateNetworksQueryKey,
  useListGeos,
  useCreateGeo,
  useUpdateGeo,
  useDeleteGeo,
  getListGeosQueryKey,
  useListVoluumMappings,
  useCreateVoluumMapping,
  useDeleteVoluumMapping,
  useListVoluumWorkspaces,
  useCreateVoluumWorkspace,
  useUpdateVoluumWorkspace,
  useDeleteVoluumWorkspace,
  useSyncVoluumWorkspace,
  useTestVoluumWorkspaceMetadata,
  useSetActiveVoluumWorkspace,
  useListVoluumTrafficSources,
  useListVoluumAffiliateNetworks,
  useListWorkspaceTrafficSources,
  useCreateWorkspaceTrafficSource,
  useUpdateWorkspaceTrafficSource,
  useDeleteWorkspaceTrafficSource,
  useReorderWorkspaceTrafficSources,
  getListWorkspaceTrafficSourcesQueryKey,
  useGetTrafficSourceDevicePlan,
  usePutTrafficSourceDevicePlan,
  getGetTrafficSourceDevicePlanQueryKey,
  getListVoluumTrafficSourcesQueryKey,
  getListVoluumWorkspacesQueryKey,
  getListVoluumMappingsQueryKey,
  useListEmployees,
  useListWorkspaceMembers,
  getListEmployeesQueryKey,
  useAddWorkspaceMember,
  useRemoveWorkspaceMember,
  getListWorkspaceMembersQueryKey,
  useListTestingBatches,
  useListSyncedVoluumCampaigns,
  useListSyncedVoluumOffers,
  useAssignVoluumOfferToBatch,
  useAutoGroupVoluumOffers,
  getListSyncedVoluumCampaignsQueryKey,
  getListSyncedVoluumOffersQueryKey,
} from "@workspace/api-client-react";
import type { VoluumWorkspace, VoluumMetadataTestResult, WorkspaceMember, VoluumTrafficSource, AffiliateNetwork, Geo, WorkspaceTrafficSource } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Settings2,
  Trash2,
  Zap,
  Link2,
  Database,
  Clock,
  SlidersHorizontal,
  Building2,
  Plus,
  Wifi,
  WifiOff,
  Network,
  ChevronDown,
  ChevronRight,
  Users,
  UserMinus,
  UserPlus,
  Globe,
  Pencil,
  ArrowUp,
  ArrowDown,
  Radio,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/lib/workspace-context";
import AdminGoalsConfig from "@/pages/admin-goals-config";
import { useQuery, useMutation } from "@tanstack/react-query";
import { authedFetch, authedJson } from "@/lib/api-fetch";

type SettingsTab = "goal-engine" | "affiliate-networks" | "worker-networks" | "traffic-sources" | "geos" | "workspace";

// Pivot Phase 0 — Voluum disabled. The legacy Workspace tab (Voluum
// credentials/sync/mappings) is hidden until automation comes back.
// Pivot Phase 2 (Task #25) — added Affiliate Networks and GEOs tabs
// for the manual workflow's lookup data.
const TABS: { id: SettingsTab; label: string; icon: React.ReactNode; description: string }[] = [
  {
    id: "goal-engine",
    label: "Goal Engine",
    icon: <SlidersHorizontal size={15} />,
    description: "Scoring rules, ranks, bonuses, and KPI targets",
  },
  {
    id: "affiliate-networks",
    label: "Affiliate Networks",
    icon: <Network size={15} />,
    description: "Manual list of affiliate networks for batch creation",
  },
  {
    id: "worker-networks",
    label: "Worker Networks",
    icon: <Network size={15} />,
    description: "Restrict workers to a subset of affiliate networks",
  },
  {
    id: "traffic-sources",
    label: "Traffic Sources",
    icon: <Radio size={15} />,
    description: "Workspace traffic source rotation for batch creation",
  },
  {
    id: "geos",
    label: "GEOs",
    icon: <Globe size={15} />,
    description: "Manual list of countries / GEOs",
  },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("goal-engine");

  return (
    <div className="max-w-6xl">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage integrations, scoring engine, and workspace configuration.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "goal-engine" && (
        <div className="-mx-0">
          <AdminGoalsConfig embedded />
        </div>
      )}
      {activeTab === "affiliate-networks" && <AffiliateNetworksTab />}
      {activeTab === "worker-networks" && <WorkerNetworksTab />}
      {activeTab === "traffic-sources" && <TrafficSourcesTab />}
      {activeTab === "geos" && <GeosTab />}
      {activeTab === "workspace" && <WorkspaceTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Pivot Phase 2 (Task #25) — Affiliate Networks & GEOs tabs
// ─────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "Unknown error";
}

function AffiliateNetworksTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeWorkspaceId } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<AffiliateNetwork | null>(null);
  const [editName, setEditName] = useState("");

  const { data: rows, isLoading } = useListAffiliateNetworks(
    { workspace_id: wsId },
    { query: { enabled: !!wsId, queryKey: getListAffiliateNetworksQueryKey({ workspace_id: wsId }) } },
  );

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListAffiliateNetworksQueryKey({ workspace_id: wsId }) });
  }

  const createMutation = useCreateAffiliateNetwork({
    mutation: {
      onSuccess: () => { invalidate(); setName(""); toast({ title: "Affiliate network added" }); },
      onError: (err) => toast({ title: "Failed to add", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateAffiliateNetwork({
    mutation: {
      onSuccess: () => { invalidate(); setEditing(null); toast({ title: "Updated" }); },
      onError: (err) => toast({ title: "Failed to update", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteAffiliateNetwork({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Deleted" }); },
      onError: (err) => toast({ title: "Failed to delete", description: errorMessage(err) ?? "In use?", variant: "destructive" }),
    },
  });

  function handleAdd() {
    if (!name.trim() || !wsId) return;
    createMutation.mutate({ data: { workspaceId: wsId, name: name.trim() } });
  }

  function handleSaveEdit() {
    if (!editing || !editName.trim()) return;
    updateMutation.mutate({ id: editing.id, data: { name: editName.trim() } });
  }

  function handleToggleActive(row: AffiliateNetwork) {
    updateMutation.mutate({ id: row.id, data: { isActive: !row.isActive } });
  }

  if (!wsId) {
    return <p className="text-sm text-muted-foreground">Select a workspace to manage affiliate networks.</p>;
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Network size={16} /> Affiliate Networks</CardTitle>
          <CardDescription>Admin-managed list. Used as the source of truth for batch creation dropdowns.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Adsterra"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              data-testid="input-affiliate-network-name"
            />
            <Button onClick={handleAdd} disabled={!name.trim() || createMutation.isPending} data-testid="button-add-affiliate-network">
              <Plus size={14} className="mr-1" /> Add
            </Button>
          </div>

          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !rows || rows.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No affiliate networks yet — add one above.</p>
          ) : (
            <div className="border rounded-md divide-y">
              {(rows as AffiliateNetwork[]).map(row => (
                <div key={row.id} className="flex items-center gap-3 px-3 py-2" data-testid={`row-affiliate-network-${row.id}`}>
                  <span className="flex-1 text-sm font-medium">{row.name}</span>
                  <Badge variant={row.isActive ? "default" : "outline"} className="text-[10px]">
                    {row.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => handleToggleActive(row)} disabled={updateMutation.isPending}>
                    {row.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(row); setEditName(row.name); }}>
                    <Pencil size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => {
                    if (confirm(`Delete "${row.name}"?`)) deleteMutation.mutate({ id: row.id });
                  }}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={v => { if (!v) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Affiliate Network</DialogTitle></DialogHeader>
          <div className="py-2">
            <Label className="text-xs font-medium">Name</Label>
            <Input className="mt-1" value={editName} onChange={e => setEditName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={!editName.trim() || updateMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TrafficSourcesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeWorkspaceId } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<WorkspaceTrafficSource | null>(null);
  const [editName, setEditName] = useState("");

  const { data: rows, isLoading } = useListWorkspaceTrafficSources(
    { workspace_id: wsId },
    { query: { enabled: !!wsId, queryKey: getListWorkspaceTrafficSourcesQueryKey({ workspace_id: wsId }) } },
  );

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListWorkspaceTrafficSourcesQueryKey({ workspace_id: wsId }) });
  }

  const createMutation = useCreateWorkspaceTrafficSource({
    mutation: {
      onSuccess: () => { invalidate(); setName(""); toast({ title: "Traffic source added" }); },
      onError: (err) => toast({ title: "Failed to add", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateWorkspaceTrafficSource({
    mutation: {
      onSuccess: () => { invalidate(); setEditing(null); toast({ title: "Updated" }); },
      onError: (err) => toast({ title: "Failed to update", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteWorkspaceTrafficSource({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Deleted" }); },
      onError: (err) => toast({ title: "Failed to delete", description: errorMessage(err) ?? "In use?", variant: "destructive" }),
    },
  });

  const reorderMutation = useReorderWorkspaceTrafficSources({
    mutation: {
      onSuccess: () => { invalidate(); },
      onError: (err) => { invalidate(); toast({ title: "Failed to reorder", description: errorMessage(err), variant: "destructive" }); },
    },
  });

  function handleAdd() {
    if (!name.trim() || !wsId) return;
    createMutation.mutate({ data: { workspaceId: wsId, name: name.trim() } });
  }

  function handleSaveEdit() {
    if (!editing || !editName.trim()) return;
    updateMutation.mutate({ id: editing.id, data: { name: editName.trim() } });
  }

  function handleToggleActive(row: WorkspaceTrafficSource) {
    updateMutation.mutate({ id: row.id, data: { isActive: !row.isActive } });
  }

  function handleMove(index: number, direction: -1 | 1) {
    if (!rows) return;
    const list = [...(rows as WorkspaceTrafficSource[])];
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    reorderMutation.mutate({ data: { workspaceId: wsId, orderedIds: list.map(r => r.id) } });
  }

  if (!wsId) {
    return <p className="text-sm text-muted-foreground">Select a workspace to manage traffic sources.</p>;
  }

  const sourcesList = (rows ?? []) as WorkspaceTrafficSource[];

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Radio size={16} /> Traffic Sources</CardTitle>
          <CardDescription>Workspace rotation. Order here controls the order in batch creation dropdowns.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="e.g. PropellerAds"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              data-testid="input-traffic-source-name"
            />
            <Button onClick={handleAdd} disabled={!name.trim() || createMutation.isPending} data-testid="button-add-traffic-source">
              <Plus size={14} className="mr-1" /> Add
            </Button>
          </div>

          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : sourcesList.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No traffic sources yet — add one above.</p>
          ) : (
            <div className="border rounded-md divide-y">
              {sourcesList.map((row, idx) => (
                <div key={row.id} className="flex items-center gap-2 px-3 py-2" data-testid={`row-traffic-source-${row.id}`}>
                  <div className="flex flex-col">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0"
                      disabled={idx === 0 || reorderMutation.isPending}
                      onClick={() => handleMove(idx, -1)}
                      data-testid={`button-move-up-${row.id}`}
                    >
                      <ArrowUp size={12} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0"
                      disabled={idx === sourcesList.length - 1 || reorderMutation.isPending}
                      onClick={() => handleMove(idx, 1)}
                      data-testid={`button-move-down-${row.id}`}
                    >
                      <ArrowDown size={12} />
                    </Button>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono w-6 text-right">{row.position}</span>
                  <span className="flex-1 text-sm font-medium">{row.name}</span>
                  <Badge variant={row.isActive ? "default" : "outline"} className="text-[10px]">
                    {row.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => handleToggleActive(row)} disabled={updateMutation.isPending}>
                    {row.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(row); setEditName(row.name); }}>
                    <Pencil size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => {
                    if (confirm(`Delete "${row.name}"?`)) deleteMutation.mutate({ id: row.id });
                  }}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={v => { if (!v) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Traffic Source</DialogTitle></DialogHeader>
          <div className="py-2">
            <Label className="text-xs font-medium">Name</Label>
            <Input className="mt-1" value={editName} onChange={e => setEditName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={!editName.trim() || updateMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GeosTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeWorkspaceId } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Geo | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");

  const { data: rows, isLoading } = useListGeos(
    { workspace_id: wsId },
    { query: { enabled: !!wsId, queryKey: getListGeosQueryKey({ workspace_id: wsId }) } },
  );

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListGeosQueryKey({ workspace_id: wsId }) });
  }

  const createMutation = useCreateGeo({
    mutation: {
      onSuccess: () => { invalidate(); setCode(""); setName(""); toast({ title: "GEO added" }); },
      onError: (err) => toast({ title: "Failed to add", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateGeo({
    mutation: {
      onSuccess: () => { invalidate(); setEditing(null); toast({ title: "Updated" }); },
      onError: (err) => toast({ title: "Failed to update", description: errorMessage(err), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteGeo({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Deleted" }); },
      onError: (err) => toast({ title: "Failed to delete", description: errorMessage(err) ?? "In use?", variant: "destructive" }),
    },
  });

  function handleAdd() {
    if (!code.trim() || !name.trim() || !wsId) return;
    createMutation.mutate({ data: { workspaceId: wsId, code: code.trim().toUpperCase(), name: name.trim() } });
  }

  function handleSaveEdit() {
    if (!editing || !editCode.trim() || !editName.trim()) return;
    updateMutation.mutate({ id: editing.id, data: { code: editCode.trim().toUpperCase(), name: editName.trim() } });
  }

  function handleToggleActive(row: Geo) {
    updateMutation.mutate({ id: row.id, data: { isActive: !row.isActive } });
  }

  if (!wsId) {
    return <p className="text-sm text-muted-foreground">Select a workspace to manage GEOs.</p>;
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Globe size={16} /> GEOs</CardTitle>
          <CardDescription>Country / region lookup. Code is the canonical 2-3 letter code (e.g. DE, US, GB).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              className="w-24 font-mono"
              placeholder="DE"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              maxLength={3}
              data-testid="input-geo-code"
            />
            <Input
              placeholder="Germany"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              data-testid="input-geo-name"
            />
            <Button onClick={handleAdd} disabled={!code.trim() || !name.trim() || createMutation.isPending} data-testid="button-add-geo">
              <Plus size={14} className="mr-1" /> Add
            </Button>
          </div>

          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !rows || rows.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No GEOs yet — add one above.</p>
          ) : (
            <div className="border rounded-md divide-y">
              {(rows as Geo[]).map(row => (
                <div key={row.id} className="flex items-center gap-3 px-3 py-2" data-testid={`row-geo-${row.id}`}>
                  <code className="text-xs font-semibold bg-muted px-1.5 py-0.5 rounded">{row.code}</code>
                  <span className="flex-1 text-sm">{row.name}</span>
                  <Badge variant={row.isActive ? "default" : "outline"} className="text-[10px]">
                    {row.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => handleToggleActive(row)} disabled={updateMutation.isPending}>
                    {row.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(row); setEditCode(row.code); setEditName(row.name); }}>
                    <Pencil size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => {
                    if (confirm(`Delete "${row.code} — ${row.name}"?`)) deleteMutation.mutate({ id: row.id });
                  }}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={v => { if (!v) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit GEO</DialogTitle></DialogHeader>
          <div className="py-2 space-y-3">
            <div>
              <Label className="text-xs font-medium">Code</Label>
              <Input className="mt-1 font-mono w-32" value={editCode} onChange={e => setEditCode(e.target.value.toUpperCase())} maxLength={3} />
            </div>
            <div>
              <Label className="text-xs font-medium">Name</Label>
              <Input className="mt-1" value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={!editCode.trim() || !editName.trim() || updateMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Workspace Tab
// ─────────────────────────────────────────────────────────────────

const SYNC_INTERVAL_LABELS: Record<string, string> = {
  manual: "Manual only",
  "5min": "Every 5 minutes",
  "15min": "Every 15 minutes",
  hourly: "Hourly",
};

function WorkspaceFormDialog({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Partial<VoluumWorkspace>;
  onSave: (data: {
    name: string;
    description: string;
    voluumAccessId: string;
    voluumAccessKey: string;
    voluumApiBaseUrl: string;
    voluumWorkspaceId: string;
    syncInterval: string;
  }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [accessId, setAccessId] = useState(initial?.voluumAccessId ?? "");
  const [accessKey, setAccessKey] = useState(initial?.voluumAccessKey ?? "");
  const [apiBaseUrl, setApiBaseUrl] = useState(initial?.voluumApiBaseUrl ?? "");
  const [voluumWorkspaceId, setVoluumWorkspaceId] = useState(initial?.voluumWorkspaceId ?? "");
  const [syncInterval, setSyncInterval] = useState(initial?.syncInterval ?? "manual");

  const isEdit = !!initial?.id;

  function handleSave() {
    onSave({ name, description, voluumAccessId: accessId, voluumAccessKey: accessKey, voluumApiBaseUrl: apiBaseUrl, voluumWorkspaceId, syncInterval });
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Workspace" : "Add Workspace"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs font-medium">Workspace Name *</Label>
            <Input className="mt-1" placeholder="e.g. Main Workspace" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs font-medium">Description</Label>
            <Input className="mt-1" placeholder="Optional description" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <Separator />
          <div>
            <p className="text-xs font-semibold text-foreground mb-0.5">Voluum Credentials</p>
            <p className="text-[11px] text-muted-foreground mb-3">Enter the Access ID and Access Key for this Voluum account. Use "Test Metadata Sync" after saving to verify what's returned.</p>
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium">Access ID</Label>
                <Input className="mt-1 font-mono text-xs" placeholder="Voluum Access ID" value={accessId} onChange={e => setAccessId(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-medium">Access Key</Label>
                <Input className="mt-1 font-mono text-xs" type="password" placeholder="Voluum Access Key" value={accessKey} onChange={e => setAccessKey(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-medium">API Base URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input className="mt-1 font-mono text-xs" placeholder="https://api.voluum.com" value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-medium">Voluum Workspace ID <span className="text-muted-foreground font-normal">(optional — scopes metadata to a specific Voluum workspace)</span></Label>
                <Input className="mt-1 font-mono text-xs" placeholder="e.g. a1b2c3d4-..." value={voluumWorkspaceId} onChange={e => setVoluumWorkspaceId(e.target.value)} />
                <p className="text-[10px] text-muted-foreground mt-1">If Voluum returns 0 traffic sources, use "Test Metadata Sync" to see your available workspace IDs, then paste one here.</p>
              </div>
            </div>
          </div>
          <Separator />
          <div>
            <Label className="text-xs font-medium">Auto-Sync Interval</Label>
            <Select value={syncInterval} onValueChange={v => setSyncInterval(v as any)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual only</SelectItem>
                <SelectItem value="5min">Every 5 minutes</SelectItem>
                <SelectItem value="15min">Every 15 minutes</SelectItem>
                <SelectItem value="hourly">Hourly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? <RefreshCw size={13} className="animate-spin mr-1" /> : null}
            {isEdit ? "Save Changes" : "Add Workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DebugEndpointInfo({ debug }: { debug: { endpoint: string; httpStatus: number; contentType: string; rawBodySnippet: string; parsedCount: number; error: string | null } }) {
  const [expanded, setExpanded] = useState(false);
  const ok = debug.httpStatus >= 200 && debug.httpStatus < 300 && !debug.error;
  return (
    <div className={`rounded border text-[10px] font-mono ${ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
      <button className="w-full flex items-center justify-between px-2 py-1.5 text-left" onClick={() => setExpanded(v => !v)}>
        <span className={ok ? "text-green-700" : "text-red-700"}>
          {ok ? "✓" : "✗"} HTTP {debug.httpStatus} · {debug.parsedCount} items parsed
        </span>
        <span className="text-muted-foreground">{expanded ? "▲" : "▼"} debug</span>
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-1 border-t border-inherit pt-1.5">
          <div><span className="text-muted-foreground">endpoint: </span><span className="break-all">{debug.endpoint}</span></div>
          <div><span className="text-muted-foreground">content-type: </span>{debug.contentType || "—"}</div>
          {debug.error && <div className="text-red-700"><span className="text-muted-foreground">error: </span>{debug.error}</div>}
          <div className="text-muted-foreground">raw response (first 1000 chars):</div>
          <pre className="whitespace-pre-wrap break-all bg-white/60 rounded p-1.5 text-[9px] max-h-32 overflow-y-auto">{debug.rawBodySnippet || "(empty)"}</pre>
        </div>
      )}
    </div>
  );
}

function MetadataTestDialog({ wsId, wsName, onClose }: { wsId: number; wsName: string; onClose: () => void }) {
  const [result, setResult] = useState<VoluumMetadataTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const testMutation = useTestVoluumWorkspaceMetadata({
    mutation: {
      onSuccess: (data: any) => { setResult(data); setError(null); },
      onError: (err: any) => { setError(err?.message ?? "Test failed"); },
    },
  } as any);

  const running = testMutation.isPending;

  function handleRun() {
    setResult(null);
    setError(null);
    testMutation.mutate({ id: wsId });
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Test Metadata Sync — {wsName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            Fetches Voluum workspaces, traffic sources, and affiliate networks without writing anything to the database. Use this to diagnose what Voluum returns with your current credentials and workspace ID setting.
          </p>
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 flex gap-2 items-start">
              <AlertCircle size={13} className="text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
          {result && (() => {
            // Normalize defensively — backend may omit arrays under some
            // failure paths after tag-filter changes. Never trust the shape.
            const voluumWorkspaces = Array.isArray((result as any)?.voluumWorkspaces)
              ? (result as any).voluumWorkspaces
              : [];
            const trafficSources = Array.isArray((result as any)?.trafficSources)
              ? (result as any).trafficSources
              : [];
            const affiliateNetworks = Array.isArray((result as any)?.affiliateNetworks)
              ? (result as any).affiliateNetworks
              : [];
            const debug = (result as any)?.debug ?? {};
            return (
            <div className="space-y-3">
              {/* Voluum Workspaces */}
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Voluum Workspaces</p>
                  <Badge variant="outline" className="text-[10px]">{voluumWorkspaces.length} returned</Badge>
                </div>
                {voluumWorkspaces.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">None returned (account may not have workspace API access)</p>
                ) : (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {voluumWorkspaces.map((ws: any) => (
                      <div key={ws.id} className="flex items-center justify-between text-[11px]">
                        <span className="font-medium truncate">{ws.name}</span>
                        <code className="text-muted-foreground bg-muted px-1 rounded text-[10px] ml-2 shrink-0">{ws.id}</code>
                      </div>
                    ))}
                  </div>
                )}
                {voluumWorkspaces.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">Copy the ID for the workspace you want to scope, paste it into the Voluum Workspace ID field in Settings.</p>
                )}
              </div>

              {/* Traffic Sources */}
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Traffic Sources</p>
                  <Badge variant={trafficSources.length > 0 ? "default" : "outline"} className="text-[10px]">
                    {trafficSources.length} returned
                  </Badge>
                </div>
                {debug?.trafficSources && (
                  <DebugEndpointInfo debug={debug.trafficSources} />
                )}
                {trafficSources.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">0 returned — try setting a Voluum Workspace ID above</p>
                ) : (
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {(trafficSources as VoluumTrafficSource[]).map((ts) => (
                      <Badge key={ts.id} variant="outline" className="text-[10px]">{ts.name}</Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Affiliate Networks */}
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Affiliate Networks</p>
                  <Badge variant={affiliateNetworks.length > 0 ? "default" : "outline"} className="text-[10px]">
                    {affiliateNetworks.length} returned
                  </Badge>
                </div>
                {debug?.affiliateNetworks && (
                  <DebugEndpointInfo debug={debug.affiliateNetworks} />
                )}
                {affiliateNetworks.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">0 returned — try setting a Voluum Workspace ID above</p>
                ) : (
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {affiliateNetworks.map((an: any) => (
                      <Badge key={an.id} variant="outline" className="text-[10px]">{an.name}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
            );
          })()}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handleRun} disabled={running}>
            {running ? <RefreshCw size={12} className="animate-spin mr-1.5" /> : <Zap size={12} className="mr-1.5" />}
            {running ? "Fetching…" : (result ? "Run Again" : "Run Test")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SyncStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge variant="outline" className="text-xs text-muted-foreground">Never synced</Badge>;
  if (status === "success") return <Badge className="bg-green-100 text-green-700 border-green-200 text-xs"><CheckCircle2 size={10} className="mr-1" />Synced</Badge>;
  if (status === "error") return <Badge className="bg-red-100 text-red-700 border-red-200 text-xs"><AlertCircle size={10} className="mr-1" />Error</Badge>;
  if (status === "syncing") return <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs"><RefreshCw size={10} className="animate-spin mr-1" />Syncing…</Badge>;
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}

function WorkspaceCard({ ws, onEdit, onDelete }: { ws: VoluumWorkspace; onEdit: () => void; onDelete: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showSources, setShowSources] = useState(false);
  const [showNetworks, setShowNetworks] = useState(false);
  const [showCampaigns, setShowCampaigns] = useState(false);
  const [showOffers, setShowOffers] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showMappings, setShowMappings] = useState(false);
  const [assignOfferId, setAssignOfferId] = useState<number | null>(null);
  const [assignBatchId, setAssignBatchId] = useState("");
  const [addMemberId, setAddMemberId] = useState<string>("");
  const [addMemberRole, setAddMemberRole] = useState<string>("employee");
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<any>(null);
  const [mapCampaignId, setMapCampaignId] = useState("");
  const [mapBatchId, setMapBatchId] = useState("");

  const { data: allEmployees } = useListEmployees(undefined, {
    query: { enabled: showMembers, queryKey: getListEmployeesQueryKey() },
  });
  const { data: members, isLoading: membersLoading } = useListWorkspaceMembers(
    { workspace_id: ws.id },
    { query: { enabled: showMembers, queryKey: getListWorkspaceMembersQueryKey({ workspace_id: ws.id }) } },
  );

  const addMemberMutation = useAddWorkspaceMember({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWorkspaceMembersQueryKey({ workspace_id: ws.id }) });
        setAddMemberId("");
        toast({ title: "Member added", description: "Employee now has access to this workspace." });
      },
      onError: (err: any) => {
        toast({ title: "Failed to add member", description: err?.message ?? "Already assigned?", variant: "destructive" });
      },
    },
  } as any);

  const removeMemberMutation = useRemoveWorkspaceMember({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWorkspaceMembersQueryKey({ workspace_id: ws.id }) });
        toast({ title: "Member removed" });
      },
      onError: (err: any) => {
        toast({ title: "Failed to remove", description: err?.message, variant: "destructive" });
      },
    },
  } as any);

  const assignedEmployeeIds = new Set((members ?? []).map((m: WorkspaceMember) => m.employeeId));
  const unassignedEmployees = (allEmployees ?? []).filter((e: any) => !assignedEmployeeIds.has(e.id));

  const syncMutation = useSyncVoluumWorkspace({
    mutation: {
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: getListVoluumWorkspacesQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["listVoluumTrafficSources"] });
        queryClient.invalidateQueries({ queryKey: ["listVoluumAffiliateNetworks"] });
        queryClient.invalidateQueries({ queryKey: getListSyncedVoluumCampaignsQueryKey({ workspace_id: ws.id }) });
        queryClient.invalidateQueries({ queryKey: getListSyncedVoluumOffersQueryKey({ workspace_id: ws.id }) });
        queryClient.invalidateQueries({ queryKey: getListSyncedVoluumOffersQueryKey({ workspace_id: ws.id, unmapped_only: "true" }) });
        setLastSyncResult(data);
        const hasWarnings = data.warnings?.length > 0;
        const skippedParts: string[] = [];
        if (data.skippedUntaggedOffers) skippedParts.push(`${data.skippedUntaggedOffers} untagged offers skipped`);
        if (data.skippedUntaggedCampaigns) skippedParts.push(`${data.skippedUntaggedCampaigns} untagged campaigns skipped`);
        const parts = [
          `Traffic: ${data.trafficSourcesSynced ?? 0}`,
          `Networks: ${data.networksSynced ?? 0}`,
          `Campaigns: ${data.campaignsSynced ?? 0}`,
          `Offers: ${data.offersSynced ?? 0}`,
          ...(data.batchesCreated ? [`Batches created: ${data.batchesCreated}`] : []),
          ...(skippedParts.length ? [skippedParts.join(", ")] : []),
        ];
        toast({
          title: hasWarnings ? "Sync complete — check warnings" : "Sync complete",
          description: parts.join(" · "),
          variant: hasWarnings ? "destructive" : "default",
        });
      },
      onError: (err: any) => {
        queryClient.invalidateQueries({ queryKey: getListVoluumWorkspacesQueryKey() });
        toast({ title: "Sync failed", description: err?.message ?? "Unknown error", variant: "destructive" });
      },
    },
  } as any);

  const setActiveMutation = useSetActiveVoluumWorkspace({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVoluumWorkspacesQueryKey() });
        toast({ title: "Workspace activated", description: `${ws.name} is now the active workspace` });
      },
    },
  } as any);

  const { data: sources } = useListVoluumTrafficSources(
    { workspace_id: ws.id },
    { query: { enabled: showSources } } as any
  );
  const { data: networks } = useListVoluumAffiliateNetworks(
    { workspace_id: ws.id },
    { query: { enabled: showNetworks } } as any
  );
  const { data: wsMappings, isLoading: mappingsLoading } = useListVoluumMappings(
    { workspace_id: ws.id },
    { query: { enabled: showMappings } } as any
  );
  const { data: wsCampaigns } = useListSyncedVoluumCampaigns(
    { workspace_id: ws.id },
    { query: { enabled: showMappings || showCampaigns } } as any
  );
  const { data: wsOffers } = useListSyncedVoluumOffers(
    { workspace_id: ws.id },
    { query: { enabled: showOffers } } as any
  );
  const { data: wsUnmappedOffers } = useListSyncedVoluumOffers(
    { workspace_id: ws.id, unmapped_only: "true" },
    { query: { enabled: showOffers } } as any
  );
  const { data: wsBatches } = useListTestingBatches(
    { workspace_id: ws.id },
    { query: { enabled: showMappings || showOffers } } as any
  );

  const assignOfferMutation = useAssignVoluumOfferToBatch({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSyncedVoluumOffersQueryKey({ workspace_id: ws.id }) });
        queryClient.invalidateQueries({ queryKey: getListSyncedVoluumOffersQueryKey({ workspace_id: ws.id, unmapped_only: "true" }) });
        setAssignOfferId(null);
        setAssignBatchId("");
        toast({ title: "Offer assigned to batch" });
      },
      onError: (err: any) => toast({ title: "Error", description: err?.message, variant: "destructive" }),
    },
  } as any);

  const autoGroupMutation = useAutoGroupVoluumOffers({
    mutation: {
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: getListSyncedVoluumOffersQueryKey({ workspace_id: ws.id }) });
        queryClient.invalidateQueries({ queryKey: getListSyncedVoluumOffersQueryKey({ workspace_id: ws.id, unmapped_only: "true" }) });
        toast({
          title: "Auto-group complete",
          description: `${data.batchesCreated ?? 0} new batch(es) created · ${data.offersGrouped ?? 0} offers grouped`,
        });
      },
      onError: (err: any) => toast({ title: "Auto-group failed", description: err?.message, variant: "destructive" }),
    },
  } as any);

  const createMappingMutation = useCreateVoluumMapping({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVoluumMappingsQueryKey({ workspace_id: ws.id }) });
        setMapCampaignId("");
        setMapBatchId("");
        toast({ title: "Mapping created", description: "Campaign linked to batch." });
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err?.message ?? "Failed to create mapping", variant: "destructive" });
      },
    },
  } as any);

  const deleteMappingMutation = useDeleteVoluumMapping({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVoluumMappingsQueryKey({ workspace_id: ws.id }) });
        toast({ title: "Mapping removed" });
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err?.message ?? "Failed to delete mapping", variant: "destructive" });
      },
    },
  } as any);

  const handleCreateMapping = () => {
    if (!mapCampaignId || !mapBatchId) return;
    const campaign = (wsCampaigns ?? []).find((c: any) => c.campaignId === mapCampaignId);
    createMappingMutation.mutate({
      data: {
        campaignId: mapCampaignId,
        campaignName: campaign?.campaignName ?? mapCampaignId,
        batchId: Number(mapBatchId),
        workspaceId: ws.id,
      },
    } as any);
  };

  const hasCredentials = !!(ws.voluumAccessId && ws.voluumAccessKey);
  const isSyncing = syncMutation.isPending;

  return (
    <Card className={`transition-all ${ws.isActive ? "ring-2 ring-primary/30 border-primary/40" : ""}`}>
      <CardContent className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${ws.isActive ? "bg-primary/10" : "bg-muted"}`}>
              <Building2 size={16} className={ws.isActive ? "text-primary" : "text-muted-foreground"} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm leading-tight">{ws.name}</h3>
                {ws.isActive && <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] py-0">Active</Badge>}
                {ws.isDefault && <Badge variant="outline" className="text-[10px] py-0">Default</Badge>}
              </div>
              {ws.description && <p className="text-xs text-muted-foreground mt-0.5">{ws.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!ws.isActive && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActiveMutation.mutate({ id: ws.id })} disabled={setActiveMutation.isPending}>
                Set Active
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={onEdit}>
              <Settings2 size={12} />
            </Button>
            {!ws.isDefault && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-destructive hover:text-destructive" onClick={onDelete}>
                <Trash2 size={12} />
              </Button>
            )}
          </div>
        </div>

        {/* Status grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-md bg-muted/40 p-3">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Voluum Credentials</p>
            <div className="flex items-center gap-1.5">
              {hasCredentials
                ? <><Wifi size={12} className="text-green-600" /><span className="text-xs font-medium text-green-700">Configured</span></>
                : <><WifiOff size={12} className="text-muted-foreground" /><span className="text-xs text-muted-foreground">Not configured</span></>
              }
            </div>
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Sync Status</p>
            <SyncStatusBadge status={ws.syncStatus} />
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Last Synced</p>
            <p className="text-xs font-medium">
              {ws.lastSyncAt ? new Date(ws.lastSyncAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
            </p>
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Auto-Sync</p>
            <p className="text-xs font-medium">{SYNC_INTERVAL_LABELS[ws.syncInterval] ?? ws.syncInterval}</p>
          </div>
          {ws.voluumWorkspaceId && (
            <div className="rounded-md bg-muted/40 p-3 col-span-2">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Voluum Workspace ID (scoped)</p>
              <code className="text-[10px] font-mono text-foreground break-all">{ws.voluumWorkspaceId}</code>
            </div>
          )}
        </div>

        {/* Warnings from last sync */}
        {lastSyncResult?.warnings?.length > 0 && (
          <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
            {lastSyncResult.warnings.map((w: string, i: number) => (
              <div key={i} className="flex gap-2 items-start">
                <AlertCircle size={12} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-amber-800">{w}</p>
              </div>
            ))}
          </div>
        )}

        {/* Debug info from last sync */}
        {lastSyncResult?.debug && (
          <div className="mb-3 space-y-1.5">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Debug — Last Sync Endpoints</p>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">Traffic Sources</p>
              <DebugEndpointInfo debug={lastSyncResult.debug.trafficSources} />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">Affiliate Networks</p>
              <DebugEndpointInfo debug={lastSyncResult.debug.affiliateNetworks} />
            </div>
          </div>
        )}

        {/* Sync counts + expandable lists */}
        <div className="space-y-2 mb-4">
          {/* Traffic sources */}
          <button
            className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            onClick={() => setShowSources(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Network size={12} className="text-muted-foreground" />
              <span className="text-xs font-medium">Traffic Sources</span>
              <Badge variant="outline" className="text-[10px] py-0 h-4">{ws.trafficSourcesSynced}</Badge>
            </div>
            {showSources ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
          </button>
          {showSources && (
            <div className="px-3 pb-1">
              {!sources ? (
                <p className="text-xs text-muted-foreground italic">Loading…</p>
              ) : sources.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No traffic sources synced yet. Click "Sync Now" to import.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {sources.map(s => (
                    <Badge key={s.id} variant="outline" className="text-[10px]">{s.name}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Affiliate networks */}
          <button
            className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            onClick={() => setShowNetworks(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Database size={12} className="text-muted-foreground" />
              <span className="text-xs font-medium">Affiliate Networks</span>
              <Badge variant="outline" className="text-[10px] py-0 h-4">{ws.networksSynced}</Badge>
            </div>
            {showNetworks ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
          </button>
          {showNetworks && (
            <div className="px-3 pb-1">
              {!networks ? (
                <p className="text-xs text-muted-foreground italic">Loading…</p>
              ) : networks.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No affiliate networks synced yet. Click "Sync Now" to import.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {networks.map(n => (
                    <Badge key={n.id} variant="outline" className="text-[10px]">{n.name}</Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Voluum Campaigns */}
          <button
            className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            onClick={() => setShowCampaigns(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Zap size={12} className="text-muted-foreground" />
              <span className="text-xs font-medium">Voluum Campaigns</span>
              {wsCampaigns && <Badge variant="outline" className="text-[10px] py-0 h-4">{wsCampaigns.length}</Badge>}
              {!wsCampaigns && ws.syncStatus === null && <span className="text-[10px] text-muted-foreground ml-1">sync to populate</span>}
            </div>
            {showCampaigns ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
          </button>
          {showCampaigns && (
            <div className="px-3 pb-1 space-y-2">
              {!wsCampaigns ? (
                <p className="text-xs text-muted-foreground italic">Click "Sync Now" to import campaigns from Voluum.</p>
              ) : wsCampaigns.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No campaigns synced yet. Click "Sync Now" to import.</p>
              ) : (
                <div className="space-y-1 mt-1 max-h-48 overflow-y-auto">
                  {wsCampaigns.map((c: any) => (
                    <div key={c.campaignId} className="flex items-start gap-2 rounded-md bg-muted/20 px-2.5 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{c.campaignName}</p>
                        <div className="flex gap-1.5 flex-wrap mt-0.5">
                          {c.trafficSourceName && <span className="text-[10px] text-muted-foreground">{c.trafficSourceName}</span>}
                          {c.country && <Badge variant="outline" className="text-[10px] py-0 h-3.5">{c.country}</Badge>}
                          {c.affiliateNetworkName && <span className="text-[10px] text-primary">{c.affiliateNetworkName}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Voluum Offers */}
          <button
            className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            onClick={() => setShowOffers(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Link2 size={12} className="text-muted-foreground" />
              <span className="text-xs font-medium">Voluum Offers</span>
              {wsOffers && <Badge variant="outline" className="text-[10px] py-0 h-4">{wsOffers.length}</Badge>}
              {wsUnmappedOffers && wsUnmappedOffers.length > 0 && (
                <Badge className="text-[10px] py-0 h-4 bg-amber-100 text-amber-700 border-amber-200">{wsUnmappedOffers.length} unmapped</Badge>
              )}
            </div>
            {showOffers ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
          </button>
          {showOffers && (
            <div className="px-3 pb-2 space-y-2">
              {!wsOffers ? (
                <p className="text-xs text-muted-foreground italic">Click "Sync Now" to import offers from Voluum.</p>
              ) : wsOffers.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No offers synced yet. Click "Sync Now" to import.</p>
              ) : (
                <>
                  {wsUnmappedOffers && wsUnmappedOffers.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-medium text-amber-700 uppercase tracking-wide">Unmapped Offers ({wsUnmappedOffers.length})</p>
                        <Button
                          size="sm" variant="outline"
                          className="h-6 text-[10px] gap-1 px-2"
                          disabled={autoGroupMutation.isPending}
                          onClick={() => autoGroupMutation.mutate({ id: ws.id })}
                        >
                          <RefreshCw size={9} className={autoGroupMutation.isPending ? "animate-spin" : ""} />
                          Auto-group by tag
                        </Button>
                      </div>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {wsUnmappedOffers.map((o: any) => (
                          <div key={o.offerId} className="rounded-md border border-amber-200 bg-amber-50/50 px-2.5 py-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{o.offerName}</p>
                                <div className="flex gap-1.5 flex-wrap mt-0.5">
                                  {o.affiliateNetworkName && <span className="text-[10px] text-primary">{o.affiliateNetworkName}</span>}
                                  {o.country && <Badge variant="outline" className="text-[10px] py-0 h-3.5">{o.country}</Badge>}
                                  {o.primaryTag && <code className="text-[10px] text-muted-foreground">{o.primaryTag}</code>}
                                </div>
                              </div>
                              {assignOfferId === o.id ? (
                                <div className="flex gap-1 items-center flex-shrink-0">
                                  <Select value={assignBatchId} onValueChange={setAssignBatchId}>
                                    <SelectTrigger className="h-6 text-[10px] w-28">
                                      <SelectValue placeholder="Batch…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(wsBatches ?? []).map((b: any) => (
                                        <SelectItem key={b.id} value={String(b.id)} className="text-xs">{b.batchName}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Button size="sm" className="h-6 px-1.5 text-[10px]"
                                    disabled={!assignBatchId || assignOfferMutation.isPending}
                                    onClick={() => assignOfferMutation.mutate({ id: o.id, data: { batchId: Number(assignBatchId) } })}
                                  >OK</Button>
                                  <button className="text-muted-foreground hover:text-foreground" onClick={() => setAssignOfferId(null)}><ChevronDown size={10} /></button>
                                </div>
                              ) : (
                                <button
                                  className="text-[10px] text-primary underline flex-shrink-0"
                                  onClick={() => { setAssignOfferId(o.id); setAssignBatchId(""); }}
                                >
                                  Assign
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {wsOffers.filter((o: any) => o.batchId).length > 0 && (
                    <p className="text-[10px] text-muted-foreground">{wsOffers.filter((o: any) => o.batchId).length} offer(s) already assigned to batches</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Members */}
          <button
            className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            onClick={() => setShowMembers(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Users size={12} className="text-muted-foreground" />
              <span className="text-xs font-medium">Members</span>
              {members && <Badge variant="outline" className="text-[10px] py-0 h-4">{members.length}</Badge>}
            </div>
            {showMembers ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
          </button>
          {showMembers && (
            <div className="px-3 pb-2 space-y-2">
              {membersLoading ? (
                <p className="text-xs text-muted-foreground italic">Loading…</p>
              ) : !members || members.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No members assigned yet. All employees have access by default.</p>
              ) : (
                <div className="space-y-1 mt-1">
                  {members.map((m: WorkspaceMember) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/20 px-2.5 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{m.employeeName}</p>
                        <p className="text-[10px] text-muted-foreground">{m.employeeEmail} · {m.role === "workspace_admin" ? "Workspace Admin" : "Employee"}</p>
                      </div>
                      <button
                        onClick={() => removeMemberMutation.mutate({ id: m.id })}
                        disabled={removeMemberMutation.isPending}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove from workspace"
                      >
                        <UserMinus size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* Add member */}
              <div className="flex gap-1.5 mt-2 pt-2 border-t border-border/50">
                <Select value={addMemberId} onValueChange={setAddMemberId}>
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Add employee…" />
                  </SelectTrigger>
                  <SelectContent>
                    {unassignedEmployees.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-2 py-1">All employees assigned</p>
                    ) : (
                      unassignedEmployees.map((e: any) => (
                        <SelectItem key={e.id} value={String(e.id)} className="text-xs">{e.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Select value={addMemberRole} onValueChange={setAddMemberRole}>
                  <SelectTrigger className="h-7 text-xs w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee" className="text-xs">Employee</SelectItem>
                    <SelectItem value="workspace_admin" className="text-xs">Workspace Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-7 px-2"
                  disabled={!addMemberId || addMemberMutation.isPending}
                  onClick={() => addMemberMutation.mutate({ data: { employeeId: Number(addMemberId), workspaceId: ws.id, role: addMemberRole as any } } as any)}
                >
                  <UserPlus size={11} />
                </Button>
              </div>
            </div>
          )}

          {/* Campaign → Batch Mappings */}
          <button
            className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            onClick={() => setShowMappings(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Link2 size={12} className="text-muted-foreground" />
              <span className="text-xs font-medium">Campaign Mappings</span>
              {wsMappings && <Badge variant="outline" className="text-[10px] py-0 h-4">{wsMappings.length}</Badge>}
            </div>
            {showMappings ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
          </button>
          {showMappings && (
            <div className="px-3 pb-2 space-y-3">
              {/* Existing mappings */}
              {mappingsLoading ? (
                <p className="text-xs text-muted-foreground italic">Loading…</p>
              ) : !wsMappings || wsMappings.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No campaign mappings yet.</p>
              ) : (
                <div className="rounded-md border border-border overflow-hidden mt-1">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Campaign</th>
                        <th className="px-3 py-2 text-center font-medium">Batch</th>
                        <th className="px-3 py-2 text-right font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {wsMappings.map(m => (
                        <tr key={m.campaignId} className="hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-2">
                            <p className="font-medium truncate max-w-[180px]">{m.campaignName}</p>
                            <p className="text-[10px] text-muted-foreground font-mono truncate">{m.campaignId}</p>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {wsBatches?.find((b: any) => b.id === m.batchId) ? (
                              <span className="text-[10px] font-medium">{wsBatches.find((b: any) => b.id === m.batchId)?.batchName}</span>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">#{m.batchId}</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => deleteMappingMutation.mutate({ campaignId: m.campaignId })}
                              disabled={deleteMappingMutation.isPending}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              title="Remove mapping"
                            >
                              <Trash2 size={11} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add new mapping — uses synced campaigns (no manual "Load" needed) */}
              <div className="pt-1 border-t border-border/50 space-y-2">
                {!wsCampaigns || wsCampaigns.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">
                    {hasCredentials ? 'Run "Sync Now" to import campaigns into this workspace first.' : "Configure Voluum credentials and sync to see campaigns."}
                  </p>
                ) : (
                  <div className="flex gap-1.5 flex-wrap items-end">
                    <div className="flex-1 min-w-[140px]">
                      <Select value={mapCampaignId} onValueChange={setMapCampaignId}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Select campaign…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(wsCampaigns ?? []).map((c: any) => (
                            <SelectItem key={c.campaignId} value={c.campaignId} className="text-xs">{c.campaignName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <Select value={mapBatchId} onValueChange={setMapBatchId}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Select batch…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(wsBatches ?? []).map((b: any) => (
                            <SelectItem key={b.id} value={String(b.id)} className="text-xs">{b.batchName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 px-2 gap-1"
                      onClick={handleCreateMapping}
                      disabled={!mapCampaignId || !mapBatchId || createMappingMutation.isPending}
                    >
                      <Link2 size={11} />
                      {createMappingMutation.isPending ? "…" : "Link"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            variant={hasCredentials ? "default" : "outline"}
            disabled={!hasCredentials || isSyncing}
            onClick={() => syncMutation.mutate({ id: ws.id })}
          >
            <RefreshCw size={12} className={`mr-1.5 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing…" : "Sync Now"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!hasCredentials}
            onClick={() => setShowTestDialog(true)}
            title="Fetch metadata from Voluum without importing — diagnose what's returned"
          >
            <Zap size={12} className="mr-1" />
            Test
          </Button>
        </div>
        {!hasCredentials && (
          <p className="text-[11px] text-muted-foreground text-center mt-1.5">Add Voluum credentials to enable sync</p>
        )}

        {showTestDialog && (
          <MetadataTestDialog wsId={ws.id} wsName={ws.name} onClose={() => setShowTestDialog(false)} />
        )}
      </CardContent>
    </Card>
  );
}

function WorkspaceTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editWs, setEditWs] = useState<VoluumWorkspace | null>(null);

  const { data: workspaces, isLoading } = useListVoluumWorkspaces();

  const createMutation = useCreateVoluumWorkspace({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVoluumWorkspacesQueryKey() });
        setShowAdd(false);
        toast({ title: "Workspace added", description: "New workspace has been linked." });
      },
      onError: (err: any) => {
        toast({ title: "Failed to add workspace", description: err?.message, variant: "destructive" });
      },
    },
  } as any);

  const updateMutation = useUpdateVoluumWorkspace({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVoluumWorkspacesQueryKey() });
        setEditWs(null);
        toast({ title: "Workspace updated" });
      },
      onError: (err: any) => {
        toast({ title: "Failed to update workspace", description: err?.message, variant: "destructive" });
      },
    },
  } as any);

  const deleteMutation = useDeleteVoluumWorkspace({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVoluumWorkspacesQueryKey() });
        toast({ title: "Workspace removed" });
      },
      onError: (err: any) => {
        toast({ title: "Failed to remove workspace", description: err?.message, variant: "destructive" });
      },
    },
  } as any);

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Building2 size={16} className="text-primary" /> Workspace Management
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect OfferOps to your Voluum workspaces. Each workspace syncs its own traffic sources and affiliate networks — names always stay aligned with Voluum.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} className="mr-1.5" /> Add Workspace
        </Button>
      </div>

      {/* Product principle banner */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex gap-3 items-start">
        <Zap size={14} className="text-primary mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-primary">Voluum-Aligned Naming</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Traffic source and affiliate network names are always pulled directly from Voluum and kept in sync automatically. OfferOps does not maintain separate naming — everything stays aligned with your Voluum workspace in real time.
          </p>
        </div>
      </div>

      {/* Workspace cards */}
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : !workspaces || workspaces.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Building2 size={32} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No workspaces yet</p>
            <p className="text-xs text-muted-foreground mt-1">Click "Add Workspace" to link your first Voluum workspace.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {workspaces.map(ws => (
            <WorkspaceCard
              key={ws.id}
              ws={ws}
              onEdit={() => setEditWs(ws)}
              onDelete={() => {
                if (!confirm(`Remove workspace "${ws.name}"? This will also delete all synced traffic sources and affiliate networks for this workspace.`)) return;
                deleteMutation.mutate({ id: ws.id });
              }}
            />
          ))}
        </div>
      )}

      {/* Add workspace dialog */}
      <WorkspaceFormDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={data => createMutation.mutate({ data } as any)}
        saving={createMutation.isPending}
      />

      {/* Edit workspace dialog */}
      {editWs && (
        <WorkspaceFormDialog
          open
          onClose={() => setEditWs(null)}
          initial={editWs}
          onSave={data => updateMutation.mutate({ id: editWs.id, data } as any)}
          saving={updateMutation.isPending}
        />
      )}

      <Separator className="my-2" />

      <TrafficSourceDevicePlanSection />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Traffic Source × Device test plan
// ─────────────────────────────────────────────────────────────────

const FIXED_DEVICES = ["iOS 3G", "iOS Wifi", "Android 3G", "Android Wifi", "Desktop"] as const;

function TrafficSourceDevicePlanSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeWorkspaceId } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;

  const tsParams = { workspace_id: wsId };
  const planParams = { workspace_id: wsId };
  const { data: trafficSources, isLoading: tsLoading } = useListVoluumTrafficSources(
    tsParams,
    { query: { enabled: wsId > 0, queryKey: getListVoluumTrafficSourcesQueryKey(tsParams) } },
  );
  const { data: planRows, isLoading: planLoading } = useGetTrafficSourceDevicePlan(
    planParams,
    { query: { enabled: wsId > 0, queryKey: getGetTrafficSourceDevicePlanQueryKey(planParams) } },
  );

  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [hydratedFor, setHydratedFor] = useState<number | null>(null);

  useEffect(() => {
    if (!planRows || hydratedFor === wsId) return;
    const next = new Set<string>();
    for (const r of planRows as Array<{ trafficSourceName: string; device: string }>) {
      next.add(`${r.trafficSourceName}::${r.device}`);
    }
    setEnabled(next);
    setHydratedFor(wsId);
  }, [planRows, hydratedFor, wsId]);

  const putMutation = usePutTrafficSourceDevicePlan({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTrafficSourceDevicePlanQueryKey({ workspace_id: wsId }) });
        toast({ title: "Test plan saved", description: "New batches will fan out tasks per enabled cell." });
      },
      onError: (err: Error) => {
        toast({ title: "Failed to save plan", description: err?.message, variant: "destructive" });
      },
    },
  });

  function toggle(source: string, device: string) {
    const key = `${source}::${device}`;
    const next = new Set(enabled);
    if (next.has(key)) next.delete(key); else next.add(key);
    setEnabled(next);
  }

  function save() {
    const pairs: { trafficSourceName: string; device: string }[] = [];
    for (const k of enabled) {
      const [trafficSourceName, device] = k.split("::");
      pairs.push({ trafficSourceName, device });
    }
    putMutation.mutate({ data: { workspaceId: wsId, pairs } });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Network size={15} className="text-primary" /> Test Plan: Traffic Source × Device
        </CardTitle>
        <CardDescription className="text-xs">
          Tick every (traffic source, device) cell where buyers should spin up a Voluum campaign for new batches. Each enabled cell becomes one auto-created task per new batch.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {wsId === 0 ? (
          <p className="text-xs text-muted-foreground">Select a workspace first.</p>
        ) : tsLoading || planLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !trafficSources || trafficSources.length === 0 ? (
          <p className="text-xs text-muted-foreground">No traffic sources synced yet for this workspace. Run a Voluum sync first.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Traffic Source</th>
                    {FIXED_DEVICES.map(d => (
                      <th key={d} className="text-center px-3 py-2 font-medium w-24">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(trafficSources as VoluumTrafficSource[]).map((ts) => (
                    <tr key={ts.id} className="border-t">
                      <td className="px-3 py-2 font-medium">{ts.name}</td>
                      {FIXED_DEVICES.map(d => {
                        const key = `${ts.name}::${d}`;
                        const checked = enabled.has(key);
                        return (
                          <td key={d} className="text-center px-3 py-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-primary"
                              checked={checked}
                              onChange={() => toggle(ts.name, d)}
                              data-testid={`plan-cell-${ts.name}-${d}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end mt-3">
              <Button size="sm" onClick={save} disabled={putMutation.isPending} data-testid="save-test-plan">
                {putMutation.isPending ? "Saving…" : "Save Test Plan"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// CampaignOps redesign — Worker ↔ Affiliate Network assignments tab.
// Admin-only. Lets an admin pick, per worker, which affiliate networks
// they are allowed to create batches for. Backed by
// /api/worker-affiliate-networks (GET/PUT).
// ─────────────────────────────────────────────────────────────────
function WorkerNetworksTab() {
  const { activeWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const wsId = activeWorkspaceId ?? 0;

  const { data: employees = [] } = useListEmployees(
    wsId ? { workspace_id: wsId } : undefined,
    { query: { enabled: !!wsId, queryKey: getListEmployeesQueryKey(wsId ? { workspace_id: wsId } : undefined) } },
  );
  const { data: networks = [] } = useListAffiliateNetworks(
    { workspace_id: wsId },
    { query: { enabled: !!wsId, queryKey: getListAffiliateNetworksQueryKey({ workspace_id: wsId }) } },
  );

  type Assignment = { id: number; employeeId: number; affiliateNetworkId: number };
  const { data: assignments = [], refetch } = useQuery<Assignment[]>({
    queryKey: ["worker-affiliate-networks", wsId],
    enabled: !!wsId,
    queryFn: () => authedJson(`/api/worker-affiliate-networks?workspace_id=${wsId}`),
  });

  const putMutation = useMutation({
    mutationFn: async (input: { employeeId: number; affiliateNetworkIds: number[] }) => {
      const res = await authedFetch(`/api/worker-affiliate-networks`, {
        method: "PUT",
        body: JSON.stringify({ workspaceId: wsId, ...input }),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => { void refetch(); toast({ title: "Assignments saved" }); },
    onError: (e: unknown) => toast({ title: "Save failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  if (!wsId) return <p className="text-sm text-muted-foreground">Select a workspace.</p>;

  function isAssigned(empId: number, netId: number): boolean {
    return assignments.some((a) => a.employeeId === empId && a.affiliateNetworkId === netId);
  }

  function toggle(empId: number, netId: number) {
    const current = assignments.filter((a) => a.employeeId === empId).map((a) => a.affiliateNetworkId);
    const next = current.includes(netId)
      ? current.filter((id) => id !== netId)
      : [...current, netId];
    putMutation.mutate({ employeeId: empId, affiliateNetworkIds: next });
  }

  const activeNetworks = (networks as Array<{ id: number; name: string; isActive?: boolean }>).filter((n) => n.isActive !== false);
  const workers = (employees as Array<{ id: number; name: string; role: string }>).filter((e) => e.role !== "admin");

  return (
    <div className="space-y-4 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Network size={16} /> Worker Network Assignments</CardTitle>
          <CardDescription>
            Workers can only create batches for the affiliate networks checked here. Admins are not gated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workers.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No worker employees yet.</p>
          ) : activeNetworks.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No active affiliate networks. Add some on the Affiliate Networks tab.</p>
          ) : (
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Worker</th>
                    {activeNetworks.map((n) => (
                      <th key={n.id} className="text-center px-3 py-2 font-medium whitespace-nowrap">{n.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {workers.map((emp) => (
                    <tr key={emp.id}>
                      <td className="px-3 py-2 font-medium">{emp.name}</td>
                      {activeNetworks.map((n) => (
                        <td key={n.id} className="text-center px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer"
                            disabled={putMutation.isPending}
                            checked={isAssigned(emp.id, n.id)}
                            onChange={() => toggle(emp.id, n.id)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
