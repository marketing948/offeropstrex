/**
 * Campaign Review — convert media buyer note / caption into a Work Queue MANUAL task.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { TodoTask } from "@workspace/api-client-react";
import { getListTodoTasksQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReviewQueueCampaign } from "@/lib/campaign-review/types";
import type { ReviewMemoryEvent } from "@/lib/campaign-review/types";
import { recordReviewEvent } from "@/lib/campaign-review/memory";
import {
  buildWorkQueueTaskDescription,
  resolveWorkQueueAssigneeId,
} from "@/lib/campaign-review/work-queue-task";
import { authedJson } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";

type DialogStep = "prompt" | "edit" | "direct";

export function AddToWorkQueueDialog({
  open,
  onOpenChange,
  review,
  mediaBuyerNote,
  workspaceId,
  actorEmployeeId,
  onTaskCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  review: ReviewQueueCampaign;
  mediaBuyerNote: ReviewMemoryEvent | null;
  workspaceId: number;
  actorEmployeeId: number;
  onTaskCreated?: () => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<DialogStep>("direct");
  const [caption, setCaption] = useState("");
  const [validationError, setValidationError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const noteText = mediaBuyerNote?.note?.trim() ?? "";

  useEffect(() => {
    if (!open) return;
    if (noteText) {
      setStep("prompt");
      setCaption(noteText);
    } else {
      setStep("direct");
      setCaption("");
    }
    setValidationError("");
    setSubmitting(false);
  }, [open, noteText]);

  function handleClose() {
    setValidationError("");
    onOpenChange(false);
  }

  async function createTask(captionText: string) {
    const trimmed = captionText.trim();
    if (!trimmed) {
      setValidationError("Task caption is required");
      return;
    }

    setSubmitting(true);
    setValidationError("");

    try {
      const assignedEmployeeId = resolveWorkQueueAssigneeId(review, actorEmployeeId);
      await authedJson<TodoTask>("/api/todo-tasks/manual", {
        method: "POST",
        body: JSON.stringify({
          workspaceId,
          assignedEmployeeId,
          title: trimmed,
          description: buildWorkQueueTaskDescription(review),
          priority: "medium",
          relatedBatchId: review.batchId ?? undefined,
          relatedCampaignId: review.campaignId,
        }),
      });

      recordReviewEvent(workspaceId, actorEmployeeId, {
        campaignId: review.campaignId,
        type: "action_taken",
        note: `Added to work queue: ${trimmed}`,
      });

      await queryClient.invalidateQueries({
        queryKey: getListTodoTasksQueryKey({ workspace_id: workspaceId }),
      });

      toast({
        title: "Added to work queue",
        description: "Task created and assigned in the Work Queue.",
        action: (
          <ToastAction altText="Open work queue" onClick={() => navigate("/tasks")}>
            Open work queue
          </ToastAction>
        ),
      });

      onTaskCreated?.();
      handleClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Could not add to work queue",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleUseNoteAsCaption() {
    void createTask(noteText);
  }

  function handleSubmitCaption() {
    void createTask(caption);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add to work queue</DialogTitle>
          {step === "prompt" ? (
            <DialogDescription>Use media buyer note as task caption?</DialogDescription>
          ) : (
            <DialogDescription>
              Create a Work Queue task for {review.campaignName}.
            </DialogDescription>
          )}
        </DialogHeader>

        {step === "prompt" && (
          <div className="space-y-4 py-1">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Media buyer note
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{noteText}</p>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
              <Button type="button" onClick={handleUseNoteAsCaption} disabled={submitting}>
                {submitting ? "Adding…" : "Use note as caption"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep("edit");
                  setCaption(noteText);
                  setValidationError("");
                }}
                disabled={submitting}
              >
                Update caption
              </Button>
              <Button type="button" variant="ghost" onClick={handleClose} disabled={submitting}>
                Cancel
              </Button>
            </DialogFooter>
          </div>
        )}

        {(step === "edit" || step === "direct") && (
          <div className="space-y-4 py-1">
            <div>
              <Label htmlFor="work-queue-caption" className="text-xs">
                Task caption
              </Label>
              <Textarea
                id="work-queue-caption"
                className="mt-1.5 min-h-[100px]"
                placeholder="Describe what the media buyer should fix or check..."
                value={caption}
                onChange={(e) => {
                  setCaption(e.target.value);
                  if (validationError && e.target.value.trim()) setValidationError("");
                }}
              />
              {validationError && (
                <p className="mt-1.5 text-xs text-destructive">{validationError}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSubmitCaption}
                disabled={submitting || !caption.trim()}
              >
                {submitting ? "Adding…" : "Add to work queue"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
