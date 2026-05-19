/**
 * Mission Control — Phase 1 operational dashboard at /ops.
 * Read-only situational awareness using batch list + per-batch health API.
 */

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useListTestingBatches,
  getListTestingBatchesQueryKey,
  type TestingBatch,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import {
  fetchBatchHealth,
  getBatchHealthQueryKey,
  type BatchHealthResponse,
} from "@/lib/batch-health-api";
import {
  HEALTH_STATE_STYLES,
  RECOMMENDATION_LABELS,
  activeRunStatusLabel,
  badgeRecommendations,
  compareHealthStates,
  currentTrafficSourceLabel,
  deriveMissionControlHealthState,
  recommendationSummary,
  type MissionControlHealthState,
} from "@/lib/mission-control-health";
import { batchStatusConfig } from "@/lib/batch-status";
import { BatchHealthDrawer } from "@/components/mission-control/batch-health-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  Radio,
} from "lucide-react";

type AttentionFilter = "all" | "attention" | "healthy";

type BatchRowModel = {
  batch: TestingBatch;
  health: BatchHealthResponse | undefined;
  healthState: MissionControlHealthState;
  healthLoading: boolean;
  healthError: boolean;
};

function SummaryPill({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: MissionControlHealthState | "neutral";
  icon: React.ElementType;
}) {
  const toneClass =
    tone === "critical"
      ? "border-red-200 bg-red-50 text-red-900"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : tone === "healthy"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-border bg-card text-foreground";
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</span>
        <Icon className="h-4 w-4 opacity-60" />
      </div>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
    </div>
  );
}

function BatchListRow({
  row,
  selected,
  onSelect,
}: {
  row: BatchRowModel;
  selected: boolean;
  onSelect: () => void;
}) {
  const { batch, health, healthState, healthLoading } = row;
  const styles = HEALTH_STATE_STYLES[healthState];
  const statusCfg = batchStatusConfig(batch.status);
  const badges = health ? badgeRecommendations(health.recommendations) : [];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border px-4 py-3 text-left transition-all hover:shadow-sm ${
        selected
          ? `ring-2 ${styles.ring} border-primary/40 bg-card`
          : "border-border bg-card hover:border-primary/25"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${styles.dot}`}
          title={styles.label}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-foreground">{batch.batchName}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusCfg.bg} ${statusCfg.text}`}
            >
              <span className={`h-1 w-1 rounded-full ${statusCfg.dot}`} />
              {statusCfg.short}
            </span>
          </div>

          <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <span>
              Source:{" "}
              <span className="font-medium text-foreground">
                {currentTrafficSourceLabel(batch.trafficSourceName ?? batch.trafficSource, health)}
              </span>
            </span>
            <span>
              Step:{" "}
              <span className="font-medium text-foreground">
                {health?.batch.trafficSourceStep ?? "—"}
              </span>
            </span>
            <span className="sm:col-span-2">
              Run:{" "}
              <span className="font-medium text-foreground">
                {healthLoading ? "Loading…" : activeRunStatusLabel(health)}
              </span>
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {healthLoading ? "…" : health ? recommendationSummary(health.recommendations) : "—"}
            </span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {health?.flags.openTaskCount ?? "—"} open
            </span>
          </div>

          {badges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {badges.map((rec) => (
                <Badge
                  key={rec.code}
                  variant="outline"
                  className={`text-[10px] font-medium ${
                    rec.severity === "critical"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : rec.severity === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  {RECOMMENDATION_LABELS[rec.code]}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </button>
  );
}

export default function MissionControl() {
  const { activeWorkspaceId } = useWorkspace();
  const batchParams = { workspace_id: activeWorkspaceId ?? 0 };
  const {
    data: batches,
    isLoading: batchesLoading,
    refetch: refetchBatches,
    isFetching: batchesFetching,
  } = useListTestingBatches(
    batchParams,
    wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(batchParams), {
      staleTime: 30_000,
    }),
  );

  const batchList = batches ?? [];
  const healthQueries = useQueries({
    queries: batchList.map((batch) => ({
      queryKey: getBatchHealthQueryKey(batch.id),
      queryFn: () => fetchBatchHealth(batch.id),
      enabled: !!activeWorkspaceId,
      staleTime: 30_000,
    })),
  });

  const [filter, setFilter] = useState<AttentionFilter>("all");
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const rows: BatchRowModel[] = useMemo(() => {
    return batchList.map((batch, index) => {
      const q = healthQueries[index];
      const health = q?.data;
      const healthState = health
        ? deriveMissionControlHealthState(health.recommendations)
        : "healthy";
      return {
        batch,
        health,
        healthState,
        healthLoading: q?.isLoading ?? false,
        healthError: q?.isError ?? false,
      };
    });
  }, [batchList, healthQueries]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const byHealth = compareHealthStates(a.healthState, b.healthState);
      if (byHealth !== 0) return byHealth;
      return a.batch.batchName.localeCompare(b.batch.batchName);
    });
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "attention") {
      return sortedRows.filter((r) => r.healthState !== "healthy");
    }
    if (filter === "healthy") {
      return sortedRows.filter((r) => r.healthState === "healthy");
    }
    return sortedRows;
  }, [sortedRows, filter]);

  const counts = useMemo(() => {
    let critical = 0;
    let warning = 0;
    let healthy = 0;
    for (const row of rows) {
      if (row.healthState === "critical") critical += 1;
      else if (row.healthState === "warning") warning += 1;
      else healthy += 1;
    }
    return { critical, warning, healthy, total: rows.length };
  }, [rows]);

  const selectedRow = rows.find((r) => r.batch.id === selectedBatchId);
  const selectedQueryIndex = batchList.findIndex((b) => b.id === selectedBatchId);
  const selectedHealthQuery = selectedQueryIndex >= 0 ? healthQueries[selectedQueryIndex] : undefined;

  const openDrawer = (batchId: number) => {
    setSelectedBatchId(batchId);
    setDrawerOpen(true);
  };

  const refreshAll = () => {
    void refetchBatches();
    for (const q of healthQueries) {
      void q.refetch();
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Radio className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-widest">Mission Control</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">Operations</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Live batch health across the workspace. Click a batch for run details, tasks, and events.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 self-start"
          onClick={refreshAll}
          disabled={batchesFetching}
        >
          <RefreshCw className={`h-4 w-4 ${batchesFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryPill label="Batches" value={counts.total} tone="neutral" icon={Activity} />
        <SummaryPill label="Critical" value={counts.critical} tone="critical" icon={AlertTriangle} />
        <SummaryPill label="Warning" value={counts.warning} tone="warning" icon={AlertTriangle} />
        <SummaryPill label="Healthy" value={counts.healthy} tone="healthy" icon={CheckCircle2} />
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["attention", "Needs attention"],
            ["healthy", "Healthy"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-muted/20 p-3">
        {batchesLoading && (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        )}

        {!batchesLoading && filteredRows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Activity className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium text-foreground">No batches in this view</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filter === "all"
                ? "Create a testing batch to see operational health here."
                : "Try another filter."}
            </p>
          </div>
        )}

        {!batchesLoading && filteredRows.length > 0 && (
          <div className="space-y-2">
            {filteredRows.map((row) => (
              <BatchListRow
                key={row.batch.id}
                row={row}
                selected={selectedBatchId === row.batch.id && drawerOpen}
                onSelect={() => openDrawer(row.batch.id)}
              />
            ))}
          </div>
        )}
      </div>

      <BatchHealthDrawer
        batchId={selectedBatchId}
        batchName={selectedRow?.batch.batchName}
        health={selectedHealthQuery?.data}
        isLoading={selectedHealthQuery?.isLoading ?? false}
        isError={selectedHealthQuery?.isError ?? false}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
