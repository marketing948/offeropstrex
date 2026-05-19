// Pivot Phase 5 (Task #28) — Per-task-type detail drawer.
//
// Routes the worker through the right form for each task type and
// either creates the underlying domain row (campaign / batch_results)
// or stamps batch.live_at, then marks the task DONE so the engine's
// TaskCompleted rule can fan out the next step.
//
// Task types handled here:
//   CREATE_IOS_CAMPAIGN / CREATE_ANDROID_CAMPAIGN
//     -> Campaign form (name, URL, traffic source). On submit, POST
//        /campaigns (or PATCH if a draft already exists for this
//        batch+platform), then PATCH the task to DONE. The engine
//        then flips campaign draft -> ready via task-completed rule.
//   GO_LIVE
//     -> Confirmation. On confirm, PATCH /testing-batches/{id} with
//        liveAt=now, then PATCH the task to DONE. The engine then
//        flips both campaigns ready -> live via task-completed rule.
//   OPTIMIZATION_FOLLOWUP
//     -> Results form (clicks, cost, revenue, conversions, roi,
//        winnersCount, notes). POST /batch-results (upsert), then
//        PATCH the task to DONE.
//   MOVE_WINNERS_TO_SCALED_CAMPAIGN
//     -> Simple "Mark as moved" confirm; just PATCH task to DONE.
//   Anything else (legacy types):
//     -> Generic "Mark as done" button.

import { useState, useMemo, useEffect } from "react";
import {
  type TodoTask,
  type Campaign,
  useListCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
  useListBatchResults,
  useRecordBatchResult,
  useUpdateTodoTask,
  useCampaignsGoLive,
  useListWorkspaceTrafficSources,
  getListCampaignsQueryKey,
  getListBatchResultsQueryKey,
  getListTodoTasksQueryKey,
  getGetTestingBatchQueryKey,
  getListWorkspaceTrafficSourcesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { wsQueryOpts } from "@/lib/ws-query";
import { useToast } from "@/hooks/use-toast";
import { authedJson } from "@/lib/api-fetch";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { getTaskTypeVisual } from "@/lib/task-type-visuals";
import {
  parseWinnerHandoffContext,
  winnerHandoffHumanDescription,
} from "@/lib/winner-handoff";
import { Copy } from "lucide-react";

type Platform = "ios" | "android";

function platformFromTaskType(t: TodoTask["taskType"]): Platform | null {
  if (t === "CREATE_IOS_CAMPAIGN") return "ios";
  if (t === "CREATE_ANDROID_CAMPAIGN") return "android";
  return null;
}

export function TaskDetailDrawer({
  task,
  open,
  onClose,
}: {
  task: TodoTask | null;
  open: boolean;
  onClose: () => void;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();

  const updateTask = useUpdateTodoTask();

  function invalidate() {
    if (!activeWorkspaceId) return;
    qc.invalidateQueries({ queryKey: getListTodoTasksQueryKey({ workspace_id: activeWorkspaceId }) });
    if (task?.relatedBatchId) {
      qc.invalidateQueries({ queryKey: getListCampaignsQueryKey({ workspace_id: activeWorkspaceId, batch_id: task.relatedBatchId }) });
      qc.invalidateQueries({ queryKey: getListBatchResultsQueryKey({ workspace_id: activeWorkspaceId, batch_id: task.relatedBatchId }) });
      qc.invalidateQueries({ queryKey: getGetTestingBatchQueryKey(task.relatedBatchId) });
    }
  }

  async function markDone() {
    if (!task) return;
    try {
      await updateTask.mutateAsync({ id: task.id, data: { status: "DONE" } });
    } catch (e: unknown) {
      // Surface failures so the worker knows the task wasn't completed
      // even though the underlying domain mutation may have succeeded.
      toast({
        title: "Failed to mark task done",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      throw e;
    }
    invalidate();
    toast({ title: "Task marked done" });
    onClose();
  }

  if (!task) return null;

  const platform = platformFromTaskType(task.taskType);
  const visual = getTaskTypeVisual(task.taskType as string);
  const VisualIcon = visual.icon;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0">
        {/* Typed header — accent stripe + icon chip + label echo the
            row identity from the Tasks tab so the visual continues
            into the drawer. */}
        <div className={`h-1 w-full ${visual.accentBar}`} aria-hidden />
        <SheetHeader className="px-6 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${visual.iconBg}`}>
              <VisualIcon className={`h-5 w-5 ${visual.iconFg}`} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${visual.badgeBg} ${visual.badgeFg}`}>
                  {visual.label}
                </span>
                {visual.isLegacy && (
                  <span className="inline-flex items-center rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Legacy
                  </span>
                )}
              </div>
              <SheetTitle className="mt-1.5 text-base">{task.title}</SheetTitle>
              <SheetDescription className="mt-0.5 text-xs">
                {visual.subtext}
                {task.batchName && <span> · Batch: {task.batchName}</span>}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="px-6 pb-6">
          {(task.taskType as string) === "create_voluum_campaign_ios" || (task.taskType as string) === "create_voluum_campaign_android" ? (
            <CreateVoluumCampaignForm task={task} platform={(task.taskType as string) === "create_voluum_campaign_ios" ? "ios" : "android"} onCompleted={() => { invalidate(); onClose(); }} />
          ) : (task.taskType as string) === "take_campaign_live" ? (
            <TakeCampaignLiveForm task={task} onCompleted={() => { invalidate(); onClose(); }} />
          ) : (task.taskType as string) === "find_winners" ? (
            <FindWinnersForm task={task} onCompleted={() => { invalidate(); onClose(); }} />
          ) : (task.taskType as string) === "all_traffic_sources_tested" ? (
            <AllTrafficSourcesTestedForm task={task} onCompleted={() => { invalidate(); onClose(); }} />
          ) : platform ? (
            <CampaignForm task={task} platform={platform} onDone={markDone} onCancel={onClose} />
          ) : task.taskType === "GO_LIVE" ? (
            <GoLiveForm task={task} onDone={markDone} onCancel={onClose} />
          ) : task.taskType === "OPTIMIZATION_FOLLOWUP" ? (
            <ResultsForm task={task} onDone={markDone} onCancel={onClose} />
          ) : task.taskType === "MOVE_WINNERS_TO_SCALED_CAMPAIGN" ? (
            <MoveWinnersForm onDone={markDone} onCancel={onClose} />
          ) : (task.taskType as string) === "MANUAL" ? (
            <ManualTaskForm task={task} onCompleted={() => { invalidate(); onClose(); }} />
          ) : (
            <GenericForm onDone={markDone} onCancel={onClose} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────
// CREATE_IOS_CAMPAIGN / CREATE_ANDROID_CAMPAIGN
// ─────────────────────────────────────────────────────────────────
function CampaignForm({
  task, platform, onDone, onCancel,
}: {
  task: TodoTask; platform: Platform; onDone: () => Promise<void>; onCancel: () => void;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const batchId = task.relatedBatchId ?? null;

  const listParams = batchId && activeWorkspaceId
    ? { workspace_id: activeWorkspaceId, batch_id: batchId }
    : null;
  const { data: campaigns = [] } = useListCampaigns(
    listParams ?? { workspace_id: 0, batch_id: 0 },
    wsQueryOpts(activeWorkspaceId, getListCampaignsQueryKey(listParams ?? { workspace_id: 0, batch_id: 0 }), { enabled: !!listParams }),
  );
  const tsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const { data: trafficSources = [] } = useListWorkspaceTrafficSources(
    tsParams,
    wsQueryOpts(activeWorkspaceId, getListWorkspaceTrafficSourcesQueryKey(tsParams)),
  );

  const existing = useMemo<Campaign | null>(
    () => campaigns.find(c => c.platform === platform) ?? null,
    [campaigns, platform],
  );

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tsId, setTsId] = useState("");

  useEffect(() => {
    if (existing) {
      setName(existing.campaignName);
      setUrl(existing.campaignUrl ?? "");
      setTsId(existing.trafficSourceId != null ? String(existing.trafficSourceId) : "");
    } else {
      const suggested = task.batchName ? `${task.batchName} ${platform.toUpperCase()}` : "";
      setName(suggested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, task.id]);

  const create = useCreateCampaign();
  const update = useUpdateCampaign();

  async function submit() {
    if (!activeWorkspaceId || !batchId) {
      toast({ title: "Missing workspace or batch", variant: "destructive" });
      return;
    }
    if (!name.trim()) {
      toast({ title: "Campaign name is required", variant: "destructive" });
      return;
    }
    // Phase-5 precondition: URL/ID is required before the engine will
    // flip the campaign draft -> ready (which gates Go-Live). Block
    // here so the worker can't accidentally skip it.
    if (!url.trim()) {
      toast({ title: "Campaign URL / ID is required", variant: "destructive" });
      return;
    }
    try {
      if (existing) {
        await update.mutateAsync({
          id: existing.id,
          data: {
            campaignName: name.trim(),
            campaignUrl: url.trim() || null,
            trafficSourceId: tsId ? Number(tsId) : null,
          },
        });
      } else {
        await create.mutateAsync({
          data: {
            workspaceId: activeWorkspaceId,
            batchId,
            platform,
            campaignName: name.trim(),
            campaignUrl: url.trim() || null,
            trafficSourceId: tsId ? Number(tsId) : null,
            status: "draft",
          },
        });
      }
      qc.invalidateQueries({ queryKey: getListCampaignsQueryKey({ workspace_id: activeWorkspaceId, batch_id: batchId }) });
      toast({ title: existing ? "Campaign updated" : "Campaign created" });
      await onDone();
    } catch (e: unknown) {
      toast({
        title: "Failed to save campaign",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter the {platform === "ios" ? "iOS" : "Android"} campaign you created in the tracker. Saving marks the task done; the engine then flips the campaign to <strong>ready</strong>.
      </p>
      <div>
        <Label className="text-xs">Campaign name *</Label>
        <Input className="mt-1 h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SL_DE_BATCH1_IOS" />
      </div>
      <div>
        <Label className="text-xs">Campaign URL / ID *</Label>
        <Input className="mt-1 h-9" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or tracker ID" />
        <p className="text-[11px] text-muted-foreground mt-1">Required before the campaign can be marked ready and the batch can go live.</p>
      </div>
      <div>
        <Label className="text-xs">Traffic source</Label>
        <Select value={tsId} onValueChange={setTsId}>
          <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {trafficSources.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save & mark done"}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// GO_LIVE
// ─────────────────────────────────────────────────────────────────
function GoLiveForm({ task, onDone, onCancel }: { task: TodoTask; onDone: () => Promise<void>; onCancel: () => void }) {
  const { activeWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const batchId = task.relatedBatchId ?? null;

  const listParams = batchId && activeWorkspaceId
    ? { workspace_id: activeWorkspaceId, batch_id: batchId }
    : null;
  const { data: campaigns = [] } = useListCampaigns(
    listParams ?? { workspace_id: 0, batch_id: 0 },
    wsQueryOpts(activeWorkspaceId, getListCampaignsQueryKey(listParams ?? { workspace_id: 0, batch_id: 0 }), { enabled: !!listParams }),
  );
  const goLive = useCampaignsGoLive();

  async function submit() {
    if (!batchId) {
      toast({ title: "No batch linked", variant: "destructive" });
      return;
    }
    try {
      // Phase-5 atomic go-live: stamps batch.live_at and flips both
      // campaigns ready->live in one transaction. The drawer then
      // PATCHes the task DONE; the engine TaskCompleted GO_LIVE rule
      // is idempotent (campaigns already live -> no-op).
      await goLive.mutateAsync({ id: batchId });
      if (activeWorkspaceId) {
        qc.invalidateQueries({ queryKey: getListCampaignsQueryKey({ workspace_id: activeWorkspaceId, batch_id: batchId }) });
        qc.invalidateQueries({ queryKey: getGetTestingBatchQueryKey(batchId) });
      }
      await onDone();
    } catch (e: unknown) {
      toast({
        title: "Failed to go live",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Confirm both campaigns are running. This stamps the batch&apos;s <code>live_at</code> and flips both campaigns to <strong>live</strong>.
      </p>
      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
        {campaigns.length === 0 ? (
          <span className="text-muted-foreground">No campaigns found for this batch.</span>
        ) : (
          campaigns.map(c => (
            <div key={c.id} className="flex justify-between">
              <span>{c.platform.toUpperCase()}: {c.campaignName}</span>
              <Badge variant="outline">{c.status}</Badge>
            </div>
          ))
        )}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={goLive.isPending}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={goLive.isPending}>
          {goLive.isPending ? "Going live…" : "Confirm — go live"}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// OPTIMIZATION_FOLLOWUP
// ─────────────────────────────────────────────────────────────────
function ResultsForm({ task, onDone, onCancel }: { task: TodoTask; onDone: () => Promise<void>; onCancel: () => void }) {
  const { activeWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const batchId = task.relatedBatchId ?? null;

  const listParams = batchId && activeWorkspaceId
    ? { workspace_id: activeWorkspaceId, batch_id: batchId }
    : null;
  const { data: existingResults = [] } = useListBatchResults(
    listParams ?? { workspace_id: 0, batch_id: 0 },
    wsQueryOpts(activeWorkspaceId, getListBatchResultsQueryKey(listParams ?? { workspace_id: 0, batch_id: 0 }), { enabled: !!listParams }),
  );
  const existing = existingResults[0] ?? null;

  const [clicks, setClicks] = useState("");
  const [cost, setCost] = useState("");
  const [revenue, setRevenue] = useState("");
  const [conversions, setConversions] = useState("");
  const [roi, setRoi] = useState("");
  const [winnersCount, setWinnersCount] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (existing) {
      setClicks(String(existing.clicks ?? ""));
      setCost(existing.cost ?? "");
      setRevenue(existing.revenue ?? "");
      setConversions(String(existing.conversions ?? ""));
      setRoi(existing.roi ?? "");
      setWinnersCount(String(existing.winnersCount ?? ""));
      setNotes(existing.notes ?? "");
    }
  }, [existing?.id]);

  const record = useRecordBatchResult();

  async function submit() {
    if (!activeWorkspaceId || !batchId) {
      toast({ title: "Missing workspace or batch", variant: "destructive" });
      return;
    }
    try {
      await record.mutateAsync({
        data: {
          workspaceId: activeWorkspaceId,
          batchId,
          clicks: clicks ? Number(clicks) : 0,
          cost: cost || "0",
          revenue: revenue || "0",
          conversions: conversions ? Number(conversions) : 0,
          roi: roi === "" ? null : roi,
          winnersCount: winnersCount ? Number(winnersCount) : 0,
          notes: notes || null,
        },
      });
      qc.invalidateQueries({ queryKey: getListBatchResultsQueryKey({ workspace_id: activeWorkspaceId, batch_id: batchId }) });
      toast({ title: "Results recorded" });
      await onDone();
    } catch (e: unknown) {
      toast({
        title: "Failed to record results",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter the batch&apos;s test results. If <strong>winners {">"} 0</strong> or <strong>ROI {">"} 0</strong>, the engine creates a <em>Move Winners to Scaled Campaign</em> task automatically.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Clicks</Label>
          <Input className="mt-1 h-9" type="number" value={clicks} onChange={(e) => setClicks(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Conversions</Label>
          <Input className="mt-1 h-9" type="number" value={conversions} onChange={(e) => setConversions(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Cost ($)</Label>
          <Input className="mt-1 h-9" type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Revenue ($)</Label>
          <Input className="mt-1 h-9" type="number" step="0.01" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">ROI (%)</Label>
          <Input className="mt-1 h-9" type="number" step="0.01" value={roi} onChange={(e) => setRoi(e.target.value)} placeholder="optional" />
        </div>
        <div>
          <Label className="text-xs">Winners count</Label>
          <Input className="mt-1 h-9" type="number" value={winnersCount} onChange={(e) => setWinnersCount(e.target.value)} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Notes</Label>
        <Textarea className="mt-1 min-h-[70px] text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={record.isPending}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={record.isPending}>
          {record.isPending ? "Saving…" : "Save & mark done"}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// MOVE_WINNERS_TO_SCALED_CAMPAIGN — manual confirmation only
// ─────────────────────────────────────────────────────────────────
function MoveWinnersForm({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const [pending, setPending] = useState(false);
  async function submit() {
    setPending(true);
    try { await onDone(); } catch { /* markDone toasts on its own */ }
    finally { setPending(false); }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Confirm you have moved the winning offers to the scaled campaign in your tracker. Marking this task done has no engine side-effects.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Mark as moved"}</Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// CampaignOps redesign — task completion forms.
// ─────────────────────────────────────────────────────────────────

function useCompleteTask() {
  const { toast } = useToast();
  return async function complete(taskId: number, body: unknown) {
    try {
      await authedJson(`/api/todo-tasks/${taskId}/complete`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast({ title: "Task completed" });
      return true;
    } catch (e: unknown) {
      toast({
        title: "Failed to complete task",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      return false;
    }
  };
}

function CreateVoluumCampaignForm({ task, platform, onCompleted }: { task: TodoTask; platform: Platform; onCompleted: () => void }) {
  const complete = useCompleteTask();
  const { toast } = useToast();
  const [voluumCampaignId, setVoluumCampaignId] = useState("");
  const [campaignUrl, setCampaignUrl] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!voluumCampaignId.trim()) {
      toast({ title: "Voluum Campaign ID is required", variant: "destructive" });
      return;
    }
    if (!campaignUrl.trim()) {
      toast({ title: "Voluum Campaign URL is required", variant: "destructive" });
      return;
    }
    setPending(true);
    const ok = await complete(task.id, {
      voluumCampaignId: voluumCampaignId.trim(),
      campaignUrl: campaignUrl.trim(),
    });
    setPending(false);
    if (ok) onCompleted();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Create the {platform === "ios" ? "iOS" : "Android"} Voluum campaign in your tracker, then enter its details below. The <strong>Voluum Campaign ID</strong> is the permanent link for metrics sync — tags are for grouping only. Saving creates the Campaign and spawns a <strong>take_campaign_live</strong> task.
      </p>
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <div className="text-xs text-muted-foreground">Campaign name to create</div>
        <div className="font-medium">{task.title}</div>
      </div>
      <div>
        <Label className="text-xs">Voluum Campaign ID *</Label>
        <Input
          className="mt-1 h-9 font-mono text-sm"
          value={voluumCampaignId}
          onChange={(e) => setVoluumCampaignId(e.target.value)}
          placeholder="e.g. a1b2c3d4-e5f6-…"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          In Voluum, open the campaign and copy the <strong>Campaign ID</strong> from the URL or settings (not tags).
        </p>
      </div>
      <div>
        <Label className="text-xs">Voluum Campaign URL *</Label>
        <Input className="mt-1 h-9" value={campaignUrl} onChange={(e) => setCampaignUrl(e.target.value)} placeholder="https://…" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button size="sm" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save & complete task"}
        </Button>
      </div>
    </div>
  );
}

function TakeCampaignLiveForm({ task, onCompleted }: { task: TodoTask; onCompleted: () => void }) {
  const complete = useCompleteTask();
  const [tsCampaignId, setTsCampaignId] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!tsCampaignId.trim()) return;
    setPending(true);
    const ok = await complete(task.id, {
      trafficSourceCampaignId: tsCampaignId.trim(),
    });
    setPending(false);
    if (ok) onCompleted();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter the traffic-source campaign ID after confirming the campaign is live.
      </p>
      <div>
        <Label className="text-xs">Campaign ID *</Label>
        <Input className="mt-1 h-9" value={tsCampaignId} onChange={(e) => setTsCampaignId(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button size="sm" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Mark campaign live"}</Button>
      </div>
    </div>
  );
}

function FindWinnersForm({ task, onCompleted }: { task: TodoTask; onCompleted: () => void }) {
  const complete = useCompleteTask();
  const [winners, setWinners] = useState("0");
  const [revenue, setRevenue] = useState("");
  const [cost, setCost] = useState("");
  const [clicks, setClicks] = useState("");
  const [conversions, setConversions] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    if (revenue === "" || cost === "") return;
    setPending(true);
    const ok = await complete(task.id, {
      winnersCount: Number(winners) || 0,
      revenue: Number(revenue),
      cost: Number(cost),
      clicks: clicks ? Number(clicks) : null,
      conversions: conversions ? Number(conversions) : null,
      notes: notes.trim() || null,
    });
    setPending(false);
    if (ok) onCompleted();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter this campaign&apos;s 7-day performance. The engine will mark the campaign <strong>tested</strong>, store the numbers, and spawn the next traffic source&apos;s create_voluum_campaign task — or mark the platform fully tested.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Winners count *</Label>
          <Input className="mt-1 h-9" type="number" min="0" value={winners} onChange={(e) => setWinners(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Conversions</Label>
          <Input className="mt-1 h-9" type="number" min="0" value={conversions} onChange={(e) => setConversions(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Revenue ($) *</Label>
          <Input className="mt-1 h-9" type="number" step="0.01" min="0" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Cost ($) *</Label>
          <Input className="mt-1 h-9" type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Clicks</Label>
          <Input className="mt-1 h-9" type="number" min="0" value={clicks} onChange={(e) => setClicks(e.target.value)} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Notes</Label>
        <Textarea className="mt-1 min-h-[60px] text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button size="sm" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Save results"}</Button>
      </div>
    </div>
  );
}

function AllTrafficSourcesTestedForm({ task, onCompleted }: { task: TodoTask; onCompleted: () => void }) {
  const complete = useCompleteTask();
  const [pending, setPending] = useState(false);
  async function submit() {
    setPending(true);
    const ok = await complete(task.id, {});
    setPending(false);
    if (ok) onCompleted();
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every traffic source for this batch + platform has now been tested. Acknowledge to close out this task.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <Button size="sm" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Acknowledge"}</Button>
      </div>
    </div>
  );
}

function ManualTaskForm({
  task,
  onCompleted,
}: {
  task: TodoTask;
  onCompleted: () => void;
}) {
  const { toast } = useToast();
  const complete = useCompleteTask();
  const [pending, setPending] = useState(false);
  const handoff = parseWinnerHandoffContext(task.description);
  const humanDescription = winnerHandoffHumanDescription(task.description);

  async function copyWinnerIds() {
    if (!handoff?.winnerOfferIds.length) return;
    const text = handoff.winnerOfferIds.join(", ");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied winner offer IDs" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  }

  async function submit() {
    setPending(true);
    const ok = await complete(task.id, {});
    setPending(false);
    if (ok) onCompleted();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Mark this reminder complete when you have finished the work. This does not trigger CampaignOps automation.
      </p>
      {handoff && (
        <WinnerHandoffPanel handoff={handoff} onCopyAll={copyWinnerIds} />
      )}
      {humanDescription && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
          {humanDescription}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button size="sm" onClick={() => void submit()} disabled={pending}>
          {pending ? "Completing…" : "Mark complete"}
        </Button>
      </div>
    </div>
  );
}

function WinnerHandoffPanel({
  handoff,
  onCopyAll,
}: {
  handoff: NonNullable<ReturnType<typeof parseWinnerHandoffContext>>;
  onCopyAll: () => void;
}) {
  const platformLabel = handoff.platform === "ios" ? "iOS" : "Android";
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/80 p-3 space-y-3 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
        Winner handoff (manual — no Voluum auto-transfer)
      </p>
      {handoff.missingWorkingCampaign ? (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          No live working campaign was found for this slot. Create or locate the working campaign before moving offers.
        </p>
      ) : handoff.targetWorkingCampaignId != null ? (
        <p className="text-sm">
          Target working campaign:{" "}
          <span className="font-mono font-medium">#{handoff.targetWorkingCampaignId}</span>
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Testing campaign #{handoff.testingCampaignId}
        {handoff.batchId != null ? ` · batch #${handoff.batchId}` : ""}
        {` · ${platformLabel}`}
        {handoff.trafficSourceId != null ? ` · traffic source #${handoff.trafficSourceId}` : ""}
      </p>
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-xs font-medium">Winner offer IDs</span>
          {handoff.winnerOfferIds.length > 0 && (
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onCopyAll}>
              <Copy className="h-3 w-3" />
              Copy all
            </Button>
          )}
        </div>
        {handoff.winnerOfferIds.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {handoff.winnerOfferIds.map((id) => (
              <Badge key={id} variant="secondary" className="font-mono text-xs">
                {id}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No winner IDs recorded at close — confirm IDs in Voluum.</p>
        )}
      </div>
    </div>
  );
}

function GenericForm({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const [pending, setPending] = useState(false);
  async function submit() {
    setPending(true);
    try { await onDone(); } catch { /* markDone toasts on its own */ }
    finally { setPending(false); }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        This task has no specific form. Mark it done when you have completed it.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Mark as done"}</Button>
      </div>
    </div>
  );
}
