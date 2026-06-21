/**
 * Live Campaigns — send campaign to review (local note capture).
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { recordReviewEvent } from "@/lib/campaign-review/memory";
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
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [note, setNote] = useState("");

  function handleClose() {
    setNote("");
    onOpenChange(false);
  }

  function handleSubmit() {
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

    // Client-side review memory only — no backend review-note API in this slice.
    recordReviewEvent(activeWorkspaceId, currentEmployee.id, {
      campaignId,
      type: "action_taken",
      note: trimmed,
    });

    toast({
      title: "Campaign sent to review",
      description: "Review note captured locally. Backend review-note storage is not wired yet.",
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
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send Campaign to review</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-left text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{campaignName}</p>
              <p>
                Describe what needs to be changed or checked before this campaign moves forward.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="review-note" className="text-xs">
              Review note
            </Label>
            <Textarea
              id="review-note"
              className="mt-1.5 min-h-[100px]"
              placeholder="Example: Check offer link, adjust GEO targeting, verify source settings..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3">
            <p className="text-xs font-semibold text-slate-700">Quick replies</p>
            {/* TODO: wire predefined review templates when backend/template source exists. */}
            <p className="mt-1 text-xs text-slate-500">Templates will be added later</p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit}>
            Send to review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
