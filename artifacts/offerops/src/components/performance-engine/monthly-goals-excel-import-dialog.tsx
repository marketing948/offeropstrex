import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Upload } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  confirmMonthlyGoalsExcelImport,
  downloadMonthlyGoalsImportTemplate,
  GOALS_EXCEL_TEMPLATE_HEADERS,
  previewMonthlyGoalsExcelImport,
  type GoalsImportPreviewResponse,
} from "@/lib/performance-engine/api";
import { invalidateGoalSurfaces } from "@/lib/performance-engine/invalidate-goal-surfaces";

type Step = "pick" | "preview" | "done";

function statusClass(status: string): string {
  if (status === "valid") return "bg-green-100 text-green-800";
  if (status === "warning") return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function previewFailureMessage(result: GoalsImportPreviewResponse): string | null {
  if (result.errors.length > 0) return result.errors[0] ?? "Preview found errors.";
  if (result.rows.length === 0) return "No data rows found in Goals sheet.";
  if (!result.ok) return "Preview found validation errors. Fix the workbook and try again.";
  if (result.summary.validRows === 0 && result.summary.errorRows === 0) {
    return "No valid rows parsed. Check that the Goals sheet exists with the expected headers.";
  }
  return null;
}

export function MonthlyGoalsExcelImportDialog({
  open,
  onOpenChange,
  workspaceId,
  monthKey,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  monthKey: string;
  onImported: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("pick");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState("");
  const [preview, setPreview] = useState<GoalsImportPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetState() {
    setStep("pick");
    setFileName(null);
    setFileBase64("");
    setPreview(null);
    setLoading(false);
    setTemplateLoading(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetState();
    onOpenChange(next);
  }

  async function handleFileChange(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Please upload a .xlsx Excel workbook. CSV files are not supported.");
      setFileName(null);
      setFileBase64("");
      setPreview(null);
      return;
    }
    setError(null);
    setPreview(null);
    setStep("pick");
    try {
      setFileName(file.name);
      setFileBase64(await fileToBase64(file));
    } catch (e) {
      setFileName(null);
      setFileBase64("");
      setError(e instanceof Error ? e.message : "Failed to read file.");
    }
  }

  async function runPreview() {
    if (!fileBase64) {
      setError("Choose an Excel (.xlsx) file first.");
      return;
    }
    if (workspaceId <= 0) {
      setError("Select a workspace before importing goals.");
      return;
    }
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const result = await previewMonthlyGoalsExcelImport({
        workspaceId,
        fileName: fileName ?? "goals.xlsx",
        fileBase64,
      });
      setPreview(result);
      setStep("preview");
      const failure = previewFailureMessage(result);
      if (failure) setError(failure);
    } catch (e) {
      setPreview(null);
      setStep("pick");
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  async function runConfirm() {
    if (!preview || !preview.ok) return;
    setLoading(true);
    setError(null);
    try {
      await confirmMonthlyGoalsExcelImport({
        workspaceId,
        importMode: "UPSERT_ROWS_ONLY",
        checksum: preview.checksum,
        normalizedGoals: preview.normalizedGoals,
      });
      invalidateGoalSurfaces(qc, workspaceId, monthKey);
      void qc.invalidateQueries({ queryKey: ["goals-config"] });
      toast({ title: "Goals imported successfully" });
      onImported();
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  async function downloadTemplate() {
    if (workspaceId <= 0) {
      setError("Select a workspace before downloading the template.");
      return;
    }
    setTemplateLoading(true);
    setError(null);
    try {
      const blob = await downloadMonthlyGoalsImportTemplate(workspaceId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "monthly-goals-template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download template.");
    } finally {
      setTemplateLoading(false);
    }
  }

  const canConfirm =
    preview?.ok === true &&
    (preview.normalizedGoals.length ?? 0) > 0 &&
    preview.summary.errorRows === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Goals from Excel</DialogTitle>
          <DialogDescription>
            Upload a <strong>.xlsx</strong> workbook with a <strong>Goals</strong> sheet. Optional{" "}
            <strong>Geo Overrides</strong> sheet is supported. Always preview before confirming.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Expected Goals sheet columns</p>
            <p className="font-mono break-all">{GOALS_EXCEL_TEMPLATE_HEADERS}</p>
            <p>XP columns are optional. Blank XP uses defaults (revenue 500, testing 200, working 300).</p>
            <p>Import mode: UPSERT_ROWS_ONLY — only rows in the file are created/updated. Other goals are preserved.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void downloadTemplate()}
              disabled={loading || templateLoading || step === "done"}
            >
              {templateLoading ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Download size={14} className="mr-1.5" />
              )}
              Download XLSX template
            </Button>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="max-w-xs"
              disabled={loading || step === "done"}
              onChange={(e) => void handleFileChange(e.target.files?.[0])}
            />
            {fileName ? (
              <span className="text-sm text-foreground self-center">
                Selected: <strong>{fileName}</strong>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground self-center">No file selected</span>
            )}
          </div>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          ) : null}

          {preview ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-sm">
                <span>Valid rows: <strong>{preview.summary.validRows}</strong></span>
                <span>Errors: <strong>{preview.summary.errorRows}</strong></span>
                <span>Warnings: <strong>{preview.summary.warnings}</strong></span>
                <span>New goals: <strong>{preview.summary.newGoals}</strong></span>
                <span>Updated goals: <strong>{preview.summary.updatedGoals}</strong></span>
                <span>Skipped: <strong>{preview.summary.skippedRows}</strong></span>
              </div>

              {preview.errors.length > 0 ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 space-y-1">
                  {preview.errors.map((msg) => (
                    <p key={msg}>{msg}</p>
                  ))}
                </div>
              ) : null}

              {preview.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-1">
                  {preview.warnings.map((msg) => (
                    <p key={msg}>{msg}</p>
                  ))}
                </div>
              ) : null}

              {preview.rows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Row</TableHead>
                      <TableHead>Month</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Network</TableHead>
                      <TableHead>GEOs</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Rev XP</TableHead>
                      <TableHead className="text-right">Testing</TableHead>
                      <TableHead className="text-right">Test XP</TableHead>
                      <TableHead className="text-right">Working</TableHead>
                      <TableHead className="text-right">Work XP</TableHead>
                      <TableHead>Messages</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row) => (
                      <TableRow key={row.rowNumber}>
                        <TableCell>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusClass(row.status)}`}>
                            {row.status}
                          </span>
                        </TableCell>
                        <TableCell>{row.rowNumber}</TableCell>
                        <TableCell>{row.monthKey ?? "—"}</TableCell>
                        <TableCell>
                          <div>{row.employeeName ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{row.employeeEmail ?? ""}</div>
                        </TableCell>
                        <TableCell>{row.affiliateNetworkName ?? "—"}</TableCell>
                        <TableCell>{row.selectedGeoCodes.join(", ") || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.revenueTarget ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.revenueXp ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.testingTarget ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.testingXp ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.workingTarget ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.workingXp ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[220px]">
                          {row.messages.join(" ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  No preview rows returned. Check that the workbook has a Goals sheet with data rows.
                </div>
              )}
            </div>
          ) : null}

          {step === "done" ? (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              Import completed. Monthly Goals and related surfaces were refreshed.
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
            {step === "done" ? "Close" : "Cancel"}
          </Button>
          {step !== "done" ? (
            <Button variant="outline" onClick={() => void runPreview()} disabled={loading || !fileBase64}>
              {loading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Upload size={14} className="mr-1.5" />}
              Preview
            </Button>
          ) : null}
          {step === "preview" ? (
            <Button onClick={() => void runConfirm()} disabled={loading || !canConfirm}>
              Confirm Import
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
