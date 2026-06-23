/**
 * Live Campaigns — send campaign to review (persists to review queue via API).
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { recordReviewEvent } from "@/lib/campaign-review/memory";
import { authedJson } from "@/lib/api-fetch";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace-context";
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

export function SendCampaignToReviewDialog({
  open,
  campaignId,
  campaignName,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean;
  campaignId: number | null;
  campaignName: string;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  function handleClose() {
    setNote("");
    onOpenChange(false);
  }

  async function handleSubmit() {
    if (!campaignId || !currentEmployee || !activeWorkspaceId) return;
    const trimmed = note.trim();
    if (!trimmed) {
      toast({
        title: "Add a review note",
        description: "Describe what needs to be checked before sending to review.",
        variant: "destructive",
      });
      return;
    }

    setPending(true);
    try {
      const result = await authedJson<{
        ok: boolean;
        created: boolean;
        eventId: number;
        campaignId: number;
      }>(`/api/campaigns/${campaignId}/request-review`, {
        method: "POST",
        body: JSON.stringify({ workspaceId: activeWorkspaceId, note: trimmed }),
      });

      recordReviewEvent(activeWorkspaceId, currentEmployee.id, {
        campaignId,
        type: "action_taken",
        note: trimmed,
      });

      await queryClient.invalidateQueries({
        queryKey: ["campaign-review-open", activeWorkspaceId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["campaign-review-live", activeWorkspaceId],
      });

      toast({
        title: result.created ? "Campaign sent to review" : "Already in review queue",
        description: result.created
          ? "The campaign now appears under Campaign Review → Requires Review."
          : "This campaign already has an open review request.",
        action: (
          <ToastAction
            altText="View in Campaign Review"
            onClick={() => navigate(`/campaign-review?campaignId=${campaignId}`)}
          >
            View in Campaign Review
          </ToastAction>
        ),
      });

      handleClose();
      onSubmitted?.();
    } catch (e: unknown) {
      toast({
        title: "Could not send to review",
        description: e instanceof Error ? e.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send campaign to review</DialogTitle>
          <DialogDescription>
            {campaignName
              ? `Add context for "${campaignName}". This creates a review queue item visible on Campaign Review.`
              : "Add context for this campaign. This creates a review queue item visible on Campaign Review."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="review-note">Review note</Label>
          <Textarea
            id="review-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What should be reviewed? (traffic, ROI, scaling, etc.)"
            rows={4}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={pending}>
            {pending ? "Sending…" : "Send to review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
