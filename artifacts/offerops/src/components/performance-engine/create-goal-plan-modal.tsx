import { useState, useEffect, useMemo } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { ChevronDown, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { authedJson } from "@/lib/api-fetch";
import { replaceWorkerGoalPlan } from "@/lib/performance-engine/api";
import type { GoalMetric } from "@/lib/performance-engine/goal-plan-utils";
import {
  formatSharePreview,
  loadPlanFromGoals,
  networkNamesInPlan,
  previewInheritedShares,
} from "@/lib/performance-engine/goal-plan-utils";
import type { WorkerGoalTarget } from "@/lib/worker-goals";

type Employee = { id: number; name: string };
type Network = { id: number; name: string };
type Geo = { id: number; code: string };

type GoalRowState = {
  enabled: boolean;
  target: string;
  xp: string;
};

type GeoOverrideRow = {
  metricKey: GoalMetric;
  geoCode: string;
  target: string;
};

const METRIC_ROWS: {
  key: GoalMetric;
  title: string;
  targetLabel: string;
  targetPlaceholder: string;
  defaultXp: string;
  kind: "revenue" | "count";
}[] = [
  {
    key: "revenue",
    title: "Revenue Goal",
    targetLabel: "Target revenue ($)",
    targetPlaceholder: "0",
    defaultXp: "500",
    kind: "revenue",
  },
  {
    key: "testingBatches",
    title: "Testing Goal",
    targetLabel: "Target campaigns",
    targetPlaceholder: "0",
    defaultXp: "200",
    kind: "count",
  },
  {
    key: "workingCampaigns",
    title: "Working Campaigns Goal",
    targetLabel: "Target campaigns",
    targetPlaceholder: "0",
    defaultXp: "300",
    kind: "count",
  },
];

function emptyRows(): Record<GoalMetric, GoalRowState> {
  return {
    revenue: { enabled: false, target: "", xp: "500" },
    testingBatches: { enabled: false, target: "", xp: "200" },
    workingCampaigns: { enabled: false, target: "", xp: "300" },
  };
}

export type GoalPlanEditContext = {
  employeeId: number;
  monthKey: string;
  networkName?: string | null;
};

export function CreateGoalPlanModal({
  open,
  onOpenChange,
  workspaceId,
  monthKey,
  employees,
  geos,
  allGoals = [],
  editContext = null,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: number;
  monthKey: string;
  employees: Employee[];
  geos: Geo[];
  allGoals?: WorkerGoalTarget[];
  editContext?: GoalPlanEditContext | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = editContext != null;
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scopedToNetwork, setScopedToNetwork] = useState(false);

  const [employeeId, setEmployeeId] = useState<number>(employees[0]?.id ?? 0);
  const [month, setMonth] = useState(monthKey);
  const [rows, setRows] = useState(emptyRows);
  const [networkName, setNetworkName] = useState("");
  const [selectedGeoCodes, setSelectedGeoCodes] = useState<Set<string>>(new Set());
  const [geoSearch, setGeoSearch] = useState("");
  const [overrides, setOverrides] = useState<GeoOverrideRow[]>([]);

  const workerNetworksQ = useQuery({
    queryKey: ["worker-affiliate-networks", workspaceId, employeeId],
    enabled: open && workspaceId > 0 && employeeId > 0,
    queryFn: () =>
      authedJson<
        { affiliateNetworkId: number; affiliateNetworkName: string | null }[]
      >(`/api/worker-affiliate-networks?workspace_id=${workspaceId}&employee_id=${employeeId}`),
  });

  const workerNetworks: Network[] = useMemo(
    () =>
      (workerNetworksQ.data ?? [])
        .filter((r) => r.affiliateNetworkName)
        .map((r) => ({ id: r.affiliateNetworkId, name: r.affiliateNetworkName! })),
    [workerNetworksQ.data],
  );

  const existingNetworks = useMemo(
    () =>
      networkNamesInPlan(
        allGoals.filter((g) => g.employeeId === employeeId && g.monthKey === month),
      ),
    [allGoals, employeeId, month],
  );

  const sortedGeos = useMemo(
    () => [...geos].sort((a, b) => a.code.toUpperCase().localeCompare(b.code.toUpperCase())),
    [geos],
  );

  const filteredGeos = useMemo(() => {
    const q = geoSearch.trim().toUpperCase();
    if (!q) return sortedGeos;
    return sortedGeos.filter((g) => g.code.toUpperCase().includes(q));
  }, [sortedGeos, geoSearch]);

  const selectedGeoList = useMemo(
    () => [...selectedGeoCodes].sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase())),
    [selectedGeoCodes],
  );

  useEffect(() => {
    if (!open) return;
    if (editContext) {
      setEmployeeId(editContext.employeeId);
      setMonth(editContext.monthKey);
      const net = editContext.networkName ?? existingNetworks[0] ?? "";
      const loaded = loadPlanFromGoals(allGoals, editContext.employeeId, editContext.monthKey, net || null);
      setRows(loaded.metrics);
      setOverrides(loaded.overrides);
      setSelectedGeoCodes(new Set(loaded.selectedGeoCodes));
      setNetworkName(net);
      setScopedToNetwork(!!net);
      setAdvancedOpen(true);
      return;
    }
    setRows(emptyRows());
    setNetworkName("");
    setSelectedGeoCodes(new Set());
    setOverrides([]);
    setScopedToNetwork(false);
    setAdvancedOpen(false);
    setMonth(monthKey);
    setEmployeeId(employees[0]?.id ?? 0);
  }, [open, editContext, allGoals, existingNetworks, monthKey, employees]);

  useEffect(() => {
    if (networkName && !workerNetworks.some((n) => n.name === networkName)) {
      setNetworkName("");
    }
  }, [employeeId, networkName, workerNetworks]);

  function resetForm() {
    setRows(emptyRows());
    setNetworkName("");
    setSelectedGeoCodes(new Set());
    setOverrides([]);
    setScopedToNetwork(false);
    setAdvancedOpen(false);
    setGeoSearch("");
    setMonth(monthKey);
    setEmployeeId(employees[0]?.id ?? 0);
  }

  function updateRow(metric: GoalMetric, patch: Partial<GoalRowState>) {
    setRows((prev) => ({ ...prev, [metric]: { ...prev[metric], ...patch } }));
  }

  function toggleGeo(code: string, checked: boolean) {
    setSelectedGeoCodes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function selectAllGeos() {
    setSelectedGeoCodes(new Set(sortedGeos.map((g) => g.code)));
  }

  function clearAllGeos() {
    setSelectedGeoCodes(new Set());
  }

  function addOverride() {
    const geo = selectedGeoList[0];
    if (!geo) return;
    setOverrides((prev) => [
      ...prev,
      { metricKey: "revenue", geoCode: geo, target: "" },
    ]);
  }

  async function savePlan() {
    setSaving(true);
    const emp = employees.find((e) => e.id === employeeId);
    const enabledMetrics = METRIC_ROWS.filter((def) => {
      const row = rows[def.key];
      return row.enabled && Number(row.target) > 0;
    });

    if (enabledMetrics.length === 0) {
      toast({ title: "Enable at least one goal with a target", variant: "destructive" });
      setSaving(false);
      return;
    }

    if (scopedToNetwork) {
      if (!networkName) {
        toast({ title: "Select an affiliate network", variant: "destructive" });
        setSaving(false);
        return;
      }
      if (selectedGeoList.length === 0) {
        toast({ title: "Select at least one GEO for distribution", variant: "destructive" });
        setSaving(false);
        return;
      }
    }

    try {
      await replaceWorkerGoalPlan({
        workspaceId,
        employeeId,
        employeeName: emp?.name,
        monthKey: month,
        affiliateNetworkName: scopedToNetwork ? networkName : null,
        affiliateNetworkId: scopedToNetwork
          ? (workerNetworks.find((n) => n.name === networkName)?.id ?? null)
          : null,
        selectedGeoCodes: scopedToNetwork ? selectedGeoList : undefined,
        metrics: METRIC_ROWS.map((def) => ({
          metricKey: def.key,
          monthlyTarget: Number(rows[def.key].target) || 0,
          xpReward: Number(rows[def.key].xp) || 0,
          enabled: rows[def.key].enabled && Number(rows[def.key].target) > 0,
        })),
        geoOverrides: scopedToNetwork
          ? overrides
              .filter((o) => o.geoCode && o.target !== "")
              .map((o) => ({
                metricKey: o.metricKey,
                geoCode: o.geoCode,
                geoId: geos.find((g) => g.code === o.geoCode)?.id ?? null,
                monthlyTarget: Number(o.target),
              }))
          : undefined,
      });
      toast({ title: isEdit ? "Goal plan updated" : "Monthly goal plan saved" });
      onSaved();
      onOpenChange(false);
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
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
      <DialogContent className="max-w-[820px] w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Monthly Goal Plan" : "Create Monthly Goal Plan"}</DialogTitle>
          <DialogDescription>
            Set monthly targets and choose which GEOs receive inherited shares from network goals.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Month</Label>
            <Input
              type="month"
              className="mt-1"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              disabled={isEdit}
            />
          </div>
          <div>
            <Label>Worker</Label>
            <Select
              value={String(employeeId)}
              onValueChange={(v) => {
                setEmployeeId(Number(v));
                setNetworkName("");
              }}
              disabled={isEdit}
            >
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
            const preview =
              scopedToNetwork && networkName && selectedGeoList.length > 0 && row.enabled && Number(row.target) > 0
                ? formatSharePreview(def.key, Number(row.target), selectedGeoList.length)
                : null;
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
                  <>
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
                    {preview && (
                      <p className="mt-2 text-xs text-muted-foreground">Inherited split: {preview}</p>
                    )}
                  </>
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
              Network & GEO Scope
              <ChevronDown size={16} className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
              <div>
                <p className="text-sm font-medium">Scope goals to affiliate network</p>
                <p className="text-xs text-muted-foreground">
                  Required to choose GEOs for inherited breakdown before activity exists.
                </p>
              </div>
              <Switch checked={scopedToNetwork} onCheckedChange={setScopedToNetwork} />
            </div>

            {scopedToNetwork && (
              <>
                <div>
                  <Label>Affiliate Network</Label>
                  {employeeId <= 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">Select a worker first.</p>
                  ) : workerNetworksQ.isLoading ? (
                    <p className="mt-1 text-xs text-muted-foreground">Loading networks…</p>
                  ) : workerNetworks.length === 0 ? (
                    <div className="mt-1 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      No affiliate networks assigned to this worker. Assign networks before saving network goals.
                    </div>
                  ) : (
                    <Select value={networkName || "none"} onValueChange={(v) => setNetworkName(v === "none" ? "" : v)}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select network" /></SelectTrigger>
                      <SelectContent>
                        {workerNetworks.map((n) => (
                          <SelectItem key={n.id} value={n.name}>{n.name}</SelectItem>
                        ))}
                        {existingNetworks
                          .filter((name) => !workerNetworks.some((n) => n.name === name))
                          .map((name) => (
                            <SelectItem key={name} value={name}>{name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="rounded-lg border p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">Selected GEOs for distribution</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedGeoList.length} GEO{selectedGeoList.length === 1 ? "" : "s"} selected
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={selectAllGeos}>
                        Select all
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={clearAllGeos}>
                        Clear all
                      </Button>
                    </div>
                  </div>
                  <Input
                    placeholder="Search GEO…"
                    value={geoSearch}
                    onChange={(e) => setGeoSearch(e.target.value)}
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                    {filteredGeos.map((g) => (
                      <label
                        key={g.id}
                        className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={selectedGeoCodes.has(g.code)}
                          onCheckedChange={(v) => toggleGeo(g.code, v === true)}
                        />
                        <span>{g.code}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {selectedGeoList.length > 0 && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Custom GEO overrides</p>
                      <Button type="button" variant="outline" size="sm" onClick={addOverride}>
                        Add override
                      </Button>
                    </div>
                    {overrides.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Optional per-GEO custom targets replace inherited shares for that GEO.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {overrides.map((row, idx) => (
                          <div key={`${row.geoCode}-${idx}`} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                            <div>
                              <Label className="text-xs">GEO</Label>
                              <Select
                                value={row.geoCode}
                                onValueChange={(v) =>
                                  setOverrides((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, geoCode: v } : r)),
                                  )
                                }
                              >
                                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {selectedGeoList.map((code) => (
                                    <SelectItem key={code} value={code}>{code}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs">Metric</Label>
                              <Select
                                value={row.metricKey}
                                onValueChange={(v) =>
                                  setOverrides((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, metricKey: v as GoalMetric } : r,
                                    ),
                                  )
                                }
                              >
                                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {METRIC_ROWS.map((m) => (
                                    <SelectItem key={m.key} value={m.key}>{m.title}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs">Custom target</Label>
                              <Input
                                type="number"
                                min={0}
                                className="mt-1 h-9"
                                value={row.target}
                                onChange={(e) =>
                                  setOverrides((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, target: e.target.value } : r)),
                                  )
                                }
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-destructive"
                              onClick={() => setOverrides((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    {METRIC_ROWS.map((def) => {
                      if (!rows[def.key].enabled || Number(rows[def.key].target) <= 0) return null;
                      const shares = previewInheritedShares(
                        def.key,
                        Number(rows[def.key].target),
                        selectedGeoList,
                      );
                      if (shares.size === 0) return null;
                      return (
                        <div key={def.key} className="rounded-md bg-muted/30 px-3 py-2">
                          <p className="text-xs font-semibold text-muted-foreground mb-1">{def.title} preview</p>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedGeoList.map((code) => {
                              const custom = overrides.find(
                                (o) => o.metricKey === def.key && o.geoCode === code && o.target !== "",
                              );
                              const inherited = shares.get(code);
                              const isCustom = custom != null;
                              return (
                                <span
                                  key={code}
                                  className={`rounded border px-1.5 py-0.5 text-[11px] ${
                                    isCustom
                                      ? "border-blue-200 bg-blue-50 text-blue-700"
                                      : "border-slate-200 bg-white text-slate-600"
                                  }`}
                                >
                                  {code}{" "}
                                  {isCustom
                                    ? custom.target
                                    : def.key === "revenue"
                                      ? `$${(inherited ?? 0).toLocaleString()}`
                                      : inherited}
                                  {isCustom ? " custom" : " inherited"}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </CollapsibleContent>
        </Collapsible>

        <DialogFooter className="gap-2 flex-wrap sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={saving || (scopedToNetwork && workerNetworks.length === 0)}
            onClick={() => void savePlan()}
          >
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Save Goal Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditGoalPlanButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onClick}>
      <Pencil size={14} className="mr-1" />
      Edit Plan
    </Button>
  );
}
