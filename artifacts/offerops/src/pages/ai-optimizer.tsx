import { useMemo, useRef, useState } from "react";
import { Upload, FileText, Download, ArrowRight, ArrowLeft, CheckCircle2, AlertTriangle } from "lucide-react";
import { authedJson } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildDistribution,
  validatePathCount,
  withNewCampaignIndex,
  type AnalyzeResponse,
  type DecisionRecord,
} from "@/lib/ai-optimizer";

type LoadedFile = { name: string; text: string; approxRows: number };
type Step = 1 | 2 | 3 | 4;
type DecisionFilter = "all" | "keep" | "remove" | "unmatched";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB — matches server body limit headroom.

/** Non-authoritative pre-analysis estimate (server returns exact counts). */
function estimateRows(text: string): number {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  return Math.max(0, lines.length - 1);
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "Upload files" },
  { id: 2, label: "Review matching & KPI" },
  { id: 3, label: "PATH distribution" },
  { id: 4, label: "Export" },
];

function decisionBadge(decision: DecisionRecord["decision"]) {
  if (decision === "KEEP") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">KEEP</Badge>;
  if (decision === "REMOVE") return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">REMOVE</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">UNMATCHED</Badge>;
}

function UploadCard({
  title,
  description,
  file,
  onFile,
  disabled,
}: {
  title: string;
  description: string;
  file: LoadedFile | null;
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-muted-foreground">{description}</p>
        <div
          role="button"
          tabIndex={0}
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !disabled) inputRef.current?.click();
          }}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (disabled) return;
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
          } ${disabled ? "pointer-events-none opacity-60" : ""}`}
        >
          <Upload className="h-5 w-5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Drag &amp; drop a .csv here, or click to choose
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </div>
        {file && (
          <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="truncate text-xs font-medium">{file.name}</span>
            <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
              ~{file.approxRows} rows
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AiOptimizer() {
  const [step, setStep] = useState<Step>(1);
  const [campaignFile, setCampaignFile] = useState<LoadedFile | null>(null);
  const [voluumFile, setVoluumFile] = useState<LoadedFile | null>(null);
  const [threshold, setThreshold] = useState("0.1");
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [pathCount, setPathCount] = useState("");
  const [filter, setFilter] = useState<DecisionFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<null | "campaign" | "report">(null);
  const [error, setError] = useState<string | null>(null);

  async function loadFile(kind: "campaign" | "voluum", f: File) {
    setError(null);
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError(`${f.name} is not a .csv file.`);
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setError(`${f.name} is larger than the ${MAX_FILE_BYTES / (1024 * 1024)} MB limit.`);
      return;
    }
    const text = await f.text();
    const loaded: LoadedFile = { name: f.name, text, approxRows: estimateRows(text) };
    if (kind === "campaign") setCampaignFile(loaded);
    else setVoluumFile(loaded);
    // Any new upload invalidates a prior analysis.
    setAnalysis(null);
    setPathCount("");
    setStep(1);
  }

  const retainedCount = analysis?.summary.retainedTotal ?? 0;
  const pathCountNum = Number(pathCount);
  const pathError =
    pathCount.trim() === ""
      ? null
      : validatePathCount(retainedCount, pathCountNum);
  const pathValid = pathCount.trim() !== "" && pathError === null;

  const decisionsWithIndex = useMemo(() => {
    if (!analysis) return [] as DecisionRecord[];
    if (!pathValid) return analysis.decisions;
    return withNewCampaignIndex(analysis.decisions, pathCountNum);
  }, [analysis, pathValid, pathCountNum]);

  const distribution = useMemo(() => {
    if (!pathValid) return [];
    return buildDistribution(retainedCount, pathCountNum);
  }, [pathValid, retainedCount, pathCountNum]);

  const filteredDecisions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return decisionsWithIndex.filter((d) => {
      if (filter === "keep" && d.decision !== "KEEP") return false;
      if (filter === "remove" && d.decision !== "REMOVE") return false;
      if (filter === "unmatched" && d.decision !== "UNMATCHED") return false;
      if (q) {
        const hay = `${d.brandName} ${d.offerId ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [decisionsWithIndex, filter, search]);

  async function runAnalyze() {
    if (!campaignFile || !voluumFile) {
      setError("Upload both the Campaign CSV and the Voluum CSV.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await authedJson<AnalyzeResponse>("/api/ai-optimizer/analyze", {
        method: "POST",
        body: JSON.stringify({
          campaignCsv: campaignFile.text,
          voluumCsv: voluumFile.text,
          revenueThreshold: threshold,
        }),
      });
      setAnalysis(res);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runExport(exportType: "campaign" | "report") {
    if (!campaignFile || !voluumFile || !pathValid) return;
    setExporting(exportType);
    setError(null);
    try {
      const res = await authedJson<{ filename: string; csv: string }>(
        "/api/ai-optimizer/export",
        {
          method: "POST",
          body: JSON.stringify({
            campaignCsv: campaignFile.text,
            voluumCsv: voluumFile.text,
            revenueThreshold: threshold,
            pathCount: pathCountNum,
            exportType,
            campaignFileName: campaignFile.name,
          }),
        },
      );
      downloadCsv(res.filename, res.csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  }

  const allRemoved = analysis != null && retainedCount === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Optimizer</h1>
        <p className="text-sm text-muted-foreground">
          Deterministic Campaign optimization: match Offers to Voluum revenue, apply a KPI rule,
          and rebalance retained Offers across PATHs.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((s, i) => {
          const active = s.id === step;
          const done = s.id < step;
          return (
            <div key={s.id} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-muted-foreground/20 bg-muted/40 text-muted-foreground"
                }`}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black/10 text-[10px]">
                  {done ? "✓" : s.id}
                </span>
                {s.label}
              </div>
              {i < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* STEP 1 — Upload */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <UploadCard
              title="Campaign File"
              description="Required columns: Campaign index, Brand Name. All original columns and order are preserved on export."
              file={campaignFile}
              onFile={(f) => void loadFile("campaign", f)}
              disabled={loading}
            />
            <UploadCard
              title="Voluum Data File"
              description="Needs a Revenue column and a Brand Name (explicit column, or the final ; segment of ctrl_info)."
              file={voluumFile}
              onFile={(f) => void loadFile("voluum", f)}
              disabled={loading}
            />
          </div>

          <Card>
            <CardContent className="flex flex-wrap items-end gap-4 pt-6">
              <div className="w-40">
                <Label htmlFor="threshold" className="text-xs">Minimum Revenue</Label>
                <Input
                  id="threshold"
                  className="mt-1 h-9"
                  type="number"
                  step="any"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  disabled={loading}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Rule: Revenue greater than {threshold || "0.1"}</p>
              </div>
              <Button
                onClick={() => void runAnalyze()}
                disabled={loading || !campaignFile || !voluumFile}
              >
                {loading ? "Analyzing…" : "Analyze"}
                {!loading && <ArrowRight className="ml-1.5 h-4 w-4" />}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 2 — Review */}
      {step === 2 && analysis && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-muted px-2.5 py-1 font-medium">{analysis.summary.campaignRows} campaign rows</span>
            <span className="rounded-full bg-muted px-2.5 py-1 font-medium">{analysis.summary.voluumRows} voluum rows</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium">{analysis.summary.matchedRows} matched</span>
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-800">{analysis.summary.keep} keep</span>
            <span className="rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-800">{analysis.summary.remove} remove</span>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">{analysis.summary.unmatched} unmatched</span>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">{analysis.summary.retainedTotal} retained total</span>
          </div>

          {analysis.warnings.map((w) => (
            <div key={w} className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{w}</span>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "keep", "remove", "unmatched"] as DecisionFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  filter === f ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/20 hover:bg-muted"
                }`}
              >
                {f}
              </button>
            ))}
            <Input
              className="ml-auto h-8 w-56"
              placeholder="Search Brand Name or Offer ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="max-h-[420px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Pos.</TableHead>
                  <TableHead>Brand Name</TableHead>
                  <TableHead>Offer ID</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Old Idx</TableHead>
                  <TableHead>New Idx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDecisions.map((d) => (
                  <TableRow key={d.originalPosition}>
                    <TableCell className="text-xs text-muted-foreground">{d.originalPosition}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs font-medium">{d.brandName || "—"}</TableCell>
                    <TableCell className="text-xs">{d.offerId ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{d.revenue == null ? "—" : d.revenue}</TableCell>
                    <TableCell>{decisionBadge(d.decision)}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground" title={d.reason}>{d.reason}</TableCell>
                    <TableCell className="text-xs">{d.oldCampaignIndex || "—"}</TableCell>
                    <TableCell className="text-xs font-medium">{d.newCampaignIndex || "—"}</TableCell>
                  </TableRow>
                ))}
                {filteredDecisions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-xs text-muted-foreground">No rows match the current filter/search.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
            </Button>
            {allRemoved ? (
              <span className="text-sm font-medium text-destructive">All Offers were removed — nothing to distribute or export.</span>
            ) : (
              <Button onClick={() => setStep(3)}>
                Choose PATH distribution <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* STEP 3 — Distribution */}
      {step === 3 && analysis && (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-4 pt-6">
              <div>
                <p className="text-xs text-muted-foreground">Offers remaining</p>
                <p className="text-2xl font-bold">{retainedCount}</p>
              </div>
              <div className="w-40">
                <Label htmlFor="pathCount" className="text-xs">Number of PATHS</Label>
                <Input
                  id="pathCount"
                  className="mt-1 h-9"
                  type="number"
                  min={1}
                  max={retainedCount}
                  value={pathCount}
                  onChange={(e) => setPathCount(e.target.value)}
                  placeholder="e.g. 10"
                />
              </div>
              {pathError && <p className="text-xs text-destructive">{pathError}</p>}
            </CardContent>
          </Card>

          {pathValid && (
            <div className="max-h-[360px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign Index</TableHead>
                    <TableHead className="text-right">Offer Count</TableHead>
                    <TableHead>Retained Position Range</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {distribution.map((b) => (
                    <TableRow key={b.campaignIndex}>
                      <TableCell className="text-xs font-medium">{b.campaignIndex}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{b.offerCount}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        retained positions {b.startPosition}–{b.endPosition}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Positions refer to the retained sequence. The Decision Report also records each row's original Campaign position.
          </p>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(4)} disabled={!pathValid}>
              Continue to export <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4 — Export */}
      {step === 4 && analysis && pathValid && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Ready to export
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>{retainedCount} retained Offers across {pathCountNum} PATHs (cmp01–{buildDistribution(retainedCount, pathCountNum).at(-1)?.campaignIndex}).</p>
              <p className="text-xs text-muted-foreground">
                {analysis.summary.keep} kept · {analysis.summary.unmatched} unmatched (preserved) · {analysis.summary.remove} removed.
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="space-y-2 pt-6">
                <p className="text-sm font-medium">Optimized Campaign CSV</p>
                <p className="text-xs text-muted-foreground">Retained rows only, original columns preserved, Campaign index rewritten to the new CMP assignment.</p>
                <Button onClick={() => void runExport("campaign")} disabled={exporting !== null}>
                  <Download className="mr-1.5 h-4 w-4" />
                  {exporting === "campaign" ? "Preparing…" : "Download optimized Campaign"}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2 pt-6">
                <p className="text-sm font-medium">Decision Report CSV</p>
                <p className="text-xs text-muted-foreground">Every Campaign row with its decision, reason, match status, and old/new index.</p>
                <Button variant="outline" onClick={() => void runExport("report")} disabled={exporting !== null}>
                  <Download className="mr-1.5 h-4 w-4" />
                  {exporting === "report" ? "Preparing…" : "Download decision report"}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(3)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
