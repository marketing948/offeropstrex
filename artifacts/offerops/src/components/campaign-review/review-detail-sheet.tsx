import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AlertRulesConfig } from "@workspace/alert-rules";
import { DEFAULT_ALERT_RULES } from "@workspace/alert-rules";
import type { ReviewQueueCampaign, SuggestedReviewAction } from "@/lib/campaign-review/types";
import { recordReviewEvent, getLatestMediaBuyerNote } from "@/lib/campaign-review/memory";
import { authedJson } from "@/lib/api-fetch";
import { AddToWorkQueueDialog } from "@/components/campaign-review/add-to-work-queue-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CampaignHealthBadge } from "@/components/campaign-review/health-badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, ListTodo, Pencil } from "lucide-react";

function fmt$(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

async function copyText(value: string, toast: ReturnType<typeof useToast>["toast"], label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title: `${label} copied` });
  } catch {
    toast({ title: "Could not copy", variant: "destructive" });
  }
}

export function ReviewDetailSheet({
  item,
  open,
  onOpenChange,
  workspaceId,
  actorEmployeeId,
  onMemoryRecorded,
  onServerDismiss,
  rules = DEFAULT_ALERT_RULES,
}: {
  item: ReviewQueueCampaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  actorEmployeeId: number;
  onMemoryRecorded: () => void;
  /** Server-authoritative dismiss for a single campaign. */
  onServerDismiss?: (campaignId: number) => Promise<void> | void;
  rules?: AlertRulesConfig;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [workQueueOpen, setWorkQueueOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [editingComment, setEditingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);

  const review = item;
  const mediaBuyerNote =
    review != null ? getLatestMediaBuyerNote(workspaceId, actorEmployeeId, review.campaignId) : null;
  const isManualReview =
    review?.signals.some((s) => s.label === "Manual review requested") ?? false;
  const displayComment =
    review?.reviewComment?.trim() ||
    mediaBuyerNote?.note?.trim() ||
    "";

  useEffect(() => {
    if (!open || !review) {
      setEditingComment(false);
      return;
    }
    setCommentDraft(displayComment);
  }, [open, review?.campaignId, displayComment]);

  if (!review) return null;

  async function resolveManualReview(resolution: string) {
    if (!isManualReview) return;
    setResolving(true);
    try {
      await authedJson(`/api/campaigns/${review.campaignId}/resolve-review`, {
        method: "POST",
        body: JSON.stringify({ workspaceId, resolution }),
      });
      await queryClient.invalidateQueries({ queryKey: ["campaign-review-open", workspaceId] });
    } catch (e: unknown) {
      toast({
        title: "Could not resolve review",
        description: e instanceof Error ? e.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setResolving(false);
    }
  }

  async function saveComment() {
    setSavingComment(true);
    try {
      await authedJson(`/api/campaigns/${review.campaignId}/review-note`, {
        method: "PATCH",
        body: JSON.stringify({ workspaceId, note: commentDraft }),
      });
      await queryClient.invalidateQueries({ queryKey: ["campaign-review-open", workspaceId] });
      setEditingComment(false);
      onMemoryRecorded();
      toast({ title: "Review comment saved" });
    } catch (e: unknown) {
      toast({
        title: "Could not save comment",
        description: e instanceof Error ? e.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setSavingComment(false);
    }
  }

  function applyAction(action: SuggestedReviewAction) {
    void (async () => {
      recordReviewEvent(workspaceId, actorEmployeeId, {
        campaignId: review.campaignId,
        type: action.memoryType,
        actionId: action.id,
        note: action.label,
      });
      if (action.memoryType === "dismissed_signal") {
        await onServerDismiss?.(review.campaignId);
      }
      if (
        isManualReview &&
        (action.memoryType === "reviewed" || action.memoryType === "dismissed_signal")
      ) {
        await resolveManualReview(action.memoryType);
      }
      onMemoryRecorded();
      toast({
        title: "Review recorded",
        description:
          action.memoryType === "scaling_task_suggested"
            ? "Follow-up tasks are created from batch workflow when you are ready — not auto-spawned here."
            : action.label,
      });
      if (action.href) {
        onOpenChange(false);
        navigate(action.href);
      } else if (
        isManualReview &&
        (action.memoryType === "reviewed" || action.memoryType === "dismissed_signal")
      ) {
        onOpenChange(false);
      } else if (action.memoryType === "dismissed_signal") {
        onOpenChange(false);
      }
    })();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <CampaignHealthBadge status={review.health} label={review.healthLabel} />
            {review.escalated && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800 dark:text-amber-200">
                Escalated
              </span>
            )}
          </div>
          <SheetTitle className="mt-2 text-lg">{review.campaignName}</SheetTitle>
          <SheetDescription>
            {review.batchName && `Batch: ${review.batchName} · `}
            {review.purpose} · {review.platform}
            {review.employeeName && ` · ${review.employeeName}`}
          </SheetDescription>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void copyText(String(review.campaignId), toast, "Campaign ID")}
            >
              <Copy className="mr-1 h-3 w-3" />
              ID {review.campaignId}
            </Button>
            {review.voluumCampaignId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 max-w-full text-xs"
                onClick={() => void copyText(review.voluumCampaignId!, toast, "Voluum ID")}
              >
                <Copy className="mr-1 h-3 w-3 shrink-0" />
                <span className="truncate">Voluum {review.voluumCampaignId}</span>
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div className="rounded-xl border-2 border-primary/30 bg-primary/5 px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold uppercase tracking-widest text-primary">
                Review comment
              </p>
              {!editingComment && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setCommentDraft(displayComment);
                    setEditingComment(true);
                  }}
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  Edit
                </Button>
              )}
            </div>
            {editingComment ? (
              <div className="mt-3 space-y-2">
                <Textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  rows={5}
                  className="text-base"
                  placeholder="Add context for this review…"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingComment}
                    onClick={() => void saveComment()}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={savingComment}
                    onClick={() => {
                      setCommentDraft(displayComment);
                      setEditingComment(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-foreground">
                {displayComment || (
                  <span className="text-muted-foreground italic">No comment yet</span>
                )}
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Metrics snapshot
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Metric label="Visits" value={review.visits.toLocaleString()} />
              <Metric label="Conversions" value={String(review.conversions)} />
              <Metric label="Revenue" value={fmt$(review.revenue)} />
              <Metric label="ROI" value={`${review.roi.toFixed(1)}%`} />
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              ROI is calculated from cost and revenue — not imported from CSV.
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Detected signals
            </p>
            <ul className="space-y-2">
              {review.signals.map((s) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm"
                >
                  <p className="font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.detail}</p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Suggested actions
            </p>
            <p className="mb-3 text-xs text-muted-foreground">
              Review is analysis and decision-making. Tasks are follow-up execution — create them
              from the batch when you choose to scale or close work.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="h-auto min-h-9 justify-start whitespace-normal py-2 text-left text-sm"
                onClick={() => setWorkQueueOpen(true)}
              >
                <span className="flex items-start gap-2">
                  <ListTodo className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="font-medium">Add to work queue</span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      Create a Work Queue task from this review or media buyer note.
                    </span>
                  </span>
                </span>
              </Button>
              {review.suggestedActions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  variant={action.id === "continue" ? "default" : "outline"}
                  className="h-auto min-h-9 justify-start whitespace-normal py-2 text-left text-sm"
                  onClick={() => applyAction(action)}
                  disabled={resolving}
                >
                  <span>
                    <span className="font-medium">{action.label}</span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {action.description}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </div>
        </div>

        <AddToWorkQueueDialog
          open={workQueueOpen}
          onOpenChange={setWorkQueueOpen}
          review={review}
          mediaBuyerNote={mediaBuyerNote}
          workspaceId={workspaceId}
          actorEmployeeId={actorEmployeeId}
          onTaskCreated={onMemoryRecorded}
        />
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}
