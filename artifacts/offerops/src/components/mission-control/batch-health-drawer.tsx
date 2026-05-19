import { Link } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { RecommendationBadge } from "@/components/mission-control/recommendation-badge";
import type { BatchHealthResponse } from "@/lib/batch-health-api";
import { formatRelativeTime, formatWhenShort } from "@/lib/mission-control-format";
import {
  HEALTH_STATE_STYLES,
  deriveMissionControlHealthState,
} from "@/lib/mission-control-health";
import { batchStatusConfig } from "@/lib/batch-status";
import {
  ClipboardList,
  ExternalLink,
  History,
  Lightbulb,
  PlayCircle,
} from "lucide-react";

function PlatformPill({ label, status }: { label: string; status: string }) {
  const terminal = new Set(["completed", "failed", "skipped"]).has(status);
  const active = status === "active" || status === "pending";
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${
        terminal
          ? "border-muted bg-muted/40"
          : active
            ? "border-primary/30 bg-primary/5"
            : "border-border bg-card"
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <p className="mt-0.5 font-mono text-xs font-medium capitalize">{status}</p>
    </div>
  );
}

function DrawerSection({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: React.ElementType;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
        {count != null && (
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] normal-case">
            {count}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export type BatchHealthDrawerProps = {
  batchId: number | null;
  batchName?: string;
  health: BatchHealthResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BatchHealthDrawer({
  batchId,
  batchName,
  health,
  isLoading,
  isError,
  open,
  onOpenChange,
}: BatchHealthDrawerProps) {
  const overall = health
    ? deriveMissionControlHealthState(health.recommendations)
    : "healthy";
  const styles = HEALTH_STATE_STYLES[overall];
  const statusCfg = health ? batchStatusConfig(health.batch.status) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5 text-left">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-lg">
                {batchName ?? health?.batch.batchName ?? "Batch health"}
              </SheetTitle>
              <SheetDescription className="mt-1">
                Operational snapshot · read-only
              </SheetDescription>
            </div>
            {!isLoading && health && (
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${styles.badge}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                {styles.label}
              </span>
            )}
          </div>
          {statusCfg && health && (
            <p className="mt-2 text-xs text-muted-foreground">
              Lifecycle: <span className="font-medium text-foreground">{statusCfg.label}</span>
              {" · "}
              Step {health.batch.trafficSourceStep}
            </p>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          {isLoading && (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {isError && (
            <p className="text-sm text-destructive">Could not load batch health.</p>
          )}

          {!isLoading && health && (
            <div className="space-y-6 pb-6">
              <DrawerSection title="Run state" icon={PlayCircle}>
                {health.activeRun ? (
                  <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="font-medium">{health.activeRun.trafficSourceName}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        #{health.activeRun.runId} · pos {health.activeRun.position}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <PlatformPill label="iOS" status={health.activeRun.iosStatus} />
                      <PlatformPill label="Android" status={health.activeRun.androidStatus} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span title={formatWhenShort(health.activeRun.startedAt)}>
                        Started {formatRelativeTime(health.activeRun.startedAt)}
                      </span>
                      <span title={formatWhenShort(health.activeRun.completedAt)}>
                        Completed {formatRelativeTime(health.activeRun.completedAt)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <EmptyBlock message="No active traffic source run for this batch." />
                )}
              </DrawerSection>

              <Separator />

              <DrawerSection title="Tasks" icon={ClipboardList} count={health.openTasks.length}>
                {health.openTasks.length === 0 ? (
                  <EmptyBlock message="No open tasks — nothing queued for operators on this batch." />
                ) : (
                  <ul className="space-y-2">
                    {health.openTasks.map((task) => (
                      <li
                        key={task.id}
                        className="rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <p className="font-medium leading-snug">{task.title}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {task.taskType} · {task.status}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </DrawerSection>

              <Separator />

              <DrawerSection title="Events" icon={History}>
                {health.recentEvents.length === 0 ? (
                  <EmptyBlock message="No recent operational events recorded for this batch." />
                ) : (
                  <ul className="space-y-2">
                    {health.recentEvents.slice(0, 12).map((event) => (
                      <li
                        key={event.id}
                        className="flex gap-2 border-l-2 border-muted pl-3 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[11px] font-semibold text-foreground">
                            {event.eventType}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {event.entityType}/{event.entityId} · {event.source}
                          </p>
                        </div>
                        <time
                          className="shrink-0 text-[10px] text-muted-foreground"
                          title={formatWhenShort(event.createdAt)}
                        >
                          {formatRelativeTime(event.createdAt)}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </DrawerSection>

              <Separator />

              <DrawerSection title="Recommendations" icon={Lightbulb} count={health.recommendations.length}>
                {health.recommendations.length === 0 ? (
                  <EmptyBlock message="No recommendations available." />
                ) : (
                  <ul className="space-y-2">
                    {health.recommendations.map((rec) => (
                      <li
                        key={rec.code}
                        className="rounded-lg border border-border bg-card px-3 py-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <RecommendationBadge rec={rec} />
                          {rec.suggestedActionType && (
                            <Badge variant="secondary" className="font-mono text-[10px]">
                              {rec.suggestedActionType}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1.5 text-sm text-foreground/90">{rec.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </DrawerSection>
            </div>
          )}
        </ScrollArea>

        {batchId != null && (
          <div className="border-t px-6 py-4">
            <Button variant="outline" className="w-full gap-2" asChild>
              <Link href={`/testing-batches/${batchId}`}>
                <ExternalLink className="h-4 w-4" />
                Open batch detail
              </Link>
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
