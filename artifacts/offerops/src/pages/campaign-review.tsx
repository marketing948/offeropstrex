/**
 * Personal Campaign Review Queue — human-in-the-loop operational intelligence.
 * Separate from /live-campaigns (monitoring) and /tasks (execution).
 * Signals and health are UI heuristics; operational memory is client-side until API exists.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useListOffers,
  useListTestingBatches,
  getListOffersQueryKey,
  getListTestingBatchesQueryKey,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth";
import { useAlertRules } from "@/hooks/use-alert-rules";
import { authedJson } from "@/lib/api-fetch";
import {
  buildReviewQueueItem,
  type ReviewCampaignInput,
} from "@/lib/campaign-review/heuristics";
import {
  computeOperationalScore,
  getReviewEvents,
  isCampaignDismissed,
  markEscalatedIfNeeded,
  touchCampaignFirstSeen,
} from "@/lib/campaign-review/memory";
import type { ReviewQueueCampaign } from "@/lib/campaign-review/types";
import { ReviewDetailSheet } from "@/components/campaign-review/review-detail-sheet";
import { CampaignHealthBadge } from "@/components/campaign-review/health-badge";
import { OperationalEmpty } from "@/components/operational-state/operational-empty";
import { OperationalError } from "@/components/operational-state/operational-error";
import { QueueListSkeleton } from "@/components/operational-state/operational-skeletons";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardCheck, Gauge, Upload } from "lucide-react";
import { Link } from "wouter";

type LiveCampaignsApiResponse = {
  items: Array<{
    id: number;
    campaignName: string;
    batchId: number | null;
    batchName: string | null;
    employeeId?: number | null;
    employeeName: string | null;
    platform: string;
    campaignPurpose: string;
    status: string;
    liveStartedAt: string | null;
    clicks: number | null;
    conversions: number | null;
    revenue: string | null;
    cost: string | null;
    roi: string | null;
  }>;
};

export default function CampaignReviewPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { currentEmployee } = useAuth();
  const { rules } = useAlertRules();
  const wsId = activeWorkspaceId ?? 0;
  const isAdmin = currentEmployee?.role === "admin";
  const viewerId = currentEmployee?.id ?? 0;

  const [ownerFilter, setOwnerFilter] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  const [selected, setSelected] = useState<ReviewQueueCampaign | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [memoryTick, setMemoryTick] = useState(0);

  const wsParams = { workspace_id: wsId };

  const { data: batches = [] } = useListTestingBatches(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(wsParams)),
  );

  const { data: offers = [] } = useListOffers(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListOffersQueryKey(wsParams)),
  );

  const {
    data: campaignResponse,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<LiveCampaignsApiResponse>({
    queryKey: ["campaign-review-live", wsId],
    enabled: !!activeWorkspaceId,
    queryFn: () =>
      authedJson(`/api/live-campaigns?workspace_id=${wsId}&status=live&limit=400&offset=0`),
  });

  const offersPerBatch = useMemo(() => {
    const m = new Map<number, number>();
    for (const o of offers) {
      if (o.batchId == null) continue;
      m.set(o.batchId, (m.get(o.batchId) ?? 0) + 1);
    }
    return m;
  }, [offers]);

  const batchById = useMemo(() => {
    const m = new Map<number, (typeof batches)[0]>();
    for (const b of batches) m.set(b.id, b);
    return m;
  }, [batches]);

  const queue = useMemo(() => {
    void memoryTick;
    const items: ReviewQueueCampaign[] = [];
    const memoryActor = viewerId;

    for (const raw of campaignResponse?.items ?? []) {
      const batch = raw.batchId != null ? batchById.get(raw.batchId) : undefined;
      const ownerId = batch?.employeeId ?? raw.employeeId ?? null;
      if (ownerFilter === "mine" && ownerId !== viewerId) continue;
      if (isCampaignDismissed(wsId, memoryActor, raw.id)) continue;

      const input: ReviewCampaignInput = {
        id: raw.id,
        campaignName: raw.campaignName,
        batchId: raw.batchId,
        batchName: raw.batchName ?? batch?.batchName ?? null,
        employeeId: ownerId,
        employeeName: raw.employeeName ?? batch?.employeeName ?? null,
        platform: raw.platform,
        campaignPurpose: raw.campaignPurpose,
        status: raw.status,
        liveStartedAt: raw.liveStartedAt,
        clicks: Number(raw.clicks ?? 0),
        conversions: Number(raw.conversions ?? 0),
        revenue: Number(raw.revenue ?? 0),
        cost: Number(raw.cost ?? 0),
        roi: Number(raw.roi ?? 0),
      };

      const offerCount = raw.batchId != null ? offersPerBatch.get(raw.batchId) ?? 0 : 0;
      const firstSeen = touchCampaignFirstSeen(wsId, memoryActor, raw.id);
      const escalated = markEscalatedIfNeeded(wsId, memoryActor, raw.id, rules);
      const item = buildReviewQueueItem(input, offerCount, firstSeen, escalated, rules);
      if (item) items.push(item);
    }

    return items.sort((a, b) => b.urgencyScore - a.urgencyScore);
  }, [
    campaignResponse?.items,
    batchById,
    offersPerBatch,
    ownerFilter,
    viewerId,
    wsId,
    memoryTick,
    rules,
  ]);

  const opScore = useMemo(
    () => computeOperationalScore(wsId, viewerId, rules),
    [wsId, viewerId, memoryTick, rules],
  );

  const recentMemory = useMemo(
    () => getReviewEvents(wsId, viewerId).slice(0, 8),
    [wsId, viewerId, memoryTick],
  );

  function openReview(item: ReviewQueueCampaign) {
    setSelected(item);
    setSheetOpen(true);
  }

  if (isError) {
    return (
      <OperationalError
        title="Couldn't load campaign review queue"
        error={error}
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="space-y-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <ClipboardCheck className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-widest">
              Campaign review
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight">Personal review queue</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Campaign-centric operational intelligence. Review signals and decide next steps —
            tasks are execution follow-ups, not substitutes for review.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card/50 px-4 py-3">
          {isAdmin && (
            <div className="w-40">
              <Label className="text-xs text-muted-foreground">Visibility</Label>
              <Select
                value={ownerFilter}
                onValueChange={(v) => setOwnerFilter(v as "mine" | "all")}
              >
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mine">My campaigns</SelectItem>
                  <SelectItem value="all">All operators</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Operational score
              </p>
              <p className="text-lg font-bold tabular-nums">{opScore.score}</p>
              <p className="text-xs capitalize text-muted-foreground">{opScore.reliability} reliability</p>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Queue size
              </p>
              <p className="text-lg font-bold tabular-nums">{queue.length}</p>
              <p className="text-xs text-muted-foreground">suggestion-based</p>
            </div>
          </div>
          <Link
            href="/live-campaigns"
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <Upload className="h-3.5 w-3.5" />
            Sync metrics via Live Campaigns
          </Link>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Requires review
          </h2>
          {isLoading ? (
            <QueueListSkeleton count={5} />
          ) : queue.length === 0 ? (
            <OperationalEmpty
              icon={Gauge}
              title="Review queue is clear"
              description="No campaigns need operational review right now. Import Voluum metrics after sync to refresh signals."
              actionLabel="Open Live Campaigns"
              onAction={() => {
                window.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/live-campaigns`;
              }}
            />
          ) : (
            <ul className="space-y-2">
              {queue.map((item) => (
                <li key={item.campaignId}>
                  <button
                    type="button"
                    onClick={() => openReview(item)}
                    className="flex w-full gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/35 hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CampaignHealthBadge status={item.health} label={item.healthLabel} />
                        {item.escalated && (
                          <span className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-300">
                            Escalated · 4h+
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold">{item.campaignName}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.signals[0]?.label ?? "Signals detected"}
                        {item.batchName && ` · ${item.batchName}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <p className="font-mono font-bold text-foreground">{item.urgencyScore}</p>
                      <p>urgency</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Review vs tasks
            </h3>
            <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
              <li>
                <strong className="text-foreground">Review</strong> — analysis, signals, decisions
              </li>
              <li>
                <strong className="text-foreground">Tasks</strong> — structured execution after you
                decide
              </li>
              <li>
                <strong className="text-foreground">Live campaigns</strong> — monitoring table,
                not this queue
              </li>
            </ul>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Operational memory
            </h3>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Stored locally per workspace until server memory ships.
            </p>
            {recentMemory.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">No review actions recorded yet.</p>
            ) : (
              <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-xs">
                {recentMemory.map((e) => (
                  <li key={e.id} className="border-b border-border/60 pb-1.5 last:border-0">
                    <span className="font-medium capitalize">{e.type.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · campaign #{e.campaignId} ·{" "}
                      {new Date(e.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <ReviewDetailSheet
        item={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        workspaceId={wsId}
        actorEmployeeId={viewerId}
        onMemoryRecorded={() => setMemoryTick((t) => t + 1)}
        rules={rules}
      />
    </div>
  );
}
