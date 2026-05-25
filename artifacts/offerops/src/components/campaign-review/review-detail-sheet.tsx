import { useLocation } from "wouter";
import type { ReviewQueueCampaign, SuggestedReviewAction } from "@/lib/campaign-review/types";
import { recordReviewEvent, dismissCampaignUntil } from "@/lib/campaign-review/memory";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CampaignHealthBadge } from "@/components/campaign-review/health-badge";
import { useToast } from "@/hooks/use-toast";

function fmt$(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function ReviewDetailSheet({
  item,
  open,
  onOpenChange,
  workspaceId,
  actorEmployeeId,
  onMemoryRecorded,
}: {
  item: ReviewQueueCampaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  actorEmployeeId: number;
  onMemoryRecorded: () => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  if (!item) return null;
  const review = item;

  function applyAction(action: SuggestedReviewAction) {
    recordReviewEvent(workspaceId, actorEmployeeId, {
      campaignId: review.campaignId,
      type: action.memoryType,
      actionId: action.id,
      note: action.label,
    });
    if (action.memoryType === "dismissed_signal") {
      dismissCampaignUntil(workspaceId, actorEmployeeId, review.campaignId, 8);
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
    }
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
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
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
              Signals use UI heuristics on imported metrics — not automated server rules.
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
              {review.suggestedActions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  variant={action.id === "continue" ? "default" : "outline"}
                  className="h-auto min-h-9 justify-start whitespace-normal py-2 text-left text-sm"
                  onClick={() => applyAction(action)}
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
