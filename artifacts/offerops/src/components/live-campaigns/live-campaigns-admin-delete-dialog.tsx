import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CONFIRMATION_TEXT = "DELETE DATA";

type WorkspaceMember = {
  employeeId: number;
  employeeName: string;
  employeeRole: string;
};

type PreviewResponse = {
  workspaceId: number;
  employeeId: number;
  employeeName: string | null;
  dateFrom: string;
  dateTo: string;
  matchingRows: number;
  affectedCampaignsCount: number;
  sampleCampaigns: { id: number; name: string }[];
  confirmationRequired: string;
};

type DeleteResponse = {
  deleted: number;
  employeeName: string | null;
  dateFrom: string;
  dateTo: string;
  affectedCampaignsCount: number;
};

type Step = "filters" | "preview" | "done";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  onDeleted: () => void;
};

export function LiveCampaignsAdminDeleteDialog({ open, onOpenChange, workspaceId, onDeleted }: Props) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("filters");
  const [employeeId, setEmployeeId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<DeleteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: members = [] } = useQuery<WorkspaceMember[]>({
    queryKey: ["workspace-members", workspaceId],
    enabled: open && !!workspaceId,
    queryFn: () => authedJson(`/api/workspace-members?workspace_id=${workspaceId}`),
  });

  function resetState() {
    setStep("filters");
    setEmployeeId("");
    setDateFrom("");
    setDateTo("");
    setConfirmText("");
    setPreview(null);
    setResult(null);
    setLoading(false);
    setError(null);
  }

  useEffect(() => {
    if (!open) resetState();
  }, [open]);

  const filtersValid =
    employeeId !== "" && dateFrom !== "" && dateTo !== "" && dateFrom <= dateTo;

  async function runPreview() {
    if (!filtersValid) {
      setError("Select an employee and a valid date range (from ≤ to).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await authedJson<PreviewResponse>(
        "/api/campaign-daily-metrics/admin/delete-preview",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId,
            employeeId: Number(employeeId),
            dateFrom,
            dateTo,
          }),
        },
      );
      setPreview(res);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  async function runDelete() {
    if (confirmText !== CONFIRMATION_TEXT) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authedJson<DeleteResponse>(
        "/api/campaign-daily-metrics/admin/delete",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId,
            employeeId: Number(employeeId),
            dateFrom,
            dateTo,
            confirmationText: confirmText,
          }),
        },
      );
      setResult(res);
      setStep("done");
      void queryClient.invalidateQueries({ queryKey: ["campaign-daily-metrics"] });
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            Delete daily metrics by employee
          </DialogTitle>
          <DialogDescription>
            Permanently deletes Live Campaigns daily metric rows for one employee within a date
            range, in this workspace only. Campaign definitions, goals, and XP are not affected.
            Preview before deleting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="text-xs">Employee *</Label>
              <Select value={employeeId} onValueChange={setEmployeeId} disabled={step === "done"}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.employeeId} value={String(m.employeeId)}>
                      {m.employeeName || `Employee #${m.employeeId}`}
                      {m.employeeRole === "admin" ? " (admin)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date from *</Label>
              <Input
                className="mt-1 h-9"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                disabled={step === "done"}
              />
            </div>
            <div>
              <Label className="text-xs">Date to *</Label>
              <Input
                className="mt-1 h-9"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                disabled={step === "done"}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              {error}
            </p>
          )}

          {preview && step === "preview" && (
            <div className="space-y-3 rounded-md border border-amber-300/70 bg-amber-50/60 px-4 py-3 dark:bg-amber-950/20">
              <p className="text-sm font-semibold">
                This will permanently delete {preview.matchingRows} metric row
                {preview.matchingRows === 1 ? "" : "s"}.
              </p>
              <p className="text-xs text-muted-foreground">
                Employee: <strong>{preview.employeeName ?? `#${preview.employeeId}`}</strong> ·{" "}
                {preview.dateFrom} → {preview.dateTo} · {preview.affectedCampaignsCount} campaign
                {preview.affectedCampaignsCount === 1 ? "" : "s"} affected
              </p>
              {preview.sampleCampaigns.length > 0 && (
                <ul className="text-xs text-muted-foreground list-disc pl-5 max-h-28 overflow-y-auto">
                  {preview.sampleCampaigns.map((c) => (
                    <li key={c.id}>{c.name}</li>
                  ))}
                  {preview.affectedCampaignsCount > preview.sampleCampaigns.length && (
                    <li>
                      …and {preview.affectedCampaignsCount - preview.sampleCampaigns.length} more
                    </li>
                  )}
                </ul>
              )}
              {preview.matchingRows > 0 && (
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
              )}
            </div>
          )}

          {result && step === "done" && (
            <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm space-y-1">
              <p className="font-semibold">Deletion complete</p>
              <p>
                {result.deleted} row{result.deleted === 1 ? "" : "s"} deleted ·{" "}
                {result.affectedCampaignsCount} campaign
                {result.affectedCampaignsCount === 1 ? "" : "s"} ·{" "}
                {result.employeeName ?? ""} · {result.dateFrom} → {result.dateTo}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {step === "filters" && (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void runPreview()} disabled={loading || !filtersValid}>
                {loading ? "Checking…" : "Preview deletion"}
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button type="button" variant="outline" onClick={() => setStep("filters")} disabled={loading}>
                Back
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void runDelete()}
                disabled={loading || preview?.matchingRows === 0 || confirmText !== CONFIRMATION_TEXT}
              >
                {loading ? "Deleting…" : "Delete data"}
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
