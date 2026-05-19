import { useState } from "react";
import { authedJson } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import { Input } from "@/components/ui/input";

const REASONS = [
  { value: "opened_by_mistake", label: "Opened by mistake" },
  { value: "no_traffic_dead_campaign", label: "No traffic / dead campaign" },
  { value: "technical_issue", label: "Technical issue" },
  { value: "winners_found", label: "Winners found" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

export type ManualCloseCampaignDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: number;
  campaignName: string;
  onClosed: () => void;
};

export function ManualCloseCampaignDialog({
  open,
  onOpenChange,
  campaignId,
  campaignName,
  onClosed,
}: ManualCloseCampaignDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState<Reason>("opened_by_mistake");
  const [note, setNote] = useState("");
  const [winnerOfferIds, setWinnerOfferIds] = useState("");
  const [pending, setPending] = useState(false);

  function parseWinnerOfferIds(raw: string): number[] {
    return raw
      .split(/[,\n\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  async function submit() {
    const parsedWinnerIds = parseWinnerOfferIds(winnerOfferIds);
    if (reason === "winners_found" && parsedWinnerIds.length === 0) {
      toast({
        title: "Winner offer IDs required",
        description: "Enter at least one winning Voluum/offer ID before closing.",
        variant: "destructive",
      });
      return;
    }

    setPending(true);
    try {
      const body: Record<string, unknown> = {
        reason,
        note: note.trim() || null,
      };
      if (reason === "winners_found") {
        body.winnerOfferIds = parsedWinnerIds;
      }

      const result = await authedJson<{
        missingWorkingCampaign?: boolean;
        followUpTaskIds?: number[];
      }>(`/api/campaigns/${campaignId}/manual-close`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (result.missingWorkingCampaign) {
        toast({
          title: "Campaign closed — working campaign missing",
          description: "A follow-up task was created to set up the working campaign before moving winners.",
        });
      } else if (reason === "winners_found") {
        toast({
          title: "Campaign closed",
          description: "A follow-up task was created. Offers are not moved automatically.",
        });
      } else {
        toast({ title: "Campaign closed" });
      }
      onClosed();
      onOpenChange(false);
      setNote("");
      setWinnerOfferIds("");
    } catch (e: unknown) {
      toast({
        title: "Could not close campaign",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close campaign</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Manually close <strong>{campaignName}</strong>. This does not stop the campaign in Voluum.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Reason *</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {reason === "winners_found" && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              This will create a follow-up task; offers are not moved automatically.
            </p>
          )}
          {reason === "winners_found" && (
            <div>
              <Label className="text-xs">Winner offer IDs *</Label>
              <Textarea
                className="mt-1 min-h-[4rem] font-mono text-sm"
                placeholder="e.g. 12, 34, 56 (comma or newline separated)"
                value={winnerOfferIds}
                onChange={(e) => setWinnerOfferIds(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Enter the winning Voluum/offer IDs to move to the working campaign.
              </p>
            </div>
          )}
          <div>
            <Label className="text-xs">Note</Label>
            <Textarea
              className="mt-1 min-h-[4rem]"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional context for operators"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={() => void submit()} disabled={pending}>
            {pending ? "Closing…" : "Close campaign"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
