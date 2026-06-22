import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  currentMonthKey,
  upsertWorkerGoal,
  DuplicateGoalError,
  type UpsertWorkerGoalPayload,
} from "@/lib/performance-engine/api";

type Employee = { id: number; name: string };
type Network = { id: number; name: string };
type Geo = { id: number; code: string };

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
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState<number>(employees[0]?.id ?? 0);
  const [month, setMonth] = useState(monthKey);
  const [revenueTarget, setRevenueTarget] = useState("");
  const [testingTarget, setTestingTarget] = useState("");
  const [workingTarget, setWorkingTarget] = useState("");
  const [revenueXp, setRevenueXp] = useState("500");
  const [testingXp, setTestingXp] = useState("200");
  const [workingXp, setWorkingXp] = useState("300");
  const [networkName, setNetworkName] = useState<string>("");
  const [geoCode, setGeoCode] = useState<string>("");

  async function saveGoals(replaceExisting = false) {
    setSaving(true);
    setDuplicateId(null);
    const emp = employees.find((e) => e.id === employeeId);
    const specs: UpsertWorkerGoalPayload["goal"][] = [];

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

    if (Number(revenueTarget) > 0) {
      specs.push({
        ...base,
        id: `wg_rev_${employeeId}_${month}_${Date.now()}`,
        metricKey: "revenue",
        monthlyTarget: Number(revenueTarget),
        xpReward: Number(revenueXp) || 0,
      });
    }
    if (Number(testingTarget) > 0) {
      specs.push({
        ...base,
        id: `wg_test_${employeeId}_${month}_${Date.now() + 1}`,
        metricKey: "testingBatches",
        monthlyTarget: Number(testingTarget),
        xpReward: Number(testingXp) || 0,
      });
    }
    if (Number(workingTarget) > 0) {
      specs.push({
        ...base,
        id: `wg_work_${employeeId}_${month}_${Date.now() + 2}`,
        metricKey: "workingCampaigns",
        monthlyTarget: Number(workingTarget),
        xpReward: Number(workingXp) || 0,
      });
    }

    if (specs.length === 0) {
      toast({ title: "Add at least one target", variant: "destructive" });
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
      setStep(1);
    } catch (err) {
      if (err instanceof DuplicateGoalError) {
        setDuplicateId(err.existingGoal?.id ?? "conflict");
        toast({
          title: "Goal already exists",
          description: "Use Replace existing goal to update targets for this worker/month/metric.",
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Monthly Goal Plan — Step {step} of 4</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <div>
              <Label>Month</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div>
              <Label>Worker</Label>
              <Select value={String(employeeId)} onValueChange={(v) => setEmployeeId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Select worker" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Revenue goal ($)</Label>
              <Input type="number" min={0} value={revenueTarget} onChange={(e) => setRevenueTarget(e.target.value)} />
              <Label className="mt-2 text-xs text-muted-foreground">XP reward</Label>
              <Input type="number" min={0} value={revenueXp} onChange={(e) => setRevenueXp(e.target.value)} />
            </div>
            <div>
              <Label>Testing goal (count)</Label>
              <Input type="number" min={0} value={testingTarget} onChange={(e) => setTestingTarget(e.target.value)} />
              <Label className="mt-2 text-xs text-muted-foreground">XP reward</Label>
              <Input type="number" min={0} value={testingXp} onChange={(e) => setTestingXp(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Working campaigns goal</Label>
              <Input type="number" min={0} value={workingTarget} onChange={(e) => setWorkingTarget(e.target.value)} />
              <Label className="mt-2 text-xs text-muted-foreground">XP reward</Label>
              <Input type="number" min={0} value={workingXp} onChange={(e) => setWorkingXp(e.target.value)} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Optional breakdown dimensions (leave blank for worker-wide goals).</p>
            <div>
              <Label>Affiliate Network</Label>
              <Select value={networkName || "none"} onValueChange={(v) => setNetworkName(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any GEO</SelectItem>
                  {geos.map((g) => (
                    <SelectItem key={g.id} value={g.code}>{g.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-2 text-sm">
            <p><strong>Worker:</strong> {employees.find((e) => e.id === employeeId)?.name}</p>
            <p><strong>Month:</strong> {month}</p>
            {Number(revenueTarget) > 0 && <p>Revenue: ${Number(revenueTarget).toLocaleString()} · {revenueXp} XP</p>}
            {Number(testingTarget) > 0 && <p>Testing: {testingTarget} · {testingXp} XP</p>}
            {Number(workingTarget) > 0 && <p>Working: {workingTarget} · {workingXp} XP</p>}
            {duplicateId && (
              <p className="text-destructive text-xs">
                A matching goal exists. Save will fail unless you replace the existing goal.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>Back</Button>
          )}
          {step < 4 ? (
            <Button onClick={() => setStep((s) => s + 1)}>Continue</Button>
          ) : (
            <>
              <Button variant="outline" disabled={saving} onClick={() => saveGoals(true)}>
                Replace existing goal
              </Button>
              <Button disabled={saving} onClick={() => saveGoals(false)}>
                {saving ? "Saving…" : "Save plan"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
