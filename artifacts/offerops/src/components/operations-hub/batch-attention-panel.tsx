/**
 * Compact batch health list — "what requires attention?" for Operations Hub.
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
import { Activity, AlertTriangle, Layers, Loader2, RefreshCw } from "lucide-react";
import { OperationalEmpty } from "@/components/operational-state/operational-empty";
import { OperationalError } from "@/components/operational-state/operational-error";

const FILTER_OPTIONS: { key: MissionControlFilter; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "critical", label: "Critical" },
  { key: "openTasks", label: "Open tasks" },
  { key: "all", label: "All batches" },
];

export function BatchAttentionPanel() {
  const { activeWorkspaceId } = useWorkspace();
  const batchParams = { workspace_id: activeWorkspaceId ?? 0 };
  const {
    data: batches,
    isLoading: batchesLoading,
    isError: batchesError,
    error: batchesLoadError,
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

  const attentionSummary = useMemo(() => {
    const critical = rows.filter((row) => row.healthState === "critical").length;
    const needsAttention = rows.filter((row) => row.healthState !== "healthy").length;
    const openTasks = rows.filter(
      (row) => (row.health?.flags.openTaskCount ?? 0) > 0,
    ).length;
    return { critical, needsAttention, openTasks };
  }, [rows]);

  const isRefreshing =
    batchesFetching || healthQueries.some((q) => q.isFetching && !q.isLoading);

  const selectedRow = rows.find((r) => r.batch.id === selectedBatchId);
  const selectedQueryIndex = batchList.findIndex((b) => b.id === selectedBatchId);
  const selectedHealthQuery =
    selectedQueryIndex >= 0 ? healthQueries[selectedQueryIndex] : undefined;

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

  return (
    <div className="space-y-3">
      {!batchesLoading && !batchesError && (
        <div
          className={`grid gap-2 sm:grid-cols-3 ${
            attentionSummary.critical > 0 || attentionSummary.needsAttention > 0
              ? "rounded-xl border-2 border-red-300/70 bg-red-50/50 p-3 dark:border-red-900/50 dark:bg-red-950/20"
              : "rounded-xl border border-border bg-card p-3"
          }`}
        >
          <div className="flex items-center gap-2 rounded-lg bg-background/80 px-3 py-2">
            <AlertTriangle
              className={`h-4 w-4 shrink-0 ${
                attentionSummary.critical > 0 ? "text-red-600" : "text-muted-foreground"
              }`}
            />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Critical
              </p>
              <p className="text-lg font-bold tabular-nums">{attentionSummary.critical}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-background/80 px-3 py-2">
            <Activity
              className={`h-4 w-4 shrink-0 ${
                attentionSummary.needsAttention > 0 ? "text-amber-600" : "text-muted-foreground"
              }`}
            />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Needs attention
              </p>
              <p className="text-lg font-bold tabular-nums">{attentionSummary.needsAttention}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-background/80 px-3 py-2">
            <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Open tasks
              </p>
              <p className="text-lg font-bold tabular-nums">{attentionSummary.openTasks}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTER_OPTIONS.map(({ key, label }) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={String(autoRefreshSec)}
            onValueChange={(v) => setAutoRefreshSec(Number(v))}
          >
            <SelectTrigger className="h-8 w-[9.5rem] text-xs">
              <SelectValue placeholder="Auto refresh" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Refresh: Off</SelectItem>
              <SelectItem value="30">Every 30s</SelectItem>
              <SelectItem value="60">Every 60s</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => void refreshAll()}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <div className="max-h-[min(28rem,50vh)] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-muted/15 p-2">
        {batchesLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <BatchListRowSkeleton key={i} />
            ))}
          </div>
        )}
        {batchesError && !batchesLoading && (
          <OperationalError
            title="Couldn't load testing batches"
            error={batchesLoadError}
            onRetry={() => void refetchBatches()}
            retrying={batchesFetching}
          />
        )}
        {!batchesLoading && !batchesError && filteredRows.length === 0 && (
          <OperationalEmpty
            icon={filter === "attention" ? Activity : Layers}
            title={
              filter === "attention"
                ? "No batches need attention"
                : "No batches match this filter"
            }
            description="Switch filters or refresh after new testing work starts."
            compact
          />
        )}
        {!batchesLoading && !batchesError && filteredRows.length > 0 && (
          <div className="space-y-2">
            {filteredRows.slice(0, 12).map((row) => (
              <BatchListRow
                key={row.batch.id}
                row={row}
                selected={selectedBatchId === row.batch.id && drawerOpen}
                isRefreshing={isRefreshing && !!row.health}
                onSelect={() => {
                  setSelectedBatchId(row.batch.id);
                  setDrawerOpen(true);
                }}
              />
            ))}
            {filteredRows.length > 12 && (
              <p className="py-2 text-center text-xs text-muted-foreground">
                +{filteredRows.length - 12} more — open Batches for full list
              </p>
            )}
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
  );
}
