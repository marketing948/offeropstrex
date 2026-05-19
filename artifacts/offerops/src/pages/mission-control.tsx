/**
 * Mission Control — operational dashboard at /ops.
 * Read-only situational awareness using batch list + per-batch health API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useListTestingBatches,
  getListTestingBatchesQueryKey,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import {
  fetchBatchHealth,
  getBatchHealthQueryKey,
  type BatchHealthResponse,
} from "@/lib/batch-health-api";
import {
  HEALTH_SEVERITY_ICON,
  buildMissionControlRows,
  compareHealthStates,
  matchesMissionControlFilter,
  type MissionControlFilter,
  type MissionControlRowInput,
} from "@/lib/mission-control-health";
import {
  loadMissionControlPrefs,
  saveMissionControlPrefs,
} from "@/lib/mission-control-storage";
import { BatchHealthDrawer } from "@/components/mission-control/batch-health-drawer";
import { BatchListRow } from "@/components/mission-control/batch-list-row";
import { BatchListRowSkeleton } from "@/components/mission-control/batch-list-row-skeleton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Activity, Loader2, Radio, RefreshCw } from "lucide-react";

const FILTER_OPTIONS: { key: MissionControlFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "critical", label: "Critical only" },
  { key: "openTasks", label: "Has open tasks" },
  { key: "needsRecovery", label: "Needs recovery" },
  { key: "recentlyUpdated", label: "Recently updated" },
  { key: "healthy", label: "Healthy" },
];

function SummaryPill({
  label,
  value,
  tone,
  icon: Icon,
  loading,
}: {
  label: string;
  value: number;
  tone: "critical" | "warning" | "healthy" | "neutral";
  icon: React.ElementType;
  loading?: boolean;
}) {
  const toneClass =
    tone === "critical"
      ? "border-red-200 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-100"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
        : tone === "healthy"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
          : "border-border bg-card text-foreground";
  return (
    <div className={`min-h-[5.25rem] rounded-xl border px-4 py-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</span>
        <Icon className="h-4 w-4 opacity-60" />
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-12" />
      ) : (
        <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
      )}
    </div>
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

  const [filter, setFilter] = useState<MissionControlFilter>(
    () => loadMissionControlPrefs().filter,
  );
  const [autoRefreshSec, setAutoRefreshSec] = useState(
    () => loadMissionControlPrefs().autoRefreshSec,
  );
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const refreshInFlight = useRef(false);

  const { healthByBatchId, healthMetaByBatchId } = useMemo(() => {
    const healthByBatchId = new Map<number, BatchHealthResponse | undefined>();
    const healthMetaByBatchId = new Map<number, { loading: boolean; error: boolean }>();
    batchList.forEach((batch, index) => {
      const q = healthQueries[index];
      healthByBatchId.set(batch.id, q?.data);
      healthMetaByBatchId.set(batch.id, {
        loading: q?.isLoading ?? false,
        error: q?.isError ?? false,
      });
    });
    return { healthByBatchId, healthMetaByBatchId };
  }, [batchList, healthQueries]);

  const rows: MissionControlRowInput[] = useMemo(
    () => buildMissionControlRows(batchList, healthByBatchId, healthMetaByBatchId),
    [batchList, healthByBatchId, healthMetaByBatchId],
  );

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const byHealth = compareHealthStates(a.healthState, b.healthState);
      if (byHealth !== 0) return byHealth;
      return a.batch.batchName.localeCompare(b.batch.batchName);
    });
  }, [rows]);

  const filteredRows = useMemo(
    () => sortedRows.filter((row) => matchesMissionControlFilter(row, filter)),
    [sortedRows, filter],
  );

  const filterCounts = useMemo(() => {
    const counts = Object.fromEntries(
      FILTER_OPTIONS.map((o) => [o.key, 0]),
    ) as Record<MissionControlFilter, number>;
    for (const row of rows) {
      for (const opt of FILTER_OPTIONS) {
        if (matchesMissionControlFilter(row, opt.key)) counts[opt.key] += 1;
      }
    }
    return counts;
  }, [rows]);

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

  const healthStillLoading = useMemo(
    () => healthQueries.some((q) => q.isLoading && !q.data),
    [healthQueries],
  );

  const isRefreshing =
    batchesFetching || healthQueries.some((q) => q.isFetching && !q.isLoading);

  const selectedRow = rows.find((r) => r.batch.id === selectedBatchId);
  const selectedQueryIndex = batchList.findIndex((b) => b.id === selectedBatchId);
  const selectedHealthQuery = selectedQueryIndex >= 0 ? healthQueries[selectedQueryIndex] : undefined;

  const refreshAll = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      await refetchBatches();
      await Promise.all(healthQueries.map((q) => q.refetch()));
    } finally {
      refreshInFlight.current = false;
    }
  }, [refetchBatches, healthQueries]);

  useEffect(() => {
    saveMissionControlPrefs({ filter, autoRefreshSec });
  }, [filter, autoRefreshSec]);

  useEffect(() => {
    if (autoRefreshSec <= 0) return;
    const id = window.setInterval(() => {
      void refreshAll();
    }, autoRefreshSec * 1000);
    return () => window.clearInterval(id);
  }, [autoRefreshSec, refreshAll]);

  const refetchSelectedHealth = useCallback(async () => {
    if (selectedHealthQuery) {
      await selectedHealthQuery.refetch();
    }
  }, [selectedHealthQuery]);

  const openDrawer = (batchId: number) => {
    setSelectedBatchId(batchId);
    setDrawerOpen(true);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-6xl flex-col gap-4 p-4 md:p-6">
        <header className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
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
          <div className="flex flex-wrap items-center gap-2 self-start">
            <Select
              value={String(autoRefreshSec)}
              onValueChange={(v) => setAutoRefreshSec(Number(v))}
            >
              <SelectTrigger className="h-9 w-[10.5rem] text-xs">
                <SelectValue placeholder="Auto refresh" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Auto refresh: Off</SelectItem>
                <SelectItem value="15">Every 15 seconds</SelectItem>
                <SelectItem value="30">Every 30 seconds</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => void refreshAll()}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
        </header>

        {isRefreshing && (
          <p className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Updating health data…
          </p>
        )}

        <div className="sticky top-0 z-20 -mx-4 shrink-0 border-b border-border/80 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryPill
              label="Total"
              value={counts.total}
              tone="neutral"
              icon={Activity}
              loading={batchesLoading}
            />
            <SummaryPill
              label="Critical"
              value={counts.critical}
              tone="critical"
              icon={HEALTH_SEVERITY_ICON.critical}
              loading={batchesLoading || healthStillLoading}
            />
            <SummaryPill
              label="Warning"
              value={counts.warning}
              tone="warning"
              icon={HEALTH_SEVERITY_ICON.warning}
              loading={batchesLoading || healthStillLoading}
            />
            <SummaryPill
              label="Healthy"
              value={counts.healthy}
              tone="healthy"
              icon={HEALTH_SEVERITY_ICON.healthy}
              loading={batchesLoading || healthStillLoading}
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {FILTER_OPTIONS.map(({ key, label }) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "default" : "outline"}
              onClick={() => setFilter(key)}
              className="gap-1.5"
            >
              {label}
              <span
                className={`rounded px-1 font-mono text-[10px] ${
                  filter === key ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
                }`}
              >
                {filterCounts[key]}
              </span>
            </Button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-muted/20 p-3">
          {batchesLoading && (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <BatchListRowSkeleton key={i} />
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
                  isRefreshing={isRefreshing && !!row.health}
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
          workspaceId={activeWorkspaceId}
          onHealthRefetch={refetchSelectedHealth}
        />
      </div>
    </TooltipProvider>
  );
}
