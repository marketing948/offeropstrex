import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { authedJson } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CONFIRMATION_TEXT = "DELETE BATCH";

type DeletionScope = {
  batch: { id: number; batchName: string; batchTag: string | null; status: string; workspaceId: number };
  deletes: {
    campaigns: number;
    offers: number;
    campaignDailyMetrics: number;
    campaignWinners: number;
    performance: number;
    batchResults: number;
    trackerCampaigns: number;
    voluumCampaignMappings: number;
    trafficSourceRuns: number;
    voluumOffers: number;
  };
  unlinks: { todoTasks: number; notifications: number; importedOffers: number };
  warning: string;
  confirmationRequired: string;
};

type DeleteResponse = DeletionScope & { deleted: true };

type Step = "preview" | "done";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  batch: { id: number; batchName: string } | null;
  onDeleted: () => void;
};

const DELETE_ROW_LABELS: Array<[keyof DeletionScope["deletes"], string]> = [
  ["campaigns", "Campaigns"],
  ["campaignDailyMetrics", "Daily metric rows"],
  ["offers", "Offers"],
  ["performance", "Performance rows"],
  ["batchResults", "Batch results"],
  ["trackerCampaigns", "Tracker campaigns"],
  ["trafficSourceRuns", "Traffic-source runs"],
  ["voluumCampaignMappings", "Voluum campaign mappings"],
  ["campaignWinners", "Campaign winners"],
  ["voluumOffers", "Voluum offers"],
];

export function AdminDeleteBatchDialog({ open, onOpenChange, workspaceId, batch, onDeleted }: Props) {
  const [step, setStep] = useState<Step>("preview");
  const [confirmText, setConfirmText] = useState("");
  const [preview, setPreview] = useState<DeletionScope | null>(null);
  const [result, setResult] = useState<DeleteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !batch) return;
    let cancelled = false;
    setStep("preview");
    setConfirmText("");
    setPreview(null);
    setResult(null);
    setError(null);
    setLoading(true);
    (async () => {
      try {
        const res = await authedJson<DeletionScope>("/api/testing-batches/admin/delete-preview", {
          method: "POST",
          body: JSON.stringify({ workspaceId, batchId: batch.id }),
        });
        if (!cancelled) setPreview(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Preview failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, batch, workspaceId]);

  async function runDelete() {
    if (!batch || confirmText !== CONFIRMATION_TEXT) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authedJson<DeleteResponse>("/api/testing-batches/admin/delete", {
        method: "POST",
        body: JSON.stringify({ workspaceId, batchId: batch.id, confirmationText: confirmText }),
      });
      setResult(res);
      setStep("done");
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  const totalDeletes = preview
    ? Object.values(preview.deletes).reduce((sum, n) => sum + n, 0)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            Delete batch
          </DialogTitle>
          <DialogDescription>
            Permanently deletes this batch and its dependent data in this workspace only. Employees,
            workspaces, networks, GEOs, traffic sources, and settings are never affected. Preview before
            deleting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {batch && (
            <div className="rounded-md border bg-muted/30 px-4 py-2.5">
              <p className="text-sm font-semibold">{batch.batchName}</p>
              {preview && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {preview.batch.batchTag ? `${preview.batch.batchTag} · ` : ""}
                  {preview.batch.status}
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              {error}
            </p>
          )}

          {loading && step === "preview" && !preview && (
            <p className="text-sm text-muted-foreground">Loading preview…</p>
          )}

          {preview && step === "preview" && (
            <div className="space-y-3 rounded-md border border-amber-300/70 bg-amber-50/60 px-4 py-3 dark:bg-amber-950/20">
              <p className="text-sm font-semibold">
                This permanently deletes {totalDeletes} related record{totalDeletes === 1 ? "" : "s"}.
              </p>
              <ul className="text-xs text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1">
                {DELETE_ROW_LABELS.filter(([key]) => preview.deletes[key] > 0).map(([key, label]) => (
                  <li key={key} className="flex justify-between">
                    <span>{label}</span>
                    <span className="tabular-nums font-medium text-foreground">{preview.deletes[key]}</span>
                  </li>
                ))}
              </ul>
              {(preview.unlinks.todoTasks > 0 ||
                preview.unlinks.notifications > 0 ||
                preview.unlinks.importedOffers > 0) && (
                <p className="text-xs text-muted-foreground border-t border-amber-300/50 pt-2">
                  Kept but unlinked: {preview.unlinks.todoTasks} to-do task
                  {preview.unlinks.todoTasks === 1 ? "" : "s"}, {preview.unlinks.notifications} notification
                  {preview.unlinks.notifications === 1 ? "" : "s"}, {preview.unlinks.importedOffers} imported
                  offer{preview.unlinks.importedOffers === 1 ? "" : "s"}.
                </p>
              )}
              <p className="text-xs text-destructive">{preview.warning}</p>
              <div>
                <Label className="text-xs">
                  Type <span className="font-mono font-semibold">{CONFIRMATION_TEXT}</span> to confirm
                </Label>
                <Input
                  className="mt-1 h-9"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRMATION_TEXT}
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          {result && step === "done" && (
            <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm space-y-1">
              <p className="font-semibold">Batch deleted</p>
              <p className="text-xs text-muted-foreground">
                {result.batch.batchName} · {Object.values(result.deletes).reduce((s, n) => s + n, 0)} records
                removed
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {step === "preview" && (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void runDelete()}
                disabled={loading || !preview || confirmText !== CONFIRMATION_TEXT}
              >
                {loading ? "Deleting…" : "Delete batch"}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
