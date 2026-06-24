import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InitialsBadge } from "@/components/performance-engine/initials-badge";
import { formatMonthLabel, type WorkerMonthlyRow } from "@/lib/performance-engine/api";
import {
  formatAllocationMetric,
  summarizeWorkerGoalAllocation,
  type GoalMetric,
  type WorkerGoalGeoSplitRow,
  type WorkerGoalNetworkRow,
} from "@/lib/performance-engine/goal-plan-utils";
import type { WorkerGoalTarget } from "@/lib/worker-goals";
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

function ScopeBadge({
  kind,
  inferredFromSummary,
}: {
  kind: "worker-wide" | "network";
  inferredFromSummary?: boolean;
}) {
  const workerLabel = inferredFromSummary ? "Worker-wide · Existing goal" : "Worker-wide";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        kind === "worker-wide"
          ? "bg-slate-100 text-slate-700"
          : "bg-indigo-50 text-indigo-700"
      }`}
    >
      {kind === "worker-wide" ? workerLabel : "Network goal"}
    </span>
  );
}

function SourceBadge({
  source,
  explicitZero,
}: {
  source?: "inherited" | "custom";
  explicitZero?: boolean;
}) {
  if (!source) return <span className="text-muted-foreground">—</span>;
  if (source === "custom" && explicitZero) {
    return (
      <span className="rounded bg-amber-50 text-amber-800 px-1.5 py-0.5 text-[10px] font-medium">
        Custom · 0
      </span>
    );
  }
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        source === "custom" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"
      }`}
    >
      {source === "custom" ? "Custom" : "Inherited"}
    </span>
  );
}

function formatNetworkCell(metric: GoalMetric, value: number | null): string {
  if (value == null) return "—";
  return formatAllocationMetric(metric, value);
}

function geoSplitHasMetric(rows: WorkerGoalGeoSplitRow[], metric: GoalMetric): boolean {
  const key =
    metric === "revenue" ? "revenueTarget" : metric === "testingBatches" ? "testingTarget" : "workingTarget";
  const sourceKey =
    metric === "revenue" ? "revenueSource" : metric === "testingBatches" ? "testingSource" : "workingSource";
  return rows.some((r) => r[key] != null || r[sourceKey] != null);
}

function GeoSplitTable({ rows }: { rows: WorkerGoalGeoSplitRow[] }) {
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
            const sources = [row.revenueSource, row.testingSource, row.workingSource].filter(Boolean);
            const primarySource = sources.includes("custom") ? "custom" : sources[0];
            const explicitZero =
              (row.revenueSource === "custom" && row.revenueTarget === 0) ||
              (row.testingSource === "custom" && row.testingTarget === 0) ||
              (row.workingSource === "custom" && row.workingTarget === 0);
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
                  <SourceBadge source={primarySource} explicitZero={explicitZero} />
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
}: {
  row: WorkerGoalNetworkRow;
  expanded: boolean;
  onToggle: () => void;
  onEdit: (networkName: string | null) => void;
}) {
  const label = row.isWorkerWide ? "Worker-wide" : row.networkName ?? "—";
  const canExpand = !row.isWorkerWide && row.geoSplitRows.length > 0;
  const noGeoScope =
    !row.isWorkerWide &&
    row.selectedGeoCodes.length === 0 &&
    (row.revenueTarget != null || row.testingTarget != null || row.workingTarget != null);

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
            <ScopeBadge
              kind={row.isWorkerWide ? "worker-wide" : "network"}
              inferredFromSummary={row.inferredFromSummary}
            />
          </div>
        </div>
        <span>{formatNetworkCell("revenue", row.revenueTarget)}</span>
        <span>{formatNetworkCell("testingBatches", row.testingTarget)}</span>
        <span>{formatNetworkCell("workingCampaigns", row.workingTarget)}</span>
        <span>{row.isWorkerWide ? "—" : row.selectedGeoCodes.length || "—"}</span>
        <span>{row.isWorkerWide ? "—" : row.overrideCount || "—"}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(row.isWorkerWide ? null : row.networkName);
          }}
        >
          <Pencil size={12} className="mr-1" />
          Edit
        </Button>
      </div>
      {expanded && canExpand && <div className="px-2 pb-2"><GeoSplitTable rows={row.geoSplitRows} /></div>}
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
  monthKey,
  goals,
  open,
  onClose,
  onEditPlan,
}: {
  worker: WorkerMonthlyRow | null;
  monthKey: string;
  goals: WorkerGoalTarget[];
  open: boolean;
  onClose: () => void;
  onEditPlan: (worker: WorkerMonthlyRow, networkName?: string | null) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (!worker) return null;

  const allocation = summarizeWorkerGoalAllocation(goals, worker.employeeId, monthKey, {
    revenue: worker.revenue,
    testing: worker.testing,
    working: worker.working,
    xpEarned: worker.xpEarned,
  });
  const monthLabel = formatMonthLabel(monthKey);

  function networksEmptyMessage(): string {
    return `No monthly goals configured for ${worker!.name} in ${monthLabel}.`;
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
          <Tabs defaultValue="networks">
            <TabsList className="grid w-full grid-cols-3 h-9 mb-4">
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              <TabsTrigger value="networks" className="text-xs">Networks</TabsTrigger>
              <TabsTrigger value="geos" className="text-xs">GEOs</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 mt-0">
              <MetricSummaryCard
                label="Revenue"
                current={worker.revenue.current}
                target={worker.revenue.target}
                prefix="$"
              />
              <MetricSummaryCard
                label="Testing"
                current={worker.testing.current}
                target={worker.testing.target}
              />
              <MetricSummaryCard
                label="Working campaigns"
                current={worker.working.current}
                target={worker.working.target}
              />
              <div className="rounded-lg border bg-blue-50/60 border-blue-100 p-3 text-sm">
                XP earned: <strong>{worker.xpEarned.toLocaleString()} XP</strong>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-semibold">Configured allocation</p>
                {!allocation.counts.hasAnyGoals ? (
                  <p className="text-sm text-muted-foreground">
                    No monthly goals configured for {worker.name} in {monthLabel}.
                  </p>
                ) : (
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {allocation.counts.workerWideMetricLabels.length > 0 && (
                      <li>
                        Worker-wide goals: {allocation.counts.workerWideMetricLabels.join(", ")}
                      </li>
                    )}
                    <li>Networks: {allocation.counts.networkCount}</li>
                    <li>GEO targets: {allocation.counts.selectedGeoCount}</li>
                    <li>Custom overrides: {allocation.counts.overrideCount}</li>
                  </ul>
                )}
              </div>
            </TabsContent>

            <TabsContent value="networks" className="mt-0 space-y-3">
              {!allocation.counts.hasAnyGoals ? (
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
                      {allocation.workerWideRow && (
                        <NetworkRow
                          row={allocation.workerWideRow}
                          expanded={false}
                          onToggle={() => {}}
                          onEdit={(net) => onEditPlan(worker, net)}
                        />
                      )}
                      {allocation.networkRows.map((row) => {
                        const key = row.networkName ?? "";
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
                    </div>
                  </div>
                  {allocation.workerWideRow && allocation.networkRows.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Worker-wide goals are configured. No network-specific goals yet.
                    </p>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="geos" className="mt-0">
              {allocation.geoRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No GEO targets configured for this worker/month.
                </p>
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
                      {allocation.geoRows.map((row) => {
                        const sources = [row.revenueSource, row.testingSource, row.workingSource].filter(Boolean);
                        const primarySource = sources.includes("custom") ? "custom" : sources[0];
                        const explicitZero =
                          (row.revenueSource === "custom" && row.revenueTarget === 0) ||
                          (row.testingSource === "custom" && row.testingTarget === 0) ||
                          (row.workingSource === "custom" && row.workingTarget === 0);
                        return (
                          <tr key={`${row.geoCode}-${row.networkName}`} className="border-t">
                            <td className="px-2 py-2 font-medium">{row.geoCode}</td>
                            <td className="px-2 py-2 break-words max-w-[140px]" title={row.networkName}>
                              {row.networkName}
                            </td>
                            <td className="px-2 py-2">{formatAllocationMetric("revenue", row.revenueTarget)}</td>
                            <td className="px-2 py-2">
                              {formatAllocationMetric("testingBatches", row.testingTarget)}
                            </td>
                            <td className="px-2 py-2">
                              {formatAllocationMetric("workingCampaigns", row.workingTarget)}
                            </td>
                            <td className="px-2 py-2">
                              <SourceBadge source={primarySource} explicitZero={explicitZero} />
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
