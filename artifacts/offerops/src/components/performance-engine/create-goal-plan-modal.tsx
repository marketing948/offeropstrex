import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { authedJson } from "@/lib/api-fetch";
import { replaceWorkerGoalPlan, resetWorkerGoalPlanNetwork, resetAllWorkerGoalPlan } from "@/lib/performance-engine/api";
import type { GoalMetric } from "@/lib/performance-engine/goal-plan-utils";
import {
  buildPlanHydrationKey,
  formatSharePreview,
  isPlanConfirmYes,
  loadPlanFromGoals,
  networkNamesInPlan,
  previewInheritedShares,
  shouldRehydratePlanForm,
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

type PendingScopeChange =
  | { type: "month"; value: string }
  | { type: "employee"; value: number }
  | { type: "network"; value: string };

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
  const [resetting, setResetting] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false);
  const [resetZoneOpen, setResetZoneOpen] = useState(false);
  const [resetNetworkName, setResetNetworkName] = useState("");
  const [resetNetworkYesText, setResetNetworkYesText] = useState("");
  const [deleteAllYesText, setDeleteAllYesText] = useState("");

  const [employeeId, setEmployeeId] = useState<number>(employees[0]?.id ?? 0);
  const [month, setMonth] = useState(monthKey);
  const [rows, setRows] = useState(emptyRows);
  const [networkName, setNetworkName] = useState("");
  const [selectedGeoCodes, setSelectedGeoCodes] = useState<Set<string>>(new Set());
  const [geoSearch, setGeoSearch] = useState("");
  const [overrides, setOverrides] = useState<GeoOverrideRow[]>([]);

  const lastHydratedKeyRef = useRef<string | null>(null);
  const createInitializedRef = useRef(false);
  const allGoalsRef = useRef(allGoals);
  const pendingScopeChangeRef = useRef<PendingScopeChange | null>(null);
  allGoalsRef.current = allGoals;

  const hasNetworkSelected = Boolean(networkName.trim());
  const resetNetworkYesOk = isPlanConfirmYes(resetNetworkYesText);
  const deleteAllYesOk = isPlanConfirmYes(deleteAllYesText);

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

  const resetNetworkOptions = useMemo(() => {
    const names = new Set<string>(existingNetworks);
    for (const n of workerNetworks) names.add(n.name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [existingNetworks, workerNetworks]);

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

  const networkForHydrationKey = networkName || editContext?.networkName || "";

  const hydrationKey = useMemo(() => {
    if (!open) return null;
    if (isEdit && editContext) {
      return buildPlanHydrationKey({
        mode: "edit",
        employeeId: editContext.employeeId,
        monthKey: editContext.monthKey,
        networkName: networkForHydrationKey,
      });
    }
    return buildPlanHydrationKey({
      mode: "create",
      employeeId,
      monthKey: month,
      networkName: networkForHydrationKey,
    });
  }, [open, isEdit, editContext, employeeId, month, networkForHydrationKey]);

  const markDirty = useCallback(() => {
    setIsDirty(true);
  }, []);

  const applyHydration = useCallback(
    (key: string) => {
      const goals = allGoalsRef.current;
      if (isEdit && editContext) {
        const net = networkForHydrationKey.trim() || null;
        const loaded = loadPlanFromGoals(
          goals,
          editContext.employeeId,
          editContext.monthKey,
          net,
        );
        setEmployeeId(editContext.employeeId);
        setMonth(editContext.monthKey);
        setRows(loaded.metrics);
        setOverrides(loaded.overrides);
        setSelectedGeoCodes(new Set(loaded.selectedGeoCodes));
        setNetworkName(net ?? "");
        setAdvancedOpen(true);
      }
      setGeoSearch("");
      setIsDirty(false);
      lastHydratedKeyRef.current = key;
    },
    [isEdit, editContext, networkForHydrationKey],
  );

  const initializeCreateForm = useCallback(() => {
    setRows(emptyRows());
    setNetworkName("");
    setSelectedGeoCodes(new Set());
    setOverrides([]);
    setAdvancedOpen(false);
    setMonth(monthKey);
    setEmployeeId(employees[0]?.id ?? 0);
    setGeoSearch("");
    setIsDirty(false);
    createInitializedRef.current = true;
    lastHydratedKeyRef.current = buildPlanHydrationKey({
      mode: "create",
      employeeId: employees[0]?.id ?? 0,
      monthKey,
      networkName: "",
    });
  }, [monthKey, employees]);

  useEffect(() => {
    if (!open) return;
    if (!isEdit) {
      if (!createInitializedRef.current) {
        initializeCreateForm();
      }
      return;
    }
    if (
      !shouldRehydratePlanForm({
        open,
        hydrationKey,
        lastHydratedKey: lastHydratedKeyRef.current,
        isDirty,
      })
    ) {
      return;
    }
    if (hydrationKey != null) {
      applyHydration(hydrationKey);
    }
  }, [open, isEdit, hydrationKey, isDirty, applyHydration, initializeCreateForm]);

  useEffect(() => {
    if (!open) {
      lastHydratedKeyRef.current = null;
      createInitializedRef.current = false;
      setIsDirty(false);
      setDiscardConfirmOpen(false);
      setResetConfirmOpen(false);
      setDeleteAllConfirmOpen(false);
      setResetZoneOpen(false);
      setResetNetworkName("");
      setResetNetworkYesText("");
      setDeleteAllYesText("");
      pendingScopeChangeRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!workerNetworksQ.isSuccess || !networkName || isDirty) return;
    const allowed = new Set([
      ...workerNetworks.map((n) => n.name),
      ...networkNamesInPlan(
        allGoalsRef.current.filter((g) => g.employeeId === employeeId && g.monthKey === month),
      ),
    ]);
    if (!allowed.has(networkName)) {
      setNetworkName("");
      lastHydratedKeyRef.current = null;
    }
  }, [employeeId, month, networkName, workerNetworks, workerNetworksQ.isSuccess, isDirty]);

  function resetForm() {
    setRows(emptyRows());
    setNetworkName("");
    setSelectedGeoCodes(new Set());
    setOverrides([]);
    setAdvancedOpen(false);
    setGeoSearch("");
    setMonth(monthKey);
    setEmployeeId(employees[0]?.id ?? 0);
    setIsDirty(false);
    setResetNetworkName("");
    setResetNetworkYesText("");
    setDeleteAllYesText("");
    lastHydratedKeyRef.current = null;
    createInitializedRef.current = false;
  }

  function applyScopeChange(change: PendingScopeChange) {
    pendingScopeChangeRef.current = null;
    setDiscardConfirmOpen(false);
    setIsDirty(false);
    if (isEdit && change.type === "network") {
      lastHydratedKeyRef.current = null;
    }
    switch (change.type) {
      case "month":
        setMonth(change.value);
        setNetworkName("");
        setSelectedGeoCodes(new Set());
        setOverrides([]);
        break;
      case "employee":
        setEmployeeId(change.value);
        setNetworkName("");
        setSelectedGeoCodes(new Set());
        setOverrides([]);
        break;
      case "network":
        setNetworkName(change.value);
        if (isEdit) {
          lastHydratedKeyRef.current = null;
        } else if (!change.value) {
          setSelectedGeoCodes(new Set());
          setOverrides([]);
        }
        break;
    }
  }

  function requestScopeChange(change: PendingScopeChange) {
    if (isDirty) {
      pendingScopeChangeRef.current = change;
      setDiscardConfirmOpen(true);
      return;
    }
    applyScopeChange(change);
  }

  function updateRow(metric: GoalMetric, patch: Partial<GoalRowState>) {
    markDirty();
    setRows((prev) => ({ ...prev, [metric]: { ...prev[metric], ...patch } }));
  }

  function toggleGeo(code: string, checked: boolean) {
    markDirty();
    setSelectedGeoCodes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function selectAllGeos() {
    markDirty();
    setSelectedGeoCodes(new Set(sortedGeos.map((g) => g.code)));
  }

  function clearAllGeos() {
    markDirty();
    setSelectedGeoCodes(new Set());
  }

  function addOverride() {
    markDirty();
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

    if (hasNetworkSelected) {
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
        affiliateNetworkName: hasNetworkSelected ? networkName : null,
        affiliateNetworkId: hasNetworkSelected
          ? (workerNetworks.find((n) => n.name === networkName)?.id ?? null)
          : null,
        selectedGeoCodes: hasNetworkSelected ? selectedGeoList : undefined,
        metrics: METRIC_ROWS.map((def) => ({
          metricKey: def.key,
          monthlyTarget: Number(rows[def.key].target) || 0,
          xpReward: Number(rows[def.key].xp) || 0,
          enabled: rows[def.key].enabled && Number(rows[def.key].target) > 0,
        })),
        geoOverrides: hasNetworkSelected
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

  async function confirmResetNetwork() {
    if (!resetNetworkName || !resetNetworkYesOk) return;
    const resetName = resetNetworkName;
    setResetting(true);
    try {
      await resetWorkerGoalPlanNetwork({
        workspaceId,
        employeeId,
        monthKey: month,
        affiliateNetworkName: resetName,
        confirmation: true,
      });
      if (networkName === resetName) {
        setRows(emptyRows());
        setSelectedGeoCodes(new Set());
        setOverrides([]);
        setNetworkName("");
        lastHydratedKeyRef.current = null;
      }
      setResetNetworkName("");
      setResetNetworkYesText("");
      setResetConfirmOpen(false);
      setIsDirty(false);
      toast({
        title: "Network goal scope reset",
        description: `${resetName} goals removed for this month.`,
      });
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Reset failed";
      toast({ title: "Reset failed", description: msg, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  async function confirmDeleteAllGoals() {
    if (!deleteAllYesOk) return;
    setDeletingAll(true);
    try {
      await resetAllWorkerGoalPlan({
        workspaceId,
        employeeId,
        monthKey: month,
        confirmation: true,
      });
      setRows(emptyRows());
      setNetworkName("");
      setSelectedGeoCodes(new Set());
      setOverrides([]);
      setDeleteAllYesText("");
      setDeleteAllConfirmOpen(false);
      setIsDirty(false);
      lastHydratedKeyRef.current = null;
      toast({
        title: "All goals deleted",
        description: `Removed all goal plans for ${workerLabel} in ${month}.`,
      });
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
    } finally {
      setDeletingAll(false);
    }
  }

  const workerLabel = employees.find((e) => e.id === employeeId)?.name ?? "worker";

  return (
    <>
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
                onChange={(e) => requestScopeChange({ type: "month", value: e.target.value })}
                disabled={isEdit}
              />
            </div>
            <div>
              <Label>Worker</Label>
              <Select
                value={String(employeeId)}
                onValueChange={(v) => requestScopeChange({ type: "employee", value: Number(v) })}
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
                hasNetworkSelected && selectedGeoList.length > 0 && row.enabled && Number(row.target) > 0
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
              <div>
                <Label>Affiliate Network</Label>
                {employeeId <= 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">Select a worker first.</p>
                ) : workerNetworksQ.isLoading ? (
                  <p className="mt-1 text-xs text-muted-foreground">Loading networks…</p>
                ) : workerNetworks.length === 0 && existingNetworks.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose an affiliate network to distribute goals by GEO, or save worker-wide goals without a network.
                  </p>
                ) : (
                  <Select
                    value={networkName || "none"}
                    onValueChange={(v) =>
                      requestScopeChange({ type: "network", value: v === "none" ? "" : v })
                    }
                  >
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select network" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No network (worker-wide)</SelectItem>
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
                {!hasNetworkSelected && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Choose an affiliate network to distribute goals by GEO.
                  </p>
                )}
              </div>

              {hasNetworkSelected && (
                <>
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
                                  onValueChange={(v) => {
                                    markDirty();
                                    setOverrides((prev) =>
                                      prev.map((r, i) => (i === idx ? { ...r, geoCode: v } : r)),
                                    );
                                  }}
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
                                  onValueChange={(v) => {
                                    markDirty();
                                    setOverrides((prev) =>
                                      prev.map((r, i) =>
                                        i === idx ? { ...r, metricKey: v as GoalMetric } : r,
                                      ),
                                    );
                                  }}
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
                                  onChange={(e) => {
                                    markDirty();
                                    setOverrides((prev) =>
                                      prev.map((r, i) => (i === idx ? { ...r, target: e.target.value } : r)),
                                    );
                                  }}
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-destructive"
                                onClick={() => {
                                  markDirty();
                                  setOverrides((prev) => prev.filter((_, i) => i !== idx));
                                }}
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

          {isEdit && (
            <Collapsible open={resetZoneOpen} onOpenChange={setResetZoneOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-50"
                >
                  Danger Zone
                  <ChevronDown size={16} className={`transition-transform ${resetZoneOpen ? "rotate-180" : ""}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 space-y-6 rounded-lg border border-red-200 bg-red-50/30 p-3">
                <div className="space-y-3">
                  <p className="text-sm font-medium text-red-900">Reset selected network</p>
                  <p className="text-xs text-red-800">
                    Remove goal scope and GEO overrides for one affiliate network. Other networks are not affected.
                  </p>
                  <div>
                    <Label>Affiliate network</Label>
                    <Select value={resetNetworkName || "none"} onValueChange={(v) => setResetNetworkName(v === "none" ? "" : v)}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Choose network to reset" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" disabled>Choose network to reset</SelectItem>
                        {resetNetworkOptions.map((name) => (
                          <SelectItem key={name} value={name}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Type YES to confirm</Label>
                    <Input
                      className="mt-1"
                      placeholder="YES"
                      value={resetNetworkYesText}
                      onChange={(e) => setResetNetworkYesText(e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!resetNetworkName || !resetNetworkYesOk || resetting || deletingAll}
                    onClick={() => setResetConfirmOpen(true)}
                  >
                    {resetting ? "Resetting…" : "Reset selected network"}
                  </Button>
                </div>

                <div className="border-t border-red-200 pt-4 space-y-3">
                  <p className="text-sm font-medium text-red-900">Delete all goals for this worker/month</p>
                  <p className="text-xs text-red-800">
                    Removes every Performance Engine goal for {workerLabel} in {month}, including all networks and GEO overrides.
                  </p>
                  <div>
                    <Label>Type YES to confirm</Label>
                    <Input
                      className="mt-1"
                      placeholder="YES"
                      value={deleteAllYesText}
                      onChange={(e) => setDeleteAllYesText(e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!deleteAllYesOk || resetting || deletingAll}
                    onClick={() => setDeleteAllConfirmOpen(true)}
                  >
                    {deletingAll ? "Deleting…" : "Delete all goals for this worker/month"}
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          <DialogFooter className="gap-2 flex-wrap sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || resetting || deletingAll}>
              Cancel
            </Button>
            <Button
              disabled={saving || resetting || deletingAll}
              onClick={() => void savePlan()}
            >
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Save Goal Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing worker, month, or network will discard unsaved changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                pendingScopeChangeRef.current = null;
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = pendingScopeChangeRef.current;
                if (pending) applyScopeChange(pending);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset network goals?</AlertDialogTitle>
            <AlertDialogDescription>
              Reset goals for {resetNetworkName} in {month} for {workerLabel}? This cannot be undone after saving.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={resetting}
              onClick={(e) => {
                e.preventDefault();
                void confirmResetNetwork();
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteAllConfirmOpen} onOpenChange={setDeleteAllConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all goals?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete all goals for {workerLabel} in {month}? This removes every network and GEO goal for this month and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingAll}
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteAllGoals();
              }}
            >
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
