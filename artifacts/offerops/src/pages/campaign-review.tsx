/**
 * Personal Campaign Review Queue — human-in-the-loop operational intelligence.
 * Separate from /live-campaigns (monitoring) and /tasks (execution).
 * Signals and health are UI heuristics; operational memory is client-side until API exists.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListOffers,
  useListTestingBatches,
  useListEmployees,
  getListOffersQueryKey,
  getListTestingBatchesQueryKey,
  getListEmployeesQueryKey,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth";
import { useAlertRules } from "@/hooks/use-alert-rules";
import { authedJson } from "@/lib/api-fetch";
import {
  buildReviewQueueItem,
  buildManualReviewQueueItem,
  type ReviewCampaignInput,
} from "@/lib/campaign-review/heuristics";
import {
  computeOperationalScore,
  getLatestMediaBuyerNote,
  getMediaBuyerNotes,
  getReviewEvents,
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolveDisplayRoiPercent } from "@/lib/campaign-metrics";
import { matchesReviewSearch } from "@/lib/campaign-review/filter";
import {
  buildDismissalMap,
  isReviewItemHidden,
  latestSignalTimestamp,
  type DismissalRecord,
} from "@/lib/campaign-review/dismissals";
import { useToast } from "@/hooks/use-toast";
import { ClipboardCheck, Copy, Gauge, Search, Upload } from "lucide-react";
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
    voluumCampaignId?: string | null;
    updatedAt?: string | null;
  }>;
};

type OpenReviewRequest = {
  eventId: number;
  campaignId: number;
  campaignName: string;
  note: string;
  requestedByEmployeeId: number | null;
  createdAt: string;
};

export default function CampaignReviewPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { currentEmployee } = useAuth();
  const { rules } = useAlertRules();
  const { toast } = useToast();
  const wsId = activeWorkspaceId ?? 0;
  const isAdmin = currentEmployee?.role === "admin";
  const viewerId = currentEmployee?.id ?? 0;

  const [employeeFilterId, setEmployeeFilterId] = useState<number | "all">(
    isAdmin ? "all" : viewerId,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDismissOpen, setBulkDismissOpen] = useState(false);
  const [selected, setSelected] = useState<ReviewQueueCampaign | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [memoryTick, setMemoryTick] = useState(0);
  const [autoOpenedFocus, setAutoOpenedFocus] = useState(false);

  const focusCampaignId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("campaignId");
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  }, []);

  const wsParams = { workspace_id: wsId };

  const { data: batches = [] } = useListTestingBatches(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(wsParams)),
  );

  const { data: employees = [] } = useListEmployees(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(wsParams)),
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

  const { data: openRequestsData } = useQuery<{ items: OpenReviewRequest[] }>({
    queryKey: ["campaign-review-open", wsId],
    enabled: !!activeWorkspaceId,
    queryFn: () =>
      authedJson(`/api/campaign-review/open-requests?workspace_id=${wsId}`),
  });

  const { data: dismissedData } = useQuery<{ items: DismissalRecord[] }>({
    queryKey: ["campaign-review-dismissed", wsId],
    enabled: !!activeWorkspaceId,
    queryFn: () =>
      authedJson(`/api/campaign-review/dismissed?workspace_id=${wsId}`),
  });

  const dismissalMap = useMemo(
    () => buildDismissalMap(dismissedData?.items ?? []),
    [dismissedData?.items],
  );

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
    const byCampaignId = new Map<number, ReviewQueueCampaign>();
    const memoryActor = viewerId;

    function campaignOwnerId(raw: LiveCampaignsApiResponse["items"][0]): number | null {
      const batch = raw.batchId != null ? batchById.get(raw.batchId) : undefined;
      return batch?.employeeId ?? raw.employeeId ?? null;
    }

    function toInput(raw: LiveCampaignsApiResponse["items"][0]): ReviewCampaignInput {
      const batch = raw.batchId != null ? batchById.get(raw.batchId) : undefined;
      const ownerId = campaignOwnerId(raw);
      const cost = Number(raw.cost ?? 0);
      const revenue = Number(raw.revenue ?? 0);
      return {
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
        revenue,
        cost,
        roi: resolveDisplayRoiPercent(cost, revenue, raw.roi) ?? 0,
        voluumCampaignId: raw.voluumCampaignId ?? null,
      };
    }

    function matchesEmployeeFilter(ownerId: number | null, requestedBy: number | null): boolean {
      if (!isAdmin) return ownerId === viewerId || requestedBy === viewerId;
      if (employeeFilterId === "all") return true;
      return ownerId === employeeFilterId || requestedBy === employeeFilterId;
    }

    for (const raw of campaignResponse?.items ?? []) {
      const ownerId = campaignOwnerId(raw);
      if (!matchesEmployeeFilter(ownerId, null)) continue;
      const signalAt = latestSignalTimestamp(raw.updatedAt, raw.liveStartedAt);
      if (isReviewItemHidden(dismissalMap.get(raw.id), signalAt)) continue;

      const input = toInput(raw);
      const offerCount = raw.batchId != null ? offersPerBatch.get(raw.batchId) ?? 0 : 0;
      const firstSeen = touchCampaignFirstSeen(wsId, memoryActor, raw.id);
      const escalated = markEscalatedIfNeeded(wsId, memoryActor, raw.id, rules);
      const item = buildReviewQueueItem(input, offerCount, firstSeen, escalated, rules);
      if (item) byCampaignId.set(raw.id, item);
    }

    for (const req of openRequestsData?.items ?? []) {
      const raw = campaignResponse?.items?.find((c) => c.id === req.campaignId);
      const reqSignalAt = latestSignalTimestamp(req.createdAt, raw?.updatedAt);
      if (isReviewItemHidden(dismissalMap.get(req.campaignId), reqSignalAt)) continue;

      if (raw) {
        const ownerId = campaignOwnerId(raw);
        if (!matchesEmployeeFilter(ownerId, req.requestedByEmployeeId)) {
          continue;
        }
        const manual = buildManualReviewQueueItem(toInput(raw), req.note, req.createdAt);
        byCampaignId.set(req.campaignId, manual);
        continue;
      }

      if (!matchesEmployeeFilter(null, req.requestedByEmployeeId)) continue;

      byCampaignId.set(req.campaignId, {
        campaignId: req.campaignId,
        campaignName: req.campaignName,
        batchId: null,
        batchName: null,
        employeeId: req.requestedByEmployeeId,
        employeeName: null,
        platform: "—",
        purpose: "—",
        status: "live",
        health: "attention_required",
        healthLabel: "Attention required",
        signals: [
          {
            id: `manual-${req.eventId}`,
            kind: "traffic_decrease",
            label: "Manual review requested",
            detail: req.note.trim() || "Sent from Live Campaigns for review.",
            severity: "high",
          },
        ],
        suggestedActions: [],
        visits: 0,
        conversions: 0,
        revenue: 0,
        cost: 0,
        roi: 0,
        profit: 0,
        firstSeenAt: req.createdAt,
        escalated: true,
        urgencyScore: 100,
      });
    }

    return [...byCampaignId.values()].sort((a, b) => b.urgencyScore - a.urgencyScore);
  }, [
    campaignResponse?.items,
    openRequestsData?.items,
    dismissalMap,
    batchById,
    offersPerBatch,
    employeeFilterId,
    viewerId,
    isAdmin,
    wsId,
    memoryTick,
    rules,
  ]);

  const filteredQueue = useMemo(() => {
    return queue.filter((item) => {
      const note = getLatestMediaBuyerNote(wsId, viewerId, item.campaignId)?.note ?? "";
      return matchesReviewSearch(item, searchQuery, note);
    });
  }, [queue, searchQuery, wsId, viewerId]);

  const allVisibleSelected =
    filteredQueue.length > 0 && filteredQueue.every((item) => selectedIds.has(item.campaignId));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredQueue.map((item) => item.campaignId)));
  }

  function toggleSelect(campaignId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  }

  const queryClient = useQueryClient();
  const [dismissing, setDismissing] = useState(false);

  async function dismissCampaigns(campaignIds: number[]) {
    if (campaignIds.length === 0) return;
    setDismissing(true);
    try {
      const res = await authedJson<{
        ok: boolean;
        results: Array<{ campaignId: number; ok: boolean; error?: string }>;
      }>(`/api/campaign-review/dismiss`, {
        method: "POST",
        body: JSON.stringify({ workspaceId: wsId, campaignIds }),
      });
      const results = res?.results ?? [];
      const succeeded = results.filter((r) => r.ok).map((r) => r.campaignId);
      const failed = results.filter((r) => !r.ok);

      await queryClient.invalidateQueries({
        queryKey: ["campaign-review-dismissed", wsId],
      });

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of succeeded) next.delete(id);
        return next;
      });

      if (failed.length === 0) {
        setBulkDismissOpen(false);
        toast({ title: `Dismissed ${succeeded.length} review item(s)` });
      } else {
        toast({
          title: `Dismissed ${succeeded.length}, ${failed.length} failed`,
          description: failed
            .map((f) => `#${f.campaignId}: ${f.error ?? "failed"}`)
            .join("; "),
          variant: "destructive",
        });
      }
    } catch (e: unknown) {
      toast({
        title: "Could not dismiss",
        description: e instanceof Error ? e.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setDismissing(false);
    }
  }

  function bulkDismissSelected() {
    void dismissCampaigns([...selectedIds]);
  }

  async function copyId(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  }

  const opScore = useMemo(
    () => computeOperationalScore(wsId, viewerId, rules),
    [wsId, viewerId, memoryTick, rules],
  );

  const recentMemory = useMemo(
    () => getReviewEvents(wsId, viewerId).slice(0, 8),
    [wsId, viewerId, memoryTick],
  );

  const mediaBuyerNotes = useMemo(
    () => getMediaBuyerNotes(wsId, viewerId),
    [wsId, viewerId, memoryTick],
  );

  const campaignNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of campaignResponse?.items ?? []) m.set(c.id, c.campaignName);
    return m;
  }, [campaignResponse?.items]);

  const focusNote = useMemo(() => {
    if (focusCampaignId == null) return null;
    void memoryTick;
    return getLatestMediaBuyerNote(wsId, viewerId, focusCampaignId);
  }, [focusCampaignId, wsId, viewerId, memoryTick]);

  useEffect(() => {
    if (autoOpenedFocus || focusCampaignId == null || isLoading) return;
    const item = queue.find((q) => q.campaignId === focusCampaignId);
    if (item) {
      setSelected(item);
      setSheetOpen(true);
      setAutoOpenedFocus(true);
    }
  }, [autoOpenedFocus, focusCampaignId, isLoading, queue]);

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
            <div className="w-48">
              <Label className="text-xs text-muted-foreground">Employee</Label>
              <Select
                value={employeeFilterId === "all" ? "all" : String(employeeFilterId)}
                onValueChange={(v) =>
                  setEmployeeFilterId(v === "all" ? "all" : Number(v))
                }
              >
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="min-w-[200px] flex-1">
            <Label className="text-xs text-muted-foreground">Search</Label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Campaign, ID, network, GEO, comment…"
                className="h-9 pl-9"
              />
            </div>
          </div>
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
              <p className="text-lg font-bold tabular-nums">{filteredQueue.length}</p>
              <p className="text-xs text-muted-foreground">
                {queue.length !== filteredQueue.length ? `${queue.length} total` : "suggestion-based"}
              </p>
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

      {focusNote && (
        <section className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
            Media buyer note
          </p>
          <p className="mt-1 text-sm font-semibold">
            {campaignNameById.get(focusNote.campaignId) ?? `Campaign #${focusNote.campaignId}`}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{focusNote.note}</p>
          <p className="mt-2 text-[10px] text-muted-foreground">
            From Live Campaigns — also stored in the review queue when sent via Send to review.
          </p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Requires review
            </h2>
            {filteredQueue.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={allVisibleSelected} onCheckedChange={() => toggleSelectAll()} />
                  Select all
                </label>
                {selectedIds.size > 0 && (
                  <>
                    <span className="text-xs font-semibold text-foreground">
                      {selectedIds.size} selected
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setBulkDismissOpen(true)}
                    >
                      Dismiss selected
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
          {isLoading ? (
            <QueueListSkeleton count={5} />
          ) : filteredQueue.length === 0 ? (
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
              {filteredQueue.map((item) => (
                <li key={item.campaignId}>
                  <div className="flex w-full gap-2 rounded-xl border border-border bg-card px-3 py-3 transition-colors hover:border-primary/35 hover:bg-muted/30">
                    <Checkbox
                      className="mt-1 shrink-0"
                      checked={selectedIds.has(item.campaignId)}
                      onCheckedChange={() => toggleSelect(item.campaignId)}
                    />
                    <button
                      type="button"
                      onClick={() => openReview(item)}
                      className="flex min-w-0 flex-1 gap-3 text-left"
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
                        <p className="text-[10px] font-mono text-muted-foreground">
                          ID {item.campaignId}
                          {item.voluumCampaignId ? ` · Voluum ${item.voluumCampaignId}` : ""}
                        </p>
                        {item.reviewComment?.trim() ? (
                          <p className="mt-1 line-clamp-2 text-sm text-primary">
                            {item.reviewComment}
                          </p>
                        ) : (() => {
                          const note = getLatestMediaBuyerNote(wsId, viewerId, item.campaignId);
                          if (!note?.note?.trim()) return null;
                          return (
                            <p className="mt-1 line-clamp-2 text-xs text-primary">
                              Media buyer note: {note.note}
                            </p>
                          );
                        })()}
                        <p className="text-xs text-muted-foreground">
                          {item.signals[0]?.label ?? "Signals detected"}
                          {item.batchName && ` · ${item.batchName}`}
                          {item.employeeName && ` · ${item.employeeName}`}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs text-muted-foreground">
                        <p className="font-mono font-bold text-foreground">{item.urgencyScore}</p>
                        <p>urgency</p>
                      </div>
                    </button>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Copy campaign ID"
                        onClick={() => void copyId(String(item.campaignId), "Campaign ID")}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      {item.voluumCampaignId && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Copy Voluum ID"
                          onClick={() => void copyId(item.voluumCampaignId!, "Voluum ID")}
                        >
                          <Copy className="h-3.5 w-3.5 text-primary" />
                        </Button>
                      )}
                    </div>
                  </div>
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
              Media buyer notes
            </h3>
            <p className="mt-1 text-[10px] text-muted-foreground">
              From Live Campaigns → Send Campaign to review. Stored locally in this browser only.
            </p>
            {mediaBuyerNotes.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">No notes captured yet.</p>
            ) : (
              <ul className="mt-3 max-h-56 space-y-3 overflow-y-auto text-xs">
                {mediaBuyerNotes.slice(0, 12).map((e) => (
                  <li key={e.id} className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                    <p className="font-semibold text-foreground">
                      {campaignNameById.get(e.campaignId) ?? `Campaign #${e.campaignId}`}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">{e.note}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
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
                    {e.note?.trim() && (
                      <p className="mt-0.5 line-clamp-2 text-foreground">{e.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <Dialog open={bulkDismissOpen} onOpenChange={setBulkDismissOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss selected reviews?</DialogTitle>
            <DialogDescription>
              This removes {selectedIds.size} item(s) from your review queue. Campaigns are not
              deleted or closed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkDismissOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={dismissing} onClick={bulkDismissSelected}>
              {dismissing ? "Dismissing…" : "Dismiss"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReviewDetailSheet
        item={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        workspaceId={wsId}
        actorEmployeeId={viewerId}
        onMemoryRecorded={() => setMemoryTick((t) => t + 1)}
        onServerDismiss={(campaignId) => dismissCampaigns([campaignId])}
        rules={rules}
      />
    </div>
  );
}
