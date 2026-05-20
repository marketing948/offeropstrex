import { memo } from "react";
import { ChevronRight } from "lucide-react";
import { RecommendationBadge } from "@/components/mission-control/recommendation-badge";
import { BatchListRowSkeleton } from "@/components/mission-control/batch-list-row-skeleton";
import {
  HEALTH_STATE_STYLES,
  activeRunStatusLabel,
  badgeRecommendations,
  currentTrafficSourceLabel,
  hasOverdueOpenTasks,
  isStuckTerminalRun,
  recommendationSummary,
  type MissionControlRowInput,
} from "@/lib/mission-control-health";
import { cn } from "@/lib/utils";
import { batchStatusConfig } from "@/lib/batch-status";

export type BatchListRowProps = {
  row: MissionControlRowInput;
  selected: boolean;
  isRefreshing?: boolean;
  onSelect: () => void;
};

export const BatchListRow = memo(function BatchListRow({
  row,
  selected,
  isRefreshing,
  onSelect,
}: BatchListRowProps) {
  const { batch, health, healthState, healthLoading, healthError } = row;
  const showSkeleton = healthLoading && !health;

  if (showSkeleton) {
    return <BatchListRowSkeleton />;
  }

  const styles = HEALTH_STATE_STYLES[healthState];
  const statusCfg = batchStatusConfig(batch.status);
  const badges = health ? badgeRecommendations(health.recommendations) : [];
  const overdue = hasOverdueOpenTasks(health);
  const stuck = isStuckTerminalRun(health);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "min-h-[7.75rem] w-full rounded-xl border px-4 py-3 text-left transition-all hover:shadow-sm",
        selected ? `ring-2 ${styles.ring} border-primary/40 bg-card` : "border-border bg-card hover:border-primary/25",
        healthState === "critical" && !selected && "border-red-200/80",
        stuck && !selected && "border-amber-300/80",
        isRefreshing && "opacity-80",
      )}
    >
      <div className="flex h-full items-start gap-3">
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
            <span className="truncate">
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
            <span className="truncate sm:col-span-2">
              Run:{" "}
              <span className="font-medium text-foreground">{activeRunStatusLabel(health)}</span>
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="truncate text-xs text-muted-foreground">
              {health ? recommendationSummary(health.recommendations) : "—"}
            </span>
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {health?.flags.openTaskCount ?? "—"} open
            </span>
            {healthError && (
              <span className="shrink-0 rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                Health unavailable
              </span>
            )}
            {overdue && (
              <span className="shrink-0 rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">
                Overdue
              </span>
            )}
            {stuck && (
              <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                Ready to advance
              </span>
            )}
          </div>

          {badges.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {badges.map((rec) => (
                <RecommendationBadge key={rec.code} rec={rec} />
              ))}
            </div>
          )}
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </button>
  );
});
