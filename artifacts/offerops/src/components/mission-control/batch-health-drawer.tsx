import { Link } from "wouter";
import {
  useListCampaigns,
  getListCampaignsQueryKey,
  type Campaign,
} from "@workspace/api-client-react";
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
import { BatchHealthDrawerRecovery } from "@/components/mission-control/batch-health-drawer-recovery";
import { CopyButton } from "@/components/mission-control/copy-button";
import { RecommendationBadge } from "@/components/mission-control/recommendation-badge";
import { useAuth } from "@/lib/auth";
import type { BatchHealthOpenTask, BatchHealthResponse } from "@/lib/batch-health-api";
import { formatRelativeTime, formatWhenShort } from "@/lib/mission-control-format";
import {
  HEALTH_STATE_STYLES,
  deriveMissionControlHealthState,
  hasCriticalRecommendations,
  isOverdueOpenTask,
  isStuckTerminalRun,
} from "@/lib/mission-control-health";
import { batchStatusConfig } from "@/lib/batch-status";
import { wsQueryOpts } from "@/lib/ws-query";
import { cn } from "@/lib/utils";
import {
  ClipboardList,
  ExternalLink,
  History,
  Lightbulb,
  Link2,
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

function externalHref(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const u = url.trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return null;
}

function campaignById(campaigns: Campaign[] | undefined): Map<number, Campaign> {
  const map = new Map<number, Campaign>();
  for (const c of campaigns ?? []) map.set(c.id, c);
  return map;
}

function QuickLinkButton({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  if (external) {
    return (
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
        <a href={href} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-3 w-3" />
          {children}
        </a>
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
      <Link href={href}>
        <ExternalLink className="h-3 w-3" />
        {children}
      </Link>
    </Button>
  );
}

function TaskRow({
  batchId,
  task,
  campaign,
}: {
  batchId: number;
  task: BatchHealthOpenTask;
  campaign: Campaign | undefined;
}) {
  const overdue = isOverdueOpenTask(task);
  const voluumHref = externalHref(campaign?.campaignUrl);

  return (
    <li
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        overdue
          ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30"
          : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{task.title}</p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {task.taskType} · {task.status}
            {overdue && (
              <span className="ml-2 font-semibold text-red-700 dark:text-red-300">· Overdue</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <CopyButton value={String(task.id)} label="task id" />
          <QuickLinkButton href={`/tasks?open=${task.id}`}>Task</QuickLinkButton>
          {task.relatedCampaignId != null && (
            <QuickLinkButton href={`/testing-batches/${batchId}`}>Campaign</QuickLinkButton>
          )}
          {voluumHref && <QuickLinkButton href={voluumHref} external>Voluum</QuickLinkButton>}
        </div>
      </div>
    </li>
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
  workspaceId: number | null;
  onHealthRefetch?: () => Promise<unknown>;
};

export function BatchHealthDrawer({
  batchId,
  batchName,
  health,
  isLoading,
  isError,
  open,
  onOpenChange,
  workspaceId,
  onHealthRefetch,
}: BatchHealthDrawerProps) {
  const { currentEmployee } = useAuth();
  const isAdmin = currentEmployee?.role === "admin";

  const overall = health
    ? deriveMissionControlHealthState(health.recommendations)
    : "healthy";
  const styles = HEALTH_STATE_STYLES[overall];
  const statusCfg = health ? batchStatusConfig(health.batch.status) : null;
  const stuckRun = isStuckTerminalRun(health);
  const criticalRecs = hasCriticalRecommendations(health);

  const campaignParams =
    batchId != null && workspaceId
      ? { workspace_id: workspaceId, batch_id: batchId }
      : { workspace_id: 0 };

  const { data: campaigns } = useListCampaigns(
    campaignParams,
    wsQueryOpts(workspaceId, getListCampaignsQueryKey(campaignParams), {
      enabled: open && batchId != null && !!workspaceId,
      staleTime: 60_000,
    }),
  );

  const campaignsById = campaignById(campaigns);

  const displayName = batchName ?? health?.batch.batchName ?? "Batch health";
  const trafficSourceId =
    health?.activeRun?.trafficSourceId ?? health?.batch.currentWorkspaceTrafficSourceId;

  const relatedCampaignIds = new Set<number>();
  for (const task of health?.openTasks ?? []) {
    if (task.relatedCampaignId != null) relatedCampaignIds.add(task.relatedCampaignId);
  }
  if (health?.activeRun?.iosCampaignId) relatedCampaignIds.add(health.activeRun.iosCampaignId);
  if (health?.activeRun?.androidCampaignId) relatedCampaignIds.add(health.activeRun.androidCampaignId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader
          className={cn(
            "border-b px-6 py-5 text-left",
            criticalRecs && "border-red-200 bg-red-50/30 dark:border-red-900 dark:bg-red-950/20",
          )}
        >
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <SheetTitle className="truncate text-lg">{displayName}</SheetTitle>
                <CopyButton value={displayName} label="batch name" />
              </div>
              <SheetDescription className="mt-1">
                Operational snapshot
                {batchId != null && (
                  <span className="ml-1 font-mono text-[10px]">#{batchId}</span>
                )}
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

          {!isLoading && health && batchId != null && (
            <div className="space-y-6 pb-6">
              <DrawerSection title="Quick links" icon={Link2}>
                <div className="flex flex-wrap gap-2">
                  <QuickLinkButton href={`/testing-batches/${batchId}`}>Batch detail</QuickLinkButton>
                  {health.openTasks.length > 0 && (
                    <QuickLinkButton href={`/tasks?open=${health.openTasks[0]!.id}`}>
                      First open task
                    </QuickLinkButton>
                  )}
                  {[...relatedCampaignIds].slice(0, 4).map((cid) => {
                    const c = campaignsById.get(cid);
                    const voluumHref = externalHref(c?.campaignUrl);
                    return (
                      <span key={cid} className="inline-flex items-center gap-0.5">
                        <QuickLinkButton href={`/testing-batches/${batchId}`}>
                          {c?.campaignName ? c.campaignName.slice(0, 18) : `Campaign #${cid}`}
                        </QuickLinkButton>
                        {voluumHref && (
                          <QuickLinkButton href={voluumHref} external>
                            Voluum
                          </QuickLinkButton>
                        )}
                      </span>
                    );
                  })}
                </div>
                {trafficSourceId != null && (
                  <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                    Traffic source id {trafficSourceId}
                    <CopyButton value={String(trafficSourceId)} label="traffic source id" />
                    {health.activeRun?.trafficSourceName && (
                      <>
                        <span className="mx-1">·</span>
                        {health.activeRun.trafficSourceName}
                        <CopyButton
                          value={health.activeRun.trafficSourceName}
                          label="traffic source name"
                        />
                      </>
                    )}
                  </p>
                )}
              </DrawerSection>

              <Separator />

              <DrawerSection title="Run state" icon={PlayCircle}>
                {health.activeRun ? (
                  <div
                    className={cn(
                      "space-y-3 rounded-lg border bg-muted/20 p-3",
                      stuckRun && "border-amber-400 ring-1 ring-amber-400/40",
                    )}
                  >
                    {stuckRun && (
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                        Both platforms are terminal but the batch has not advanced.
                      </p>
                    )}
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
                      <TaskRow
                        key={task.id}
                        batchId={batchId}
                        task={task}
                        campaign={
                          task.relatedCampaignId != null
                            ? campaignsById.get(task.relatedCampaignId)
                            : undefined
                        }
                      />
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
                        className={cn(
                          "rounded-lg border bg-card px-3 py-2.5",
                          rec.severity === "critical"
                            ? "border-red-300 bg-red-50/40 dark:border-red-900 dark:bg-red-950/25"
                            : "border-border",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <RecommendationBadge rec={rec} />
                          <CopyButton value={rec.code} label="recommendation code" />
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

              {isAdmin && onHealthRefetch && (
                <>
                  <Separator />
                  <BatchHealthDrawerRecovery batchId={batchId} onSuccess={onHealthRefetch} />
                </>
              )}
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
