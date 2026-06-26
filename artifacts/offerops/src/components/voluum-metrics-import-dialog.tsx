import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { authedJson } from "@/lib/api-fetch";
import { invalidateGoalSurfaces } from "@/lib/performance-engine/invalidate-goal-surfaces";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PreviewSummary = {
  totalRows: number;
  importable: number;
  updating: number;
  skipped: number;
  skippedExisting: number;
  duplicateCampaignIdsInCsv: number;
};

type PreviewRow = {
  lineNumber: number;
  voluumCampaignId: string | null;
  campaignId: number | null;
  campaignName: string | null;
  visits: number | null;
  conversions: number | null;
  cost: string | null;
  revenue: string | null;
  action: "import" | "update" | "skip";
  skipReason?: string;
};

type PreviewResponse = {
  date: string;
  summary: PreviewSummary;
  rows: PreviewRow[];
};

type ConfirmResponse = {
  date: string;
  override: boolean;
  imported: number;
  updated: number;
  skipped: number;
  skippedExisting: number;
  skippedBreakdown: Record<string, number>;
  duplicateCampaignIdsInCsv: number;
};

const SKIP_LABELS: Record<string, string> = {
  missing_campaign_id: "Missing Campaign ID",
  campaign_not_found: "Campaign not in workspace",
  missing_metrics: "Missing metrics",
  invalid_number: "Invalid number",
  not_allowed: "Not allowed",
  duplicate_in_csv: "Duplicate in CSV",
  existing_no_override: "Exists (override off)",
};

type Step = "pick" | "preview" | "done";

type VoluumMetricsImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  metricsDate: string;
  onMetricsDateChange: (date: string) => void;
  statusFilter: string;
};

export function VoluumMetricsImportDialog({
  open,
  onOpenChange,
  workspaceId,
  metricsDate,
  onMetricsDateChange,
  statusFilter,
}: VoluumMetricsImportDialogProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("pick");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmResponse | null>(null);
  const [override, setOverride] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetState() {
    setStep("pick");
    setCsvText("");
    setFileName(null);
    setPreview(null);
    setConfirmResult(null);
    setOverride(false);
    setLoading(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetState();
    onOpenChange(next);
  }

  async function handleFileChange(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a .csv file.");
      return;
    }
    setError(null);
    setFileName(file.name);
    const text = await file.text();
    setCsvText(text);
    setPreview(null);
    setConfirmResult(null);
    setStep("pick");
  }

  async function runPreview(overrideValue = override) {
    if (!csvText.trim()) {
      setError("Choose a CSV file first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await authedJson<PreviewResponse>(
        "/api/campaign-daily-metrics/voluum-import/preview",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId,
            date: metricsDate,
            csvText,
            override: overrideValue,
          }),
        },
      );
      setPreview(result);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  function handleOverrideChange(next: boolean) {
    setOverride(next);
    // Keep the preview honest: re-run with the new mode if one is showing.
    if (step === "preview" && csvText.trim()) {
      void runPreview(next);
    }
  }

  async function runConfirm() {
    if (!csvText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await authedJson<ConfirmResponse>(
        "/api/campaign-daily-metrics/voluum-import/confirm",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId,
            date: metricsDate,
            csvText,
            override,
          }),
        },
      );
      setConfirmResult(result);
      setStep("done");
      void queryClient.invalidateQueries({
        queryKey: ["campaign-daily-metrics", workspaceId, metricsDate, statusFilter],
      });
      invalidateGoalSurfaces(queryClient, workspaceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  const canConfirm =
    preview != null && preview.summary.importable + preview.summary.updating > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Voluum CSV metrics</DialogTitle>
          <DialogDescription>
            Rows match by Campaign ID to campaigns in this workspace. The Voluum Created column is
            ignored — all values apply to the selected metrics date.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Import metrics for date</label>
            <Input
              className="mt-1 h-9"
              type="date"
              value={metricsDate}
              onChange={(e) => onMetricsDateChange(e.target.value)}
              disabled={step === "done" || loading}
            />
          </div>

          {step !== "done" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Voluum CSV export</label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => void handleFileChange(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                >
                  <Upload className="mr-1.5 h-4 w-4" />
                  Choose CSV
                </Button>
                {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
              </div>
            </div>
          )}

          {step !== "done" && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2">
              <Checkbox
                id="voluum-override"
                checked={override}
                onCheckedChange={(v) => handleOverrideChange(v === true)}
                disabled={loading}
                className="mt-0.5"
              />
              <label htmlFor="voluum-override" className="text-sm leading-snug cursor-pointer">
                <span className="font-medium">Override existing data for matching campaigns and dates</span>
                <span className="block text-xs text-muted-foreground">
                  Off (default): existing rows for this date are kept and matching CSV rows are skipped.
                  On: matching rows are replaced with the uploaded values.
                </span>
              </label>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              {error}
            </p>
          )}

          {preview && step !== "pick" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-muted px-2.5 py-1 font-medium">
                  {preview.summary.totalRows} rows
                </span>
                <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-1 font-medium">
                  {preview.summary.importable} to import
                </span>
                <span className="rounded-full bg-blue-100 text-blue-800 px-2.5 py-1 font-medium">
                  {preview.summary.updating} {override ? "to override" : "updating"}
                </span>
                {preview.summary.skippedExisting > 0 && (
                  <span className="rounded-full bg-slate-200 text-slate-800 px-2.5 py-1 font-medium">
                    {preview.summary.skippedExisting} existing kept
                  </span>
                )}
                <span className="rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 font-medium">
                  {preview.summary.skipped} skipped
                </span>
                {preview.summary.duplicateCampaignIdsInCsv > 0 && (
                  <span className="rounded-full bg-orange-100 text-orange-800 px-2.5 py-1 font-medium">
                    {preview.summary.duplicateCampaignIdsInCsv} duplicate IDs in CSV
                  </span>
                )}
              </div>

              <div className="rounded-md border overflow-x-auto max-h-64">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Campaign ID</TableHead>
                      <TableHead>Matched</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="text-right">Conv.</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row) => (
                      <TableRow key={`${row.lineNumber}-${row.voluumCampaignId ?? "x"}`}>
                        <TableCell className="text-xs text-muted-foreground">{row.lineNumber}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[120px] truncate">
                          {row.voluumCampaignId ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs max-w-[140px] truncate">
                          {row.campaignName ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.action === "skip"
                            ? SKIP_LABELS[row.skipReason ?? ""] ?? row.skipReason
                            : row.action}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{row.visits ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{row.conversions ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{row.cost ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{row.revenue ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {confirmResult && step === "done" && (
            <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm space-y-1">
              <p className="font-semibold">
                Import complete for {confirmResult.date}
                {confirmResult.override ? " (override on)" : ""}
              </p>
              <p>
                {confirmResult.imported} inserted · {confirmResult.updated} updated ·{" "}
                {confirmResult.skippedExisting} existing kept · {confirmResult.skipped} skipped
              </p>
              {confirmResult.duplicateCampaignIdsInCsv > 0 && (
                <p className="text-muted-foreground text-xs">
                  {confirmResult.duplicateCampaignIdsInCsv} duplicate Campaign IDs in CSV (last row used)
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {step === "pick" && (
            <>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void runPreview()} disabled={loading || !csvText}>
                {loading ? "Previewing…" : "Preview import"}
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button type="button" variant="outline" onClick={() => setStep("pick")} disabled={loading}>
                Back
              </Button>
              <Button
                type="button"
                onClick={() => void runConfirm()}
                disabled={loading || !canConfirm}
              >
                {loading ? "Importing…" : "Confirm import"}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button type="button" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
