// CampaignOps redesign — Live Campaigns page.
//
// Lists every Campaign in the workspace with rich filtering. The page
// is the operator's view of which iOS / Android creatives are running
// against which traffic sources, when each went live, and the current
// per-Campaign performance numbers (populated by the find_winners
// task completion flow).

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { authedJson } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Campaign = {
  id: number;
  workspaceId: number;
  batchId: number;
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

type TrafficSource = { id: number; name: string };

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

export default function LiveCampaigns() {
  const { activeWorkspaceId } = useWorkspace();
  const [statusFilter, setStatusFilter] = useState<string>("live");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [trafficSourceFilter, setTrafficSourceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setTrafficSourceFilter("all");
  }, [activeWorkspaceId]);

  const { data: trafficSources = [] } = useQuery<TrafficSource[]>({
    queryKey: ["workspace-traffic-sources", activeWorkspaceId],
    enabled: !!activeWorkspaceId,
    queryFn: () => authedJson(`/api/admin/workspace-traffic-sources?workspace_id=${activeWorkspaceId}`),
  });

  const params = new URLSearchParams();
  if (activeWorkspaceId) params.set("workspace_id", String(activeWorkspaceId));
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (platformFilter !== "all") params.set("platform", platformFilter);
  if (trafficSourceFilter !== "all") params.set("traffic_source_id", trafficSourceFilter);

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["live-campaigns", activeWorkspaceId, statusFilter, platformFilter, trafficSourceFilter],
    enabled: !!activeWorkspaceId,
    queryFn: () => authedJson(`/api/campaigns?${params.toString()}`),
  });

  const q = search.trim().toLowerCase();
  const filtered = q
    ? campaigns.filter((c) =>
        [c.campaignName, c.batchName, c.voluumCampaignName, c.trafficSourceName, c.employeeName]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q)),
      )
    : campaigns;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every Voluum campaign in the workflow — filter by status, platform, traffic source.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="voluum_created">Voluum created</SelectItem>
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
              {trafficSources.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Search</label>
          <Input className="mt-1 h-9" placeholder="Name, batch, worker…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="rounded-md border border-border bg-card/50 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Traffic source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Live since</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">ROI</TableHead>
              <TableHead className="text-right">Winners</TableHead>
              <TableHead>Worker</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No campaigns match these filters.</TableCell></TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <div>{c.campaignName}</div>
                    {c.batchName && <div className="text-[11px] text-muted-foreground">Batch: {c.batchName}{c.batchGeo ? ` • ${c.batchGeo}` : ""}</div>}
                    {c.voluumCampaignId && <div className="text-[11px] text-muted-foreground font-mono">Voluum: {c.voluumCampaignId}</div>}
                  </TableCell>
                  <TableCell><Badge variant="outline" className="uppercase text-[10px]">{c.platform}</Badge></TableCell>
                  <TableCell>{c.trafficSourceName ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={c.status} /></TableCell>
                  <TableCell className="text-xs">{fmtDate(c.liveStartedAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(c.cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(c.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(c.roi)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.winnersCount ?? "—"}</TableCell>
                  <TableCell className="text-xs">{c.employeeName ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
