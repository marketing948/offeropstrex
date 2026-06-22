import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, AlertTriangle } from "lucide-react";
import {
  upsertWorkerGoal,
  DuplicateGoalError,
  type UpsertWorkerGoalPayload,
} from "@/lib/performance-engine/api";

type Employee = { id: number; name: string };
type Network = { id: number; name: string };
type Geo = { id: number; code: string };

type GoalMetric = "revenue" | "testingBatches" | "workingCampaigns";

type GoalRowState = {
  enabled: boolean;
  target: string;
  xp: string;
};

const METRIC_ROWS: {
  key: GoalMetric;
  title: string;
  targetLabel: string;
  targetPlaceholder: string;
  defaultXp: string;
}[] = [
  {
    key: "revenue",
    title: "Revenue Goal",
    targetLabel: "Target revenue ($)",
    targetPlaceholder: "0",
    defaultXp: "500",
  },
  {
    key: "testingBatches",
    title: "Testing Goal",
    targetLabel: "Target tests / batches",
    targetPlaceholder: "0",
    defaultXp: "200",
  },
  {
    key: "workingCampaigns",
    title: "Working Campaigns Goal",
    targetLabel: "Target working campaigns",
    targetPlaceholder: "0",
    defaultXp: "300",
  },
];

function emptyRows(): Record<GoalMetric, GoalRowState> {
  return {
    revenue: { enabled: false, target: "", xp: "500" },
    testingBatches: { enabled: false, target: "", xp: "200" },
    workingCampaigns: { enabled: false, target: "", xp: "300" },
  };
}

export function CreateGoalPlanModal({
  open,
  onOpenChange,
  workspaceId,
  monthKey,
  employees,
  networks,
  geos,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: number;
  monthKey: string;
  employees: Employee[];
  networks: Network[];
  geos: Geo[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [duplicateConflict, setDuplicateConflict] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [employeeId, setEmployeeId] = useState<number>(employees[0]?.id ?? 0);
  const [month, setMonth] = useState(monthKey);
  const [rows, setRows] = useState(emptyRows);
  const [networkName, setNetworkName] = useState("");
  const [geoCode, setGeoCode] = useState("");

  function resetForm() {
    setRows(emptyRows());
    setNetworkName("");
    setGeoCode("");
    setDuplicateConflict(false);
    setAdvancedOpen(false);
    setMonth(monthKey);
    setEmployeeId(employees[0]?.id ?? 0);
  }

  function updateRow(metric: GoalMetric, patch: Partial<GoalRowState>) {
    setRows((prev) => ({ ...prev, [metric]: { ...prev[metric], ...patch } }));
  }

  function buildSpecs(): UpsertWorkerGoalPayload["goal"][] {
    const emp = employees.find((e) => e.id === employeeId);
    const base = {
      employeeId,
      employeeName: emp?.name,
      monthKey: month,
      isActive: true,
      affiliateNetworkId: networkName ? networks.find((n) => n.name === networkName)?.id ?? null : null,
      affiliateNetworkName: networkName || null,
      geoId: geoCode ? geos.find((g) => g.code === geoCode)?.id ?? null : null,
      geoCode: geoCode || null,
    };

    const specs: UpsertWorkerGoalPayload["goal"][] = [];
    const ts = Date.now();

    for (const def of METRIC_ROWS) {
      const row = rows[def.key];
      if (!row.enabled || Number(row.target) <= 0) continue;
      specs.push({
        ...base,
        id: `wg_${def.key}_${employeeId}_${month}_${ts}_${specs.length}`,
        metricKey: def.key,
        monthlyTarget: Number(row.target),
        xpReward: Number(row.xp) || 0,
      });
    }
    return specs;
  }

  async function saveGoals(replaceExisting = false) {
    setSaving(true);
    setDuplicateConflict(false);

    const specs = buildSpecs();
    if (specs.length === 0) {
      toast({ title: "Enable at least one goal with a target", variant: "destructive" });
      setSaving(false);
      return;
    }

    try {
      for (const goal of specs) {
        await upsertWorkerGoal({ workspaceId, goal, replaceExisting });
      }
      toast({ title: "Monthly goal plan saved" });
      onSaved();
      onOpenChange(false);
      resetForm();
    } catch (err) {
      if (err instanceof DuplicateGoalError) {
        setDuplicateConflict(true);
        toast({
          title: "Duplicate goal",
          description: "A goal already exists for this worker/month/metric/scope.",
          variant: "destructive",
        });
      } else {
        const msg = err instanceof Error ? err.message : "Save failed";
        toast({ title: "Save failed", description: msg, variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-[760px] w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Monthly Goal Plan</DialogTitle>
          <DialogDescription>
            Set monthly targets and XP rewards for a worker.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Month</Label>
            <Input type="month" className="mt-1" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div>
            <Label>Worker</Label>
            <Select value={String(employeeId)} onValueChange={(v) => setEmployeeId(Number(v))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select worker" /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Goal Targets</h3>
          {METRIC_ROWS.map((def) => {
            const row = rows[def.key];
            return (
              <div
                key={def.key}
                className={`rounded-lg border p-4 transition-colors ${
                  row.enabled ? "border-border bg-card" : "border-dashed bg-muted/20"
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="font-medium text-sm">{def.title}</p>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`enable-${def.key}`} className="text-xs text-muted-foreground">
                      Enabled
                    </Label>
                    <Switch
                      id={`enable-${def.key}`}
                      checked={row.enabled}
                      onCheckedChange={(v) => updateRow(def.key, { enabled: v })}
                    />
                  </div>
                </div>
                {row.enabled && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">{def.targetLabel}</Label>
                      <Input
                        type="number"
                        min={0}
                        className="mt-1"
                        placeholder={def.targetPlaceholder}
                        value={row.target}
                        onChange={(e) => updateRow(def.key, { target: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">XP reward</Label>
                      <Input
                        type="number"
                        min={0}
                        className="mt-1"
                        value={row.xp}
                        onChange={(e) => updateRow(def.key, { xp: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/40"
            >
              Advanced Breakdown
              <ChevronDown size={16} className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Optional network / GEO scope for all enabled goals in this plan. Leave blank for worker-wide targets.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Affiliate Network</Label>
                <Select value={networkName || "none"} onValueChange={(v) => setNetworkName(v === "none" ? "" : v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any network</SelectItem>
                    {networks.map((n) => (
                      <SelectItem key={n.id} value={n.name}>{n.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>GEO</Label>
                <Select value={geoCode || "none"} onValueChange={(v) => setGeoCode(v === "none" ? "" : v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any GEO</SelectItem>
                    {geos.map((g) => (
                      <SelectItem key={g.id} value={g.code}>{g.code}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {duplicateConflict && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 flex gap-2 text-sm">
            <AlertTriangle className="text-destructive shrink-0 mt-0.5" size={16} />
            <div>
              <p className="font-medium text-destructive">A goal already exists for this worker/month/metric/scope.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Replace the existing goal to update targets, or cancel and adjust your selection.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          {duplicateConflict && (
            <Button variant="secondary" disabled={saving} onClick={() => saveGoals(true)}>
              Replace existing goal
            </Button>
          )}
          <Button disabled={saving} onClick={() => saveGoals(false)}>
            {saving ? "Saving…" : "Save Goal Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
