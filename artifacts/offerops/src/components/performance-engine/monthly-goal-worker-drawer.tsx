import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InitialsBadge } from "@/components/performance-engine/initials-badge";
import {
  fetchGoalAllocation,
  formatMonthLabel,
  type GoalAllocationGeoRow,
  type GoalAllocationNetworkRow,
  type NetworkAllocationSource,
  type WorkerMonthlyRow,
} from "@/lib/performance-engine/api";
import { formatAllocationMetric, type GoalMetric } from "@/lib/performance-engine/goal-plan-utils";
import { ChevronDown, Pencil, X } from "lucide-react";

function MetricSummaryCard({
  label,
  current,
  target,
  prefix = "",
}: {
  label: string;
  current: number;
  target: number;
  prefix?: string;
}) {
  const remaining = Math.max(0, target - current);
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div className="rounded-lg border bg-white p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        {target > 0 ? (
          <span className="text-xs text-muted-foreground">{pct}%</span>
        ) : (
          <span className="text-xs text-muted-foreground">No target</span>
        )}
      </div>
      <p className="text-sm">
        <span className="font-medium">
          {prefix}
          {current.toLocaleString()}
        </span>
        {target > 0 && (
          <span className="text-muted-foreground">
            {" "}
            / {prefix}
            {target.toLocaleString()}
          </span>
        )}
      </p>
      {target > 0 && (
        <p className="text-xs text-muted-foreground">
          Remaining: {prefix}
          {remaining.toLocaleString()}
        </p>
      )}
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function networkSourceLabel(source?: NetworkAllocationSource): string {
  if (source === "auto-from-worker-wide") return "Auto from worker-wide";
  if (source === "network-explicit") return "Network explicit";
  if (source === "unallocated") return "Unallocated";
  return "Network goal";
}

function NetworkSourceBadge({ source }: { source?: NetworkAllocationSource }) {
  const label = networkSourceLabel(source);
  const cls =
    source === "auto-from-worker-wide"
      ? "bg-violet-50 text-violet-700"
      : source === "unallocated"
        ? "bg-amber-50 text-amber-800"
        : "bg-indigo-50 text-indigo-700";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>
  );
}

function GeoSourceBadge({
  source,
}: {
  source?: GoalAllocationGeoRow["revenueSource"];
}) {
  if (!source || source === "none") return <span className="text-muted-foreground">—</span>;
  if (source === "custom-zero") {
    return (
      <span className="rounded bg-amber-50 text-amber-800 px-1.5 py-0.5 text-[10px] font-medium">
        Custom · 0
      </span>
    );
  }
  if (source === "custom") {
    return (
      <span className="rounded bg-blue-50 text-blue-700 px-1.5 py-0.5 text-[10px] font-medium">
        Custom
      </span>
    );
  }
  return (
    <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 text-[10px] font-medium">
      Inherited
    </span>
  );
}

function formatNetworkCell(metric: GoalMetric, value: number | null): string {
  if (value == null) return "—";
  return formatAllocationMetric(metric, value);
}

function primaryNetworkSource(row: GoalAllocationNetworkRow): NetworkAllocationSource | undefined {
  const sources = [row.revenueSource, row.testingSource, row.workingSource].filter(Boolean);
  if (sources.includes("network-explicit")) return "network-explicit";
  if (sources.includes("auto-from-worker-wide")) return "auto-from-worker-wide";
  return sources[0];
}

function geoSplitHasMetric(rows: GoalAllocationGeoRow[], metric: GoalMetric): boolean {
  const key =
    metric === "revenue" ? "revenueTarget" : metric === "testingBatches" ? "testingTarget" : "workingTarget";
  const sourceKey =
    metric === "revenue" ? "revenueSource" : metric === "testingBatches" ? "testingSource" : "workingSource";
  return rows.some((r) => r[key] != null || (r[sourceKey] && r[sourceKey] !== "none"));
}

function GeoSplitTable({ rows }: { rows: GoalAllocationGeoRow[] }) {
  if (rows.length === 0) return null;
  const showRevenue = geoSplitHasMetric(rows, "revenue");
  const showTesting = geoSplitHasMetric(rows, "testingBatches");
  const showWorking = geoSplitHasMetric(rows, "workingCampaigns");

  return (
    <div className="mt-2 overflow-x-auto rounded-md border bg-white">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">GEO</th>
            {showRevenue && <th className="px-2 py-1.5 text-left font-medium">Revenue</th>}
            {showTesting && <th className="px-2 py-1.5 text-left font-medium">Testing</th>}
            {showWorking && <th className="px-2 py-1.5 text-left font-medium">Working</th>}
            <th className="px-2 py-1.5 text-left font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const sources = [row.revenueSource, row.testingSource, row.workingSource].filter(
              (s) => s && s !== "none",
            );
            const primary =
              sources.includes("custom") || sources.includes("custom-zero")
                ? sources.find((s) => s === "custom-zero" || s === "custom")
                : sources[0];
            return (
              <tr key={row.geoCode} className="border-t">
                <td className="px-2 py-1.5 font-medium">{row.geoCode}</td>
                {showRevenue && (
                  <td className="px-2 py-1.5">{formatAllocationMetric("revenue", row.revenueTarget)}</td>
                )}
                {showTesting && (
                  <td className="px-2 py-1.5">
                    {formatAllocationMetric("testingBatches", row.testingTarget)}
                  </td>
                )}
                {showWorking && (
                  <td className="px-2 py-1.5">
                    {formatAllocationMetric("workingCampaigns", row.workingTarget)}
                  </td>
                )}
                <td className="px-2 py-1.5">
                  <GeoSourceBadge source={primary} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NetworkRow({
  row,
  expanded,
  onToggle,
  onEdit,
  isWorkerWide,
}: {
  row: GoalAllocationNetworkRow | {
    affiliateNetworkName: string;
    revenueTarget: number | null;
    testingTarget: number | null;
    workingTarget: number | null;
    geoCount: number;
    overrideCount: number;
    geoSplitRows: GoalAllocationGeoRow[];
    revenueSource?: NetworkAllocationSource;
    testingSource?: NetworkAllocationSource;
    workingSource?: NetworkAllocationSource;
  };
  expanded: boolean;
  onToggle: () => void;
  onEdit: (networkName: string | null) => void;
  isWorkerWide?: boolean;
}) {
  const label = isWorkerWide ? "Worker-wide / Unallocated" : row.affiliateNetworkName;
  const canExpand = !isWorkerWide && row.geoSplitRows.length > 0;
  const noGeoScope =
    !isWorkerWide &&
    row.geoCount === 0 &&
    row.geoSplitRows.length === 0 &&
    (row.revenueTarget != null || row.testingTarget != null || row.workingTarget != null);
  const source = isWorkerWide
    ? ("unallocated" as const)
    : primaryNetworkSource(row as GoalAllocationNetworkRow);

  return (
    <div className="border-b last:border-b-0">
      <div
        className={`grid grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,0.7fr))_auto] gap-2 items-center px-2 py-2 text-xs ${
          canExpand ? "cursor-pointer hover:bg-slate-50/80" : ""
        }`}
        onClick={canExpand ? onToggle : undefined}
        role={canExpand ? "button" : undefined}
      >
        <div className="min-w-0 flex items-start gap-1.5">
          {canExpand && (
            <ChevronDown
              size={14}
              className={`shrink-0 mt-0.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          )}
          <div className="min-w-0">
            <p className="font-medium leading-snug break-words" title={label}>
              {label}
            </p>
            <NetworkSourceBadge source={source} />
          </div>
        </div>
        <span>{formatNetworkCell("revenue", row.revenueTarget)}</span>
        <span>{formatNetworkCell("testingBatches", row.testingTarget)}</span>
        <span>{formatNetworkCell("workingCampaigns", row.workingTarget)}</span>
        <span>{isWorkerWide ? "—" : row.geoCount || "—"}</span>
        <span>{isWorkerWide ? "—" : row.overrideCount || "—"}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(isWorkerWide ? null : row.affiliateNetworkName);
          }}
        >
          <Pencil size={12} className="mr-1" />
          Edit
        </Button>
      </div>
      {expanded && canExpand && (
        <div className="px-2 pb-2">
          <GeoSplitTable rows={row.geoSplitRows} />
        </div>
      )}
      {noGeoScope && (
        <p className="px-2 pb-2 text-[11px] text-muted-foreground">
          This network has goals, but no GEO scope selected.
        </p>
      )}
    </div>
  );
}

export function MonthlyGoalWorkerDrawer({
  worker,
  workspaceId,
  monthKey,
  open,
  onClose,
  onEditPlan,
}: {
  worker: WorkerMonthlyRow | null;
  workspaceId: number;
  monthKey: string;
  open: boolean;
  onClose: () => void;
  onEditPlan: (worker: WorkerMonthlyRow, networkName?: string | null) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const allocationQ = useQuery({
    queryKey: ["goal-allocation", workspaceId, monthKey, worker?.employeeId],
    queryFn: () => fetchGoalAllocation(workspaceId, worker!.employeeId, monthKey),
    enabled: open && worker != null && workspaceId > 0,
  });

  if (!worker) return null;

  const allocation = allocationQ.data;
  const monthLabel = formatMonthLabel(monthKey);
  const overview = allocation?.overview ?? {
    revenue: worker.revenue,
    testing: worker.testing,
    working: worker.working,
    xpEarned: worker.xpEarned,
  };
  const hasAnyGoals =
    allocation?.counts.hasAnyGoals ??
    (worker.revenue.target > 0 || worker.testing.target > 0 || worker.working.target > 0);

  const unallocatedRow = allocation?.workerWideUnallocated
    ? {
        affiliateNetworkName: "Worker-wide",
        revenueTarget: allocation.workerWideUnallocated.revenueTarget,
        testingTarget: allocation.workerWideUnallocated.testingTarget,
        workingTarget: allocation.workerWideUnallocated.workingTarget,
        geoCount: 0,
        overrideCount: 0,
        geoSplitRows: [] as GoalAllocationGeoRow[],
      }
    : null;

  function networksEmptyMessage(): string {
    return `No monthly goals configured for ${worker!.name} in ${monthLabel}.`;
  }

  function geosEmptyMessage(): string {
    if (!hasAnyGoals) {
      return `No GEO targets configured for this worker/month.`;
    }
    if ((allocation?.networks.length ?? 0) > 0 && (allocation?.geos.length ?? 0) === 0) {
      return "Network goals exist, but no GEO scope is configured yet.";
    }
    if (unallocatedRow) {
      return "No assigned networks/GEOs found for this worker/month.";
    }
    return "No GEO targets configured for this worker/month.";
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-[700px] overflow-y-auto p-0">
        <SheetHeader className="border-b p-4 pr-12">
          <div className="flex items-start gap-3">
            <InitialsBadge initials={worker.initials} size="lg" />
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-left text-base leading-snug">
                {worker.name} — {monthLabel} Goals
              </SheetTitle>
              {worker.email && (
                <p className="text-xs text-muted-foreground break-words mt-0.5">{worker.email}</p>
              )}
            </div>
            <button type="button" onClick={onClose} className="absolute right-4 top-4 text-muted-foreground">
              <X size={18} />
            </button>
          </div>
        </SheetHeader>

        <div className="p-4">
          {allocationQ.isLoading && (
            <p className="text-sm text-muted-foreground mb-3">Loading goal allocation…</p>
          )}
          {allocationQ.isError && (
            <p className="text-sm text-amber-700 mb-3">
              Could not load allocation details. Showing table totals only.
            </p>
          )}

          <Tabs defaultValue="networks">
            <TabsList className="grid w-full grid-cols-3 h-9 mb-4">
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              <TabsTrigger value="networks" className="text-xs">Networks</TabsTrigger>
              <TabsTrigger value="geos" className="text-xs">GEOs</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 mt-0">
              <MetricSummaryCard
                label="Revenue"
                current={overview.revenue.current}
                target={overview.revenue.target}
                prefix="$"
              />
              <MetricSummaryCard
                label="Testing"
                current={overview.testing.current}
                target={overview.testing.target}
              />
              <MetricSummaryCard
                label="Working campaigns"
                current={overview.working.current}
                target={overview.working.target}
              />
              <div className="rounded-lg border bg-blue-50/60 border-blue-100 p-3 text-sm">
                XP earned: <strong>{overview.xpEarned.toLocaleString()} XP</strong>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-semibold">Effective allocation</p>
                {!hasAnyGoals ? (
                  <p className="text-sm text-muted-foreground">
                    No monthly goals configured for {worker.name} in {monthLabel}.
                  </p>
                ) : (
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>Networks: {allocation?.counts.networkCount ?? 0}</li>
                    <li>GEO targets: {allocation?.counts.selectedGeoCount ?? 0}</li>
                    <li>Custom overrides: {allocation?.counts.overrideCount ?? 0}</li>
                    {unallocatedRow && (
                      <li className="text-amber-800">{allocation!.workerWideUnallocated!.message}</li>
                    )}
                  </ul>
                )}
              </div>
            </TabsContent>

            <TabsContent value="networks" className="mt-0 space-y-3">
              {!hasAnyGoals ? (
                <p className="text-sm text-muted-foreground">{networksEmptyMessage()}</p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-lg border">
                    <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,0.7fr))_auto] gap-2 px-2 py-2 text-[10px] uppercase tracking-wide text-muted-foreground bg-slate-50 border-b min-w-[560px]">
                      <span>Network</span>
                      <span>Revenue</span>
                      <span>Testing</span>
                      <span>Working</span>
                      <span>GEOs</span>
                      <span>Overrides</span>
                      <span>Actions</span>
                    </div>
                    <div className="min-w-[560px]">
                      {(allocation?.networks ?? []).map((row) => {
                        const key = row.affiliateNetworkName;
                        return (
                          <NetworkRow
                            key={key}
                            row={row}
                            expanded={expandedKey === key}
                            onToggle={() => setExpandedKey((prev) => (prev === key ? null : key))}
                            onEdit={(net) => onEditPlan(worker, net)}
                          />
                        );
                      })}
                      {unallocatedRow && (
                        <NetworkRow
                          row={unallocatedRow}
                          expanded={false}
                          onToggle={() => {}}
                          onEdit={(net) => onEditPlan(worker, net)}
                          isWorkerWide
                        />
                      )}
                    </div>
                  </div>
                  {unallocatedRow && (
                    <p className="text-sm text-muted-foreground">{allocation!.workerWideUnallocated!.message}</p>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="geos" className="mt-0">
              {(allocation?.geos.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">{geosEmptyMessage()}</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs min-w-[520px]">
                    <thead className="bg-slate-50 text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium">GEO</th>
                        <th className="px-2 py-2 text-left font-medium">Network</th>
                        <th className="px-2 py-2 text-left font-medium">Revenue</th>
                        <th className="px-2 py-2 text-left font-medium">Testing</th>
                        <th className="px-2 py-2 text-left font-medium">Working</th>
                        <th className="px-2 py-2 text-left font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(allocation?.geos ?? []).map((row) => {
                        const sources = [row.revenueSource, row.testingSource, row.workingSource].filter(
                          (s) => s && s !== "none",
                        );
                        const primary =
                          sources.includes("custom") || sources.includes("custom-zero")
                            ? sources.find((s) => s === "custom-zero" || s === "custom")
                            : sources[0];
                        return (
                          <tr key={`${row.geoCode}-${row.affiliateNetworkName}`} className="border-t">
                            <td className="px-2 py-2 font-medium">{row.geoCode}</td>
                            <td className="px-2 py-2 break-words max-w-[140px]" title={row.affiliateNetworkName}>
                              {row.affiliateNetworkName}
                            </td>
                            <td className="px-2 py-2">{formatAllocationMetric("revenue", row.revenueTarget)}</td>
                            <td className="px-2 py-2">
                              {formatAllocationMetric("testingBatches", row.testingTarget)}
                            </td>
                            <td className="px-2 py-2">
                              {formatAllocationMetric("workingCampaigns", row.workingTarget)}
                            </td>
                            <td className="px-2 py-2">
                              <GeoSourceBadge source={primary} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <Button className="w-full mt-4" onClick={() => onEditPlan(worker)}>
            <Pencil size={14} className="mr-2" />
            Edit Plan
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
