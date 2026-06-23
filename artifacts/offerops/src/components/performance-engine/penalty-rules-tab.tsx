import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import type { GoalsConfig, Penalty } from "@/lib/goals-config";
import {
  PENALTY_ACTION_CATALOG,
  catalogCategoryGroups,
  type ConnectionStatus,
} from "@/lib/performance-engine/action-catalog";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex-shrink-0" aria-pressed={checked}>
      <span className={`inline-block h-5 w-9 rounded-full transition-colors relative ${checked ? "bg-green-600" : "bg-muted"}`}>
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
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

function getPenaltyEntry(actionType: string) {
  return PENALTY_ACTION_CATALOG.find((p) => p.actionType === actionType);
}

export function PenaltyRulesTab({ cfg, onChange }: { cfg: GoalsConfig; onChange: (c: GoalsConfig) => void }) {
  const configured = new Set(cfg.penalties.map((p) => p.actionType ?? p.triggerCondition));

  function updatePenalty(id: string, patch: Partial<Penalty>) {
    onChange({ ...cfg, penalties: cfg.penalties.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  }

  function addPenalty(actionType: string) {
    const entry = getPenaltyEntry(actionType);
    if (!entry) return;
    const row: Penalty = {
      id: `pen_${actionType}`,
      actionType: entry.actionType,
      name: entry.label,
      description: entry.description,
      triggerCondition: entry.actionType,
      pointsDeducted: entry.defaultPenalty,
      enabled: false,
    };
    onChange({ ...cfg, penalties: [...cfg.penalties, row] });
  }

  function setPenaltyType(id: string, actionType: string) {
    const entry = getPenaltyEntry(actionType);
    if (!entry) return;
    updatePenalty(id, {
      actionType: entry.actionType,
      name: entry.label,
      description: entry.description,
      triggerCondition: entry.actionType,
    });
  }

  function removePenalty(id: string) {
    onChange({ ...cfg, penalties: cfg.penalties.filter((p) => p.id !== id) });
  }

  const available = PENALTY_ACTION_CATALOG.filter((p) => !configured.has(p.actionType));

  const groups = new Map<string, Penalty[]>();
  for (const p of cfg.penalties) {
    const cat = getPenaltyEntry(p.actionType ?? p.triggerCondition)?.category ?? "Other";
    const list = groups.get(cat) ?? [];
    list.push(p);
    groups.set(cat, list);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-red-50/40 px-4 py-3 text-sm text-red-950">
        <p className="font-medium">Penalty rules</p>
        <p className="text-xs mt-1 text-red-900/80">
          Penalties use predefined app conditions. None are wired to XP deduction yet — enabling only affects future backend hooks.
        </p>
      </div>

      <div className="flex justify-end">
        {available.length > 0 && (
          <select
            className="h-8 text-xs px-2 rounded-md border border-input bg-background"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                addPenalty(e.target.value);
                e.target.value = "";
              }
            }}
          >
            <option value="" disabled>Add penalty type…</option>
            {[...catalogCategoryGroups(available).entries()].map(([cat, items]) => (
              <optgroup key={cat} label={cat}>
                {items.map((item) => (
                  <option key={item.actionType} value={item.actionType} disabled={item.connectionStatus !== "connected"}>
                    {item.label} (not connected)
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>

      {cfg.penalties.length === 0 ? (
        <div className="rounded-lg border border-dashed text-center py-10 text-sm text-muted-foreground">
          No penalty rules configured.
        </div>
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([category, penalties]) => (
            <div key={category}>
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{category}</h4>
              <div className="space-y-2">
                {penalties.map((p) => {
                  const entry = getPenaltyEntry(p.actionType ?? p.triggerCondition);
                  const status = entry?.connectionStatus ?? "not_connected";
                  return (
                    <div
                      key={p.id}
                      className={`rounded-lg border p-3 ${p.enabled ? "border-red-200 bg-red-50/30" : "border-border/40 bg-muted/20"}`}
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr_90px_36px_36px] gap-2 items-end">
                        <div>
                          <Label className="text-[10px] uppercase text-muted-foreground">Penalty type</Label>
                          <select
                            className="w-full h-8 text-sm px-2 rounded-md border border-input bg-background mt-0.5"
                            value={p.actionType ?? p.triggerCondition}
                            onChange={(e) => setPenaltyType(p.id, e.target.value)}
                          >
                            {[...catalogCategoryGroups(PENALTY_ACTION_CATALOG).entries()].map(([cat, opts]) => (
                              <optgroup key={cat} label={cat}>
                                {opts.map((o) => (
                                  <option key={o.actionType} value={o.actionType}>
                                    {o.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mt-4 leading-snug">{p.description}</p>
                          <ConnectionBadge status={status} />
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase text-muted-foreground">Points</Label>
                          <Input
                            type="number"
                            className="h-8 text-sm mt-0.5"
                            value={p.pointsDeducted}
                            onChange={(e) => updatePenalty(p.id, { pointsDeducted: Number(e.target.value) })}
                          />
                        </div>
                        <div className="flex items-end pb-1 justify-center">
                          <Toggle checked={p.enabled} onChange={(v) => updatePenalty(p.id, { enabled: v })} />
                        </div>
                        <div className="flex items-end pb-1 justify-center">
                          <button type="button" onClick={() => removePenalty(p.id)} className="text-muted-foreground hover:text-destructive">
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
