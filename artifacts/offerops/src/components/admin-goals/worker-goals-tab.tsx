import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import {
  useListEmployees,
  useListAffiliateNetworks,
  useListGeos,
  getListEmployeesQueryKey,
  getListAffiliateNetworksQueryKey,
  getListGeosQueryKey,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import type { GoalsConfig } from "@/lib/goals-config";
import {
  WORKER_GOAL_METRIC_OPTIONS,
  isDuplicateWorkerGoal,
  summarizeWorkerGoalsByMetric,
  type WorkerGoalTarget,
} from "@/lib/worker-goals";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? "bg-green-600" : "bg-muted"
      }`}
      aria-pressed={checked}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

const selectCls =
  "w-full h-8 text-xs px-2 rounded-md border border-input bg-background truncate";

export function WorkerGoalsTab({ cfg, onChange }: { cfg: GoalsConfig; onChange: (c: GoalsConfig) => void }) {
  const { activeWorkspaceId } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;

  const { data: employees = [] } = useListEmployees(
    { workspace_id: wsId },
    wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey({ workspace_id: wsId })),
  );
  const { data: networks = [] } = useListAffiliateNetworks(
    { workspace_id: wsId },
    wsQueryOpts(activeWorkspaceId, getListAffiliateNetworksQueryKey({ workspace_id: wsId })),
  );
  const { data: geos = [] } = useListGeos(
    { workspace_id: wsId },
    wsQueryOpts(activeWorkspaceId, getListGeosQueryKey({ workspace_id: wsId })),
  );

  const [filterWorker, setFilterWorker] = useState<string>("");
  const [filterMetric, setFilterMetric] = useState<string>("");
  const [filterNetwork, setFilterNetwork] = useState<string>("");
  const [filterGeo, setFilterGeo] = useState<string>("");
  const [dupError, setDupError] = useState<string | null>(null);

  const goals = cfg.workerGoalTargets ?? [];

  const summary = useMemo(() => summarizeWorkerGoalsByMetric(goals), [goals]);

  const filteredGoals = useMemo(() => {
    return goals.filter((g) => {
      if (filterWorker && String(g.employeeId) !== filterWorker) return false;
      if (filterMetric && g.metricKey !== filterMetric) return false;
      if (filterNetwork && (g.affiliateNetworkName ?? "") !== filterNetwork) return false;
      if (filterGeo && (g.geoCode ?? "") !== filterGeo) return false;
      return true;
    });
  }, [goals, filterWorker, filterMetric, filterNetwork, filterGeo]);

  function updateGoal(id: string, patch: Partial<WorkerGoalTarget>) {
    setDupError(null);
    const next = goals.map((g) => (g.id === id ? { ...g, ...patch, updatedAt: new Date().toISOString() } : g));
    const updated = next.find((g) => g.id === id);
    if (updated && isDuplicateWorkerGoal(next, updated, id)) {
      setDupError("A goal with the same worker, metric, network, and GEO already exists.");
      return;
    }
    onChange({ ...cfg, workerGoalTargets: next });
  }

  function addGoal() {
    setDupError(null);
    const firstEmployee = employees[0];
    const row: WorkerGoalTarget = {
      id: `wg_${Date.now()}`,
      employeeId: firstEmployee?.id ?? 0,
      employeeName: firstEmployee?.name,
      affiliateNetworkId: null,
      affiliateNetworkName: null,
      geoId: null,
      geoCode: null,
      metricKey: "revenue",
      monthlyTarget: 1000,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    if (!firstEmployee) {
      setDupError("Add employees before creating worker goals.");
      return;
    }
    if (isDuplicateWorkerGoal(goals, row)) {
      setDupError("A goal with the same worker, metric, network, and GEO already exists.");
      return;
    }
    onChange({ ...cfg, workerGoalTargets: [...goals, row] });
  }

  function removeGoal(id: string) {
    setDupError(null);
    onChange({ ...cfg, workerGoalTargets: goals.filter((g) => g.id !== id) });
  }

  const networkOptions = useMemo(
    () => [...networks].sort((a, b) => a.name.localeCompare(b.name)),
    [networks],
  );
  const geoOptions = useMemo(
    () => [...geos].sort((a, b) => a.code.localeCompare(b.code)),
    [geos],
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Monthly targets by worker, network, and GEO. These targets drive Operation Hub and Reports Dashboard.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {(
          [
            { key: "revenue" as const, label: "Revenue", color: "border-green-200 bg-green-50" },
            { key: "testingBatches" as const, label: "Testing", color: "border-purple-200 bg-purple-50" },
            { key: "workingCampaigns" as const, label: "Working", color: "border-orange-200 bg-orange-50" },
          ] as const
        ).map((card) => (
          <div key={card.key} className={`rounded-lg border px-3 py-2 ${card.color}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{card.label} goals</p>
            <p className="text-sm font-semibold text-foreground">
              {summary[card.key].count} goals ·{" "}
              {card.key === "revenue"
                ? `$${summary[card.key].totalTarget.toLocaleString()}`
                : summary[card.key].totalTarget.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <FieldRow label="Filter worker">
          <select className={selectCls} value={filterWorker} onChange={(e) => setFilterWorker(e.target.value)}>
            <option value="">All workers</option>
            {employees.map((e) => (
              <option key={e.id} value={String(e.id)}>{e.name}</option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Filter metric">
          <select className={selectCls} value={filterMetric} onChange={(e) => setFilterMetric(e.target.value)}>
            <option value="">All metrics</option>
            {WORKER_GOAL_METRIC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Filter network">
          <select className={selectCls} value={filterNetwork} onChange={(e) => setFilterNetwork(e.target.value)}>
            <option value="">All networks</option>
            {networkOptions.map((n) => (
              <option key={n.id} value={n.name}>{n.name}</option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Filter GEO">
          <select className={selectCls} value={filterGeo} onChange={(e) => setFilterGeo(e.target.value)}>
            <option value="">All GEOs</option>
            {geoOptions.map((g) => (
              <option key={g.id} value={g.code}>{g.code}</option>
            ))}
          </select>
        </FieldRow>
      </div>

      {dupError && (
        <p className="text-xs text-destructive font-medium">{dupError}</p>
      )}

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addGoal} className="h-8 text-xs">
          <Plus size={12} className="mr-1" /> Add Worker Goal
        </Button>
      </div>

      {filteredGoals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 text-center py-8 text-sm text-muted-foreground">
          No worker goals match the current filters.
        </div>
      ) : (
        <div className="space-y-2">
          {filteredGoals.map((g) => (
            <div key={g.id} className="rounded-lg border border-border bg-card p-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 items-end">
                <FieldRow label="Worker *">
                  <select
                    className={selectCls}
                    value={g.employeeId || ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const emp = employees.find((x) => x.id === id);
                      updateGoal(g.id, { employeeId: id, employeeName: emp?.name });
                    }}
                  >
                    <option value="" disabled>Select worker</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </FieldRow>
                <FieldRow label="Metric *">
                  <select
                    className={selectCls}
                    value={g.metricKey}
                    onChange={(e) => updateGoal(g.id, { metricKey: e.target.value })}
                  >
                    {WORKER_GOAL_METRIC_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </FieldRow>
                <FieldRow label="Network">
                  <select
                    className={selectCls}
                    value={g.affiliateNetworkName ?? ""}
                    onChange={(e) => {
                      const name = e.target.value || null;
                      const net = networks.find((n) => n.name === name);
                      updateGoal(g.id, {
                        affiliateNetworkName: name,
                        affiliateNetworkId: net?.id ?? null,
                      });
                    }}
                  >
                    <option value="">Any network</option>
                    {networkOptions.map((n) => (
                      <option key={n.id} value={n.name}>{n.name}</option>
                    ))}
                  </select>
                </FieldRow>
                <FieldRow label="GEO">
                  <select
                    className={selectCls}
                    value={g.geoCode ?? ""}
                    onChange={(e) => {
                      const code = e.target.value || null;
                      const geo = geos.find((x) => x.code === code);
                      updateGoal(g.id, { geoCode: code, geoId: geo?.id ?? null });
                    }}
                  >
                    <option value="">Any GEO</option>
                    {geoOptions.map((geo) => (
                      <option key={geo.id} value={geo.code}>{geo.code}</option>
                    ))}
                  </select>
                </FieldRow>
                <FieldRow label="Monthly target *">
                  <Input
                    type="number"
                    min={1}
                    className="h-8 text-xs"
                    value={g.monthlyTarget}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v > 0) updateGoal(g.id, { monthlyTarget: v });
                    }}
                  />
                </FieldRow>
                <div className="flex items-end justify-between gap-2 pb-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">Active</span>
                    <Toggle checked={g.isActive} onChange={(v) => updateGoal(g.id, { isActive: v })} />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeGoal(g.id)}
                    className="text-muted-foreground hover:text-destructive p-1"
                    aria-label="Delete goal"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
