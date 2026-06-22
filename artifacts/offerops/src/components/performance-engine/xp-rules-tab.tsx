import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import type { GoalsConfig, PointAction } from "@/lib/goals-config";
import {
  XP_ACTION_CATALOG,
  catalogCategoryGroups,
  getXpCatalogEntry,
  resolveXpCatalogFromRule,
  type CatalogAction,
  type ConnectionStatus,
} from "@/lib/performance-engine/action-catalog";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex-shrink-0" aria-pressed={checked}>
      <span
        className={`inline-block h-5 w-9 rounded-full transition-colors relative ${
          checked ? "bg-green-600" : "bg-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </span>
    </button>
  );
}

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  if (status === "connected") {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-200">
        Connected
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
      Not connected
    </span>
  );
}

function categoryToPointCategory(cat: string): PointAction["category"] {
  if (cat.includes("Winner")) return "winner";
  if (cat.includes("Optimization") || cat.includes("discipline")) return "discipline";
  if (cat.includes("Campaign")) return "activity";
  return "activity";
}

function ruleFromCatalog(entry: CatalogAction): PointAction {
  const legacyId = entry.legacyRuleIds?.[0] ?? entry.actionType;
  return {
    id: legacyId,
    actionType: entry.actionType,
    name: entry.label,
    description: entry.description,
    points: entry.defaultXp,
    enabled: entry.connectionStatus === "connected",
    category: categoryToPointCategory(entry.category),
  };
}

export function XpRulesTab({ cfg, onChange }: { cfg: GoalsConfig; onChange: (c: GoalsConfig) => void }) {
  const configuredTypes = new Set(cfg.pointActions.map((a) => a.actionType ?? a.id));
  const availableToAdd = XP_ACTION_CATALOG.filter((a) => !configuredTypes.has(a.actionType));

  function updateAction(id: string, patch: Partial<PointAction>) {
    onChange({
      ...cfg,
      pointActions: cfg.pointActions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  }

  function setActionType(id: string, actionType: string) {
    const entry = getXpCatalogEntry(actionType);
    if (!entry) return;
    updateAction(id, {
      actionType: entry.actionType,
      id: entry.legacyRuleIds?.[0] ?? entry.actionType,
      name: entry.label,
      description: entry.description,
      category: categoryToPointCategory(entry.category),
    });
  }

  function addRule(actionType: string) {
    const entry = getXpCatalogEntry(actionType);
    if (!entry) return;
    onChange({ ...cfg, pointActions: [...cfg.pointActions, ruleFromCatalog(entry)] });
  }

  function removeAction(id: string) {
    onChange({ ...cfg, pointActions: cfg.pointActions.filter((a) => a.id !== id) });
  }

  function updateWeight(key: keyof GoalsConfig["weights"], val: number) {
    onChange({ ...cfg, weights: { ...cfg.weights, [key]: val / 100 } });
  }

  const w = cfg.weights;
  const weightTotal = Math.round((w.activity + w.winner + w.optimization + w.discipline) * 100);

  const ruleGroups = new Map<string, { rule: PointAction; entry?: ReturnType<typeof getXpCatalogEntry> }[]>();
  for (const rule of cfg.pointActions) {
    const entry = resolveXpCatalogFromRule(rule);
    const cat = entry?.category ?? "Other";
    const list = ruleGroups.get(cat) ?? [];
    list.push({ rule, entry });
    ruleGroups.set(cat, list);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-blue-50/50 px-4 py-3 text-sm text-blue-950">
        <p className="font-medium">Action-based XP rewards</p>
        <p className="text-xs mt-1 text-blue-900/80">
          Choose real app action types. Only <strong>Connected</strong> actions award XP through the backend today.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">Score Category Weights</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(
            [
              ["activity", "Activity", "text-blue-700 bg-blue-50"],
              ["winner", "Winners", "text-green-700 bg-green-50"],
              ["optimization", "Optimization", "text-orange-700 bg-orange-50"],
              ["discipline", "Discipline", "text-purple-700 bg-purple-50"],
            ] as const
          ).map(([key, label, cls]) => (
            <div key={key} className={`rounded-lg p-3 ${cls.split(" ")[1]}`}>
              <p className={`text-xs font-semibold mb-1 ${cls.split(" ")[0]}`}>{label}</p>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  className="h-7 text-sm w-16"
                  value={Math.round(cfg.weights[key] * 100)}
                  onChange={(e) => updateWeight(key, Number(e.target.value))}
                />
                <span className={`text-sm font-bold ${cls.split(" ")[0]}`}>%</span>
              </div>
            </div>
          ))}
        </div>
        <p className={`text-xs mt-2 font-medium ${weightTotal !== 100 ? "text-red-600" : "text-muted-foreground"}`}>
          Total: {weightTotal}% {weightTotal !== 100 ? "(must equal 100%)" : "✓"}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold">XP reward rules</h3>
        {availableToAdd.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              className="h-8 text-xs px-2 rounded-md border border-input bg-background max-w-[220px]"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  addRule(e.target.value);
                  e.target.value = "";
                }
              }}
            >
              <option value="" disabled>Add action rule…</option>
              {catalogCategoryGroups(availableToAdd).entries().map(([cat, items]) => (
                <optgroup key={cat} label={cat}>
                  {items.map((item) => (
                    <option
                      key={item.actionType}
                      value={item.actionType}
                      disabled={item.connectionStatus !== "connected"}
                    >
                      {item.label}
                      {item.connectionStatus !== "connected" ? " (not connected)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                const first = availableToAdd.find((a) => a.connectionStatus === "connected");
                if (first) addRule(first.actionType);
              }}
            >
              <Plus size={12} className="mr-1" /> Add connected rule
            </Button>
          </div>
        )}
      </div>

      {cfg.pointActions.length === 0 ? (
        <div className="rounded-lg border border-dashed text-center py-10 text-sm text-muted-foreground">
          No XP rules configured. Add a connected action type to start.
        </div>
      ) : (
        <div className="space-y-6">
          {[...ruleGroups.entries()].map(([category, items]) => (
            <div key={category}>
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{category}</h4>
              <div className="space-y-2">
                {items.map(({ rule, entry }) => {
                  const status = entry?.connectionStatus ?? "not_connected";
                  return (
                    <div
                      key={rule.id}
                      className={`rounded-lg border p-3 ${rule.enabled ? "border-border bg-card" : "border-border/40 bg-muted/20"}`}
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr_90px_36px_36px] gap-2 items-end">
                        <div>
                          <Label className="text-[10px] uppercase text-muted-foreground">Action type</Label>
                          <select
                            className="w-full h-8 text-sm px-2 rounded-md border border-input bg-background mt-0.5"
                            value={rule.actionType ?? entry?.actionType ?? rule.id}
                            onChange={(e) => setActionType(rule.id, e.target.value)}
                          >
                            {catalogCategoryGroups(XP_ACTION_CATALOG).entries().map(([cat, opts]) => (
                              <optgroup key={cat} label={cat}>
                                {opts.map((o) => (
                                  <option
                                    key={o.actionType}
                                    value={o.actionType}
                                    disabled={o.connectionStatus !== "connected" && o.actionType !== rule.actionType}
                                  >
                                    {o.label}
                                    {o.connectionStatus !== "connected" ? " — coming soon" : ""}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase text-muted-foreground">Description</Label>
                          <p className="text-xs text-muted-foreground mt-1.5 min-h-[32px] leading-snug">
                            {rule.description || entry?.description}
                          </p>
                          <div className="flex gap-1.5 mt-1 flex-wrap">
                            {entry && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                                {entry.category}
                              </span>
                            )}
                            <ConnectionBadge status={status} />
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase text-muted-foreground">XP</Label>
                          <Input
                            type="number"
                            className="h-8 text-sm mt-0.5"
                            value={rule.points}
                            onChange={(e) => updateAction(rule.id, { points: Number(e.target.value) })}
                          />
                        </div>
                        <div className="flex items-end pb-1 justify-center">
                          <Toggle checked={rule.enabled} onChange={(v) => updateAction(rule.id, { enabled: v })} />
                        </div>
                        <div className="flex items-end pb-1 justify-center">
                          <button
                            type="button"
                            onClick={() => removeAction(rule.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
