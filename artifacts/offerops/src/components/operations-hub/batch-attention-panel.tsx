/**
 * Compact batch health list — "what requires attention?" from Mission Control.
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
import { Activity, Loader2, RefreshCw } from "lucide-react";

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
        {!batchesLoading && filteredRows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Activity className="mb-2 h-8 w-8 text-muted-foreground/35" />
            <p className="text-sm font-medium">Nothing needs attention</p>
            <p className="mt-1 text-xs text-muted-foreground">Try another filter.</p>
          </div>
        )}
        {!batchesLoading && filteredRows.length > 0 && (
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
