import { useState, useMemo } from "react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useAuth } from "@/lib/auth";
import {
  useGoalsConfig, useUpdateGoalsConfig, useGoalsAuditLog,
  computeScores, getRankForScore, RANK_COLORS, DEFAULT_CONFIG,
  type GoalsConfig, type PointAction, type ComboBonus, type RankTier,
  type Penalty, type BonusEvent, type KpiTarget,
} from "@/lib/goals-config";
import {
  useListEmployees, useListTestingBatches, useListOffers, useListTodoTasks,
  getListTestingBatchesQueryKey, getListOffersQueryKey, getListTodoTasksQueryKey, getListEmployeesQueryKey,
} from "@workspace/api-client-react";
import { useWorkspace } from "@/lib/workspace-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Save, RotateCcw, Plus, Trash2, ToggleLeft, ToggleRight, Eye, EyeOff,
  Zap, Target, Star, TrendingUp, Crown, Trophy, Award, Shield, Settings,
  ChevronUp, ChevronDown, Clock, Activity, BadgeDollarSign, Layers, History,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────
const ICON_OPTIONS = ["Target","Star","TrendingUp","Zap","Crown","Trophy","Award","Shield","Activity","Layers","Settings"];
const COLOR_OPTIONS = ["slate","blue","green","orange","purple","red","yellow","pink"];
const ICON_MAP: Record<string, React.ElementType> = {
  Target, Star, TrendingUp, Zap, Crown, Trophy, Award, Shield, Activity, Layers, Settings,
};
const TRIGGER_TYPES = [
  { value: "winners_monthly", label: "Winners found (monthly)" },
  { value: "optimizations_monthly", label: "Optimizations completed (monthly)" },
  { value: "scale_tasks_monthly", label: "Scale tasks created (monthly)" },
  { value: "batches_monthly", label: "Batches created (monthly)" },
  { value: "tasks_completed_monthly", label: "Tasks completed (monthly)" },
  { value: "no_overdue_tasks", label: "No overdue tasks" },
];
const PENALTY_TRIGGERS = [
  { value: "overdue_task", label: "Per overdue task" },
  { value: "inactive_batch", label: "Batch stuck too long" },
  { value: "delayed_optimization", label: "Delayed optimization" },
  { value: "delayed_scaling", label: "Delayed scaling" },
  { value: "incorrect_workflow", label: "Incorrect workflow usage" },
];

type Tab = "points" | "ranks" | "combos" | "penalties" | "events" | "kpis" | "audit";

// ─────────────────────────────────────────────────────────────────
// Shared field components
// ─────────────────────────────────────────────────────────────────
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex-shrink-0">
      {checked
        ? <ToggleRight size={22} className="text-green-600" />
        : <ToggleLeft size={22} className="text-muted-foreground" />
      }
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tab: Point System
// ─────────────────────────────────────────────────────────────────
function PointSystemTab({ cfg, onChange }: { cfg: GoalsConfig; onChange: (c: GoalsConfig) => void }) {
  const categories: PointAction["category"][] = ["activity", "winner", "optimization", "discipline"];
  const catLabels: Record<string, string> = {
    activity: "Activity", winner: "Winner Discovery", optimization: "Optimization", discipline: "Discipline",
  };
  const catColors: Record<string, string> = {
    activity: "text-blue-700 bg-blue-50 border-blue-200",
    winner: "text-green-700 bg-green-50 border-green-200",
    optimization: "text-orange-700 bg-orange-50 border-orange-200",
    discipline: "text-purple-700 bg-purple-50 border-purple-200",
  };

  function updateAction(id: string, patch: Partial<PointAction>) {
    onChange({ ...cfg, pointActions: cfg.pointActions.map(a => a.id === id ? { ...a, ...patch } : a) });
  }
  function addAction(category: PointAction["category"]) {
    const newAction: PointAction = {
      id: `pa_${Date.now()}`, name: "New Action", description: "Custom scoring action",
      points: 5, enabled: true, category,
    };
    onChange({ ...cfg, pointActions: [...cfg.pointActions, newAction] });
  }
  function removeAction(id: string) {
    onChange({ ...cfg, pointActions: cfg.pointActions.filter(a => a.id !== id) });
  }

  // Weight editor
  function updateWeight(key: keyof GoalsConfig["weights"], val: number) {
    onChange({ ...cfg, weights: { ...cfg.weights, [key]: val / 100 } });
  }
  const w = cfg.weights;
  const weightTotal = Math.round((w.activity + w.winner + w.optimization + w.discipline) * 100);

  return (
    <div className="space-y-6">
      {/* Score weights */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Score Category Weights</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([["activity","Activity","text-blue-700 bg-blue-50"],["winner","Winners","text-green-700 bg-green-50"],["optimization","Optimization","text-orange-700 bg-orange-50"],["discipline","Discipline","text-purple-700 bg-purple-50"]] as const).map(([key, label, cls]) => (
            <div key={key} className={`rounded-lg p-3 ${cls.split(" ")[1]}`}>
              <p className={`text-xs font-semibold mb-1 ${cls.split(" ")[0]}`}>{label}</p>
              <div className="flex items-center gap-1">
                <Input type="number" min={0} max={100} step={5} className="h-7 text-sm w-16"
                  value={Math.round(cfg.weights[key as keyof GoalsConfig["weights"]] * 100)}
                  onChange={e => updateWeight(key as keyof GoalsConfig["weights"], Number(e.target.value))}
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

      {/* Point actions by category */}
      {categories.map(cat => {
        const actions = cfg.pointActions.filter(a => a.category === cat);
        const clsBadge = catColors[cat];
        return (
          <div key={cat}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-xs font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${clsBadge}`}>{catLabels[cat]}</h3>
              <button onClick={() => addAction(cat)} className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus size={11} /> Add action
              </button>
            </div>
            <div className="space-y-2">
              {actions.map(a => (
                <div key={a.id} className={`rounded-lg border p-3 ${a.enabled ? "border-border bg-card" : "border-border/40 bg-muted/20"}`}>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_80px_32px_32px] gap-2 items-end">
                    <FieldRow label="Action Name">
                      <Input className="h-8 text-sm" value={a.name} onChange={e => updateAction(a.id, { name: e.target.value })} />
                    </FieldRow>
                    <FieldRow label="Description">
                      <Input className="h-8 text-sm" value={a.description} onChange={e => updateAction(a.id, { description: e.target.value })} />
                    </FieldRow>
                    <FieldRow label="Points">
                      <Input type="number" className="h-8 text-sm" value={a.points} onChange={e => updateAction(a.id, { points: Number(e.target.value) })} />
                    </FieldRow>
                    <div className="flex items-end pb-0.5"><Toggle checked={a.enabled} onChange={v => updateAction(a.id, { enabled: v })} /></div>
                    <div className="flex items-end pb-1">
                      <button onClick={() => removeAction(a.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {actions.length === 0 && <p className="text-xs text-muted-foreground italic">No actions in this category.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tab: Ranks & Bonuses
// ─────────────────────────────────────────────────────────────────
function RanksTab({ cfg, onChange }: { cfg: GoalsConfig; onChange: (c: GoalsConfig) => void }) {
  const sorted = [...cfg.ranks].sort((a, b) => a.minScore - b.minScore);

  function updateRank(id: string, patch: Partial<RankTier>) {
    onChange({ ...cfg, ranks: cfg.ranks.map(r => r.id === id ? { ...r, ...patch } : r) });
  }
  function addRank() {
    const maxMin = cfg.ranks.reduce((m, r) => Math.max(m, r.minScore), 0);
    onChange({ ...cfg, ranks: [...cfg.ranks, { id: `r_${Date.now()}`, name: "New Rank", minScore: maxMin + 200, bonusAmount: 0, color: "blue", icon: "Star" }] });
  }
  function deleteRank(id: string) {
    onChange({ ...cfg, ranks: cfg.ranks.filter(r => r.id !== id) });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Ranks are sorted by minimum score. Bonus amounts are only visible to admins.</p>
        <Button variant="outline" size="sm" onClick={addRank} className="h-8 text-xs">
          <Plus size={12} className="mr-1" /> Add Rank
        </Button>
      </div>

      <div className="space-y-3">
        {sorted.map((r, i) => {
          const col = RANK_COLORS[r.color] ?? RANK_COLORS.slate;
          const Ic = ICON_MAP[r.icon] ?? Target;
          return (
            <div key={r.id} className={`rounded-xl border-2 ${col.border} ${col.bg} p-4`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-white/60`}>
                  <Ic size={20} className={col.text} />
                </div>
                <div className="flex-1">
                  <span className={`text-sm font-bold ${col.text}`}>{r.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">Tier {i + 1}</span>
                </div>
                <button onClick={() => deleteRank(r.id)} className="text-muted-foreground hover:text-destructive ml-auto">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <FieldRow label="Rank Name">
                  <Input className="h-8 text-sm bg-white/70" value={r.name} onChange={e => updateRank(r.id, { name: e.target.value })} />
                </FieldRow>
                <FieldRow label="Min Score">
                  <Input type="number" className="h-8 text-sm bg-white/70" value={r.minScore} onChange={e => updateRank(r.id, { minScore: Number(e.target.value) })} />
                </FieldRow>
                <FieldRow label="Bonus Payout ($) — Admin Only">
                  <Input type="number" className="h-8 text-sm bg-white/70" value={r.bonusAmount} onChange={e => updateRank(r.id, { bonusAmount: Number(e.target.value) })} />
                </FieldRow>
                <div className="grid grid-cols-2 gap-2">
                  <FieldRow label="Color">
                    <select className="w-full h-8 text-sm px-2 rounded-md border border-input bg-white/70"
                      value={r.color} onChange={e => updateRank(r.id, { color: e.target.value })}>
                      {COLOR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </FieldRow>
                  <FieldRow label="Icon">
                    <select className="w-full h-8 text-sm px-2 rounded-md border border-input bg-white/70"
                      value={r.icon} onChange={e => updateRank(r.id, { icon: e.target.value })}>
                      {ICON_OPTIONS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
                    </select>
                  </FieldRow>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tab: Combo Bonuses
// ─────────────────────────────────────────────────────────────────
function CombosTab({ cfg, onChange }: { cfg: GoalsConfig; onChange: (c: GoalsConfig) => void }) {
  function updateCombo(id: string, patch: Partial<ComboBonus>) {
    onChange({ ...cfg, comboBonuses: cfg.comboBonuses.map(c => c.id === id ? { ...c, ...patch } : c) });
  }
  function addCombo() {
    onChange({ ...cfg, comboBonuses: [...cfg.comboBonuses, {
      id: `cb_${Date.now()}`, name: "New Combo", description: "Describe the combo",
      triggerType: "winners_monthly", threshold: 3, rewardPoints: 50,
      active: true, repeatable: false, monthlyLimit: 1,
    }] });
  }
  function deleteCombo(id: string) {
    onChange({ ...cfg, comboBonuses: cfg.comboBonuses.filter(c => c.id !== id) });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Combo bonuses reward employees for hitting performance thresholds.</p>
        <Button variant="outline" size="sm" onClick={addCombo} className="h-8 text-xs">
          <Plus size={12} className="mr-1" /> Add Combo
        </Button>
      </div>
      {cfg.comboBonuses.map(cb => (
        <div key={cb.id} className={`rounded-lg border p-4 ${cb.active ? "border-border bg-card" : "border-border/40 bg-muted/20"}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Toggle checked={cb.active} onChange={v => updateCombo(cb.id, { active: v })} />
              <span className={`text-sm font-semibold ${cb.active ? "" : "text-muted-foreground"}`}>{cb.name}</span>
              <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">+{cb.rewardPoints} pts</span>
            </div>
            <button onClick={() => deleteCombo(cb.id)} className="text-muted-foreground hover:text-destructive">
              <Trash2 size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="col-span-2">
              <FieldRow label="Combo Name">
                <Input className="h-8 text-sm" value={cb.name} onChange={e => updateCombo(cb.id, { name: e.target.value })} />
              </FieldRow>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <FieldRow label="Description">
                <Input className="h-8 text-sm" value={cb.description} onChange={e => updateCombo(cb.id, { description: e.target.value })} />
              </FieldRow>
            </div>
            <FieldRow label="Trigger Type">
              <select className="w-full h-8 text-sm px-2 rounded-md border border-input bg-background"
                value={cb.triggerType} onChange={e => updateCombo(cb.id, { triggerType: e.target.value })}>
                {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Threshold">
              <Input type="number" className="h-8 text-sm" value={cb.threshold} onChange={e => updateCombo(cb.id, { threshold: Number(e.target.value) })} />
            </FieldRow>
            <FieldRow label="Reward Pts">
              <Input type="number" className="h-8 text-sm" value={cb.rewardPoints} onChange={e => updateCombo(cb.id, { rewardPoints: Number(e.target.value) })} />
            </FieldRow>
          </div>
          <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border/40">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" className="rounded" checked={cb.repeatable} onChange={e => updateCombo(cb.id, { repeatable: e.target.checked })} />
              <span className="text-muted-foreground">Repeatable</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Monthly limit</span>
              <Input type="number" className="h-6 text-xs w-16" value={cb.monthlyLimit}
                onChange={e => updateCombo(cb.id, { monthlyLimit: Number(e.target.value) })} />
              <span className="text-xs text-muted-foreground">(0 = unlimited)</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tab: Penalties
// ─────────────────────────────────────────────────────────────────
function PenaltiesTab({ cfg, onChange }: { cfg: GoalsConfig; onChange: (c: GoalsConfig) => void }) {
  function updatePenalty(id: string, patch: Partial<Penalty>) {
    onChange({ ...cfg, penalties: cfg.penalties.map(p => p.id === id ? { ...p, ...patch } : p) });
  }
  function addPenalty() {
    onChange({ ...cfg, penalties: [...cfg.penalties, {
      id: `p_${Date.now()}`, name: "New Penalty", description: "Describe the penalty",
      triggerCondition: "overdue_task", pointsDeducted: 5, enabled: false,
    }] });
  }
  function deletePenalty(id: string) {
    onChange({ ...cfg, penalties: cfg.penalties.filter(p => p.id !== id) });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Penalties deduct points for operational lapses. Disabled penalties have no effect.</p>
        <Button variant="outline" size="sm" onClick={addPenalty} className="h-8 text-xs">
          <Plus size={12} className="mr-1" /> Add Penalty
        </Button>
      </div>
      {cfg.penalties.map(p => (
        <div key={p.id} className={`rounded-lg border p-4 ${p.enabled ? "border-red-200 bg-red-50/30" : "border-border/40 bg-muted/20"}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Toggle checked={p.enabled} onChange={v => updatePenalty(p.id, { enabled: v })} />
              <span className={`text-sm font-semibold ${p.enabled ? "text-red-700" : "text-muted-foreground"}`}>{p.name}</span>
              {p.enabled && <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">−{p.pointsDeducted} pts</span>}
            </div>
            <button onClick={() => deletePenalty(p.id)} className="text-muted-foreground hover:text-destructive">
              <Trash2 size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <FieldRow label="Penalty Name">
              <Input className="h-8 text-sm" value={p.name} onChange={e => updatePenalty(p.id, { name: e.target.value })} />
            </FieldRow>
            <FieldRow label="Description">
              <Input className="h-8 text-sm" value={p.description} onChange={e => updatePenalty(p.id, { description: e.target.value })} />
            </FieldRow>
            <FieldRow label="Trigger Condition">
              <select className="w-full h-8 text-sm px-2 rounded-md border border-input bg-background"
                value={p.triggerCondition} onChange={e => updatePenalty(p.id, { triggerCondition: e.target.value })}>
                {PENALTY_TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Points Deducted">
              <Input type="number" className="h-8 text-sm" value={p.pointsDeducted} onChange={e => updatePenalty(p.id, { pointsDeducted: Number(e.target.value) })} />
            </FieldRow>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tab: Bonus Events (multipliers)
// ─────────────────────────────────────────────────────────────────
function BonusEventsTab({ cfg, onChange }: { cfg: GoalsConfig; onChange: (c: GoalsConfig) => void }) {
  const actionOptions = cfg.pointActions.map(a => ({ value: a.id, label: a.name }));

  function updateEvent(id: string, patch: Partial<BonusEvent>) {
    onChange({ ...cfg, bonusEvents: cfg.bonusEvents.map(e => e.id === id ? { ...e, ...patch } : e) });
  }
  function addEvent() {
    onChange({ ...cfg, bonusEvents: [...cfg.bonusEvents, {
      id: `be_${Date.now()}`, name: "New Bonus Event", description: "Describe the event",
      multiplierTarget: cfg.pointActions[0]?.id ?? "winnerFound",
      multiplier: 2, active: false, expiresAt: null,
    }] });
  }
  function deleteEvent(id: string) {
    onChange({ ...cfg, bonusEvents: cfg.bonusEvents.filter(e => e.id !== id) });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Bonus events temporarily multiply points for specific actions. Great for seasonal campaigns.</p>
        <Button variant="outline" size="sm" onClick={addEvent} className="h-8 text-xs">
          <Plus size={12} className="mr-1" /> Add Event
        </Button>
      </div>
      {cfg.bonusEvents.map(ev => (
        <div key={ev.id} className={`rounded-lg border p-4 ${ev.active ? "border-amber-300 bg-amber-50/40" : "border-border bg-card"}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Toggle checked={ev.active} onChange={v => updateEvent(ev.id, { active: v })} />
              <span className={`text-sm font-semibold ${ev.active ? "text-amber-800" : "text-muted-foreground"}`}>{ev.name}</span>
              {ev.active && <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">×{ev.multiplier} ACTIVE</span>}
            </div>
            <button onClick={() => deleteEvent(ev.id)} className="text-muted-foreground hover:text-destructive">
              <Trash2 size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <FieldRow label="Event Name">
              <Input className="h-8 text-sm" value={ev.name} onChange={e => updateEvent(ev.id, { name: e.target.value })} />
            </FieldRow>
            <FieldRow label="Description">
              <Input className="h-8 text-sm" value={ev.description} onChange={e => updateEvent(ev.id, { description: e.target.value })} />
            </FieldRow>
            <FieldRow label="Target Action">
              <select className="w-full h-8 text-sm px-2 rounded-md border border-input bg-background"
                value={ev.multiplierTarget} onChange={e => updateEvent(ev.id, { multiplierTarget: e.target.value })}>
                {actionOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Multiplier">
              <Input type="number" step="0.5" className="h-8 text-sm" value={ev.multiplier} onChange={e => updateEvent(ev.id, { multiplier: Number(e.target.value) })} />
            </FieldRow>
            <div className="col-span-2">
              <FieldRow label="Expires At (leave blank = no expiry)">
                <Input type="date" className="h-8 text-sm" value={ev.expiresAt?.split("T")[0] ?? ""}
                  onChange={e => updateEvent(ev.id, { expiresAt: e.target.value ? `${e.target.value}T23:59:59Z` : null })} />
              </FieldRow>
            </div>
          </div>
          {ev.active && ev.expiresAt && (
            <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
              <Clock size={10} /> Expires {new Date(ev.expiresAt).toLocaleDateString()}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tab: KPI Targets
// ─────────────────────────────────────────────────────────────────
function KpiTargetsTab({ cfg, onChange }: { cfg: GoalsConfig; onChange: (c: GoalsConfig) => void }) {
  function updateKpi(id: string, patch: Partial<KpiTarget>) {
    onChange({ ...cfg, kpiTargets: cfg.kpiTargets.map(k => k.id === id ? { ...k, ...patch } : k) });
  }
  function addKpi() {
    onChange({ ...cfg, kpiTargets: [...cfg.kpiTargets, {
      id: `kt_${Date.now()}`, name: "New KPI", key: "batches", monthlyTarget: 10,
    }] });
  }
  function deleteKpi(id: string) {
    onChange({ ...cfg, kpiTargets: cfg.kpiTargets.filter(k => k.id !== id) });
  }

  const KPI_KEY_OPTIONS = [
    { value: "batches", label: "Batches (batches)" },
    { value: "liveCampaigns", label: "Live Campaigns (liveCampaigns)" },
    { value: "optimizations", label: "Optimizations (optimizations)" },
    { value: "winners", label: "Winners (winners)" },
    { value: "scaleTasks", label: "Scale Tasks (scaleTasks)" },
    { value: "tasksCompleted", label: "Tasks Completed (tasksCompleted)" },
    { value: "retests", label: "Retests (retests)" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Monthly targets shown as KPI progress bars on the Goals page.</p>
        <Button variant="outline" size="sm" onClick={addKpi} className="h-8 text-xs">
          <Plus size={12} className="mr-1" /> Add KPI Target
        </Button>
      </div>
      {cfg.kpiTargets.map((k, i) => {
        const colors = ["bg-blue-500","bg-green-500","bg-orange-500","bg-yellow-500","bg-purple-500","bg-pink-500"];
        const c = colors[i % colors.length];
        return (
          <div key={k.id} className="rounded-lg border p-4 bg-card">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
              <FieldRow label="KPI Name (display)">
                <Input className="h-8 text-sm" value={k.name} onChange={e => updateKpi(k.id, { name: e.target.value })} />
              </FieldRow>
              <FieldRow label="Metric Key">
                <select className="w-full h-8 text-sm px-2 rounded-md border border-input bg-background"
                  value={k.key} onChange={e => updateKpi(k.id, { key: e.target.value })}>
                  {KPI_KEY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Monthly Target">
                <Input type="number" className="h-8 text-sm" value={k.monthlyTarget} onChange={e => updateKpi(k.id, { monthlyTarget: Number(e.target.value) })} />
              </FieldRow>
              <div className="flex items-end gap-2 pb-0.5">
                <div className={`h-3 w-8 rounded-full ${c} flex-shrink-0`} />
                <button onClick={() => deleteKpi(k.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tab: Audit Log
// ─────────────────────────────────────────────────────────────────
function AuditLogTab() {
  const { data: log = [] } = useGoalsAuditLog();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">All changes to the Goals Engine configuration, most recent first.</p>
      {log.length === 0 && (
        <div className="rounded-lg border border-border bg-muted/20 text-center py-10">
          <History size={24} className="mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
        </div>
      )}
      <div className="space-y-1.5">
        {log.map((entry, i) => (
          <div key={i} className="rounded-lg border border-border bg-card px-4 py-3 flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0 text-muted-foreground">
              {entry.adminName?.charAt(0) ?? "A"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground">{entry.summary || "Configuration updated"}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">{entry.adminName ?? "Admin"}</span>
                {entry.tab && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{entry.tab}</span>}
              </div>
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {new Date(entry.timestamp).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Preview panel
// ─────────────────────────────────────────────────────────────────
function PreviewPanel({ savedCfg, draftCfg }: { savedCfg: GoalsConfig; draftCfg: GoalsConfig }) {
  const { activeWorkspaceId } = useWorkspace();
  const wsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const { data: employees = [] } = useListEmployees(wsParams, wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(wsParams)));
  const { data: batches = [] } = useListTestingBatches(wsParams, wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(wsParams)));
  const { data: offers = [] } = useListOffers(wsParams, wsQueryOpts(activeWorkspaceId, getListOffersQueryKey(wsParams)));
  const { data: tasks = [] } = useListTodoTasks(wsParams, wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(wsParams)));

  const current = useMemo(() => computeScores(employees, batches, offers, tasks, savedCfg), [employees, batches, offers, tasks, savedCfg]);
  const projected = useMemo(() => computeScores(employees, batches, offers, tasks, draftCfg), [employees, batches, offers, tasks, draftCfg]);

  const rows = current.map(c => {
    const p = projected.find(x => x.employeeId === c.employeeId);
    const curRank = getRankForScore(c.total, savedCfg);
    const projRank = p ? getRankForScore(p.total, draftCfg) : curRank;
    const delta = p ? p.total - c.total : 0;
    const payoutDelta = projRank.bonusAmount - curRank.bonusAmount;
    return { name: c.name, curScore: c.total, projScore: p?.total ?? c.total, delta, curRank, projRank, payoutDelta };
  });

  const totalCurrentPayout = rows.reduce((s, r) => s + r.curRank.bonusAmount, 0);
  const totalProjectedPayout = rows.reduce((s, r) => s + r.projRank.bonusAmount, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/30 border border-border p-3 text-center">
          <p className="text-xs text-muted-foreground">Current Payout</p>
          <p className="text-xl font-black text-foreground">${totalCurrentPayout}</p>
        </div>
        <div className="rounded-lg bg-primary/10 border border-primary/30 p-3 text-center">
          <p className="text-xs text-muted-foreground">Projected Payout</p>
          <p className={`text-xl font-black ${totalProjectedPayout > totalCurrentPayout ? "text-green-600" : totalProjectedPayout < totalCurrentPayout ? "text-red-600" : "text-foreground"}`}>
            ${totalProjectedPayout}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map(r => {
          const curCol = RANK_COLORS[r.curRank.color] ?? RANK_COLORS.slate;
          const projCol = RANK_COLORS[r.projRank.color] ?? RANK_COLORS.slate;
          const rankChanged = r.curRank.id !== r.projRank.id;
          return (
            <div key={r.name} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${curCol.bg} ${curCol.text}`}>
                    {r.name.charAt(0)}
                  </div>
                  <span className="text-sm font-medium">{r.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{r.curScore} pts</span>
                  <span className="text-muted-foreground">→</span>
                  <span className={`font-bold ${r.delta > 0 ? "text-green-600" : r.delta < 0 ? "text-red-600" : "text-foreground"}`}>
                    {r.projScore} pts {r.delta !== 0 && `(${r.delta > 0 ? "+" : ""}${r.delta})`}
                  </span>
                </div>
              </div>
              {rankChanged && (
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  <span className={`px-2 py-0.5 rounded-full font-bold ${curCol.bg} ${curCol.text}`}>{r.curRank.name}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className={`px-2 py-0.5 rounded-full font-bold ${projCol.bg} ${projCol.text}`}>{r.projRank.name}</span>
                  <span className={`ml-auto font-semibold ${r.payoutDelta > 0 ? "text-green-600" : "text-red-600"}`}>
                    {r.payoutDelta > 0 ? "+" : ""}${r.payoutDelta} payout
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────
export default function AdminGoalsConfig({ embedded = false }: { embedded?: boolean }) {
  const { currentEmployee } = useAuth();
  const { toast } = useToast();
  const { data: savedCfg } = useGoalsConfig();
  const cfg = savedCfg ?? DEFAULT_CONFIG;
  const updateCfg = useUpdateGoalsConfig();

  const [draft, setDraft] = useState<GoalsConfig | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("points");
  const [previewOpen, setPreviewOpen] = useState(false);
  const editCfg = draft ?? cfg;
  const isDirty = draft !== null;

  function resetToSaved() { setDraft(null); }
  function resetToDefault() { setDraft(JSON.parse(JSON.stringify(DEFAULT_CONFIG))); }

  function save() {
    if (!draft) return;
    const tabLabel: Record<Tab, string> = {
      points: "Point System", ranks: "Ranks & Bonuses", combos: "Combo Bonuses",
      penalties: "Penalties", events: "Bonus Events", kpis: "KPI Targets", audit: "Audit Log",
    };
    updateCfg.mutate({
      config: draft,
      adminId: currentEmployee?.id,
      adminName: currentEmployee?.name,
      summary: `Updated ${tabLabel[activeTab]}`,
      tab: tabLabel[activeTab],
    }, {
      onSuccess: () => { toast({ title: "Goals engine saved" }); setDraft(null); },
      onError: () => toast({ title: "Failed to save", variant: "destructive" }),
    });
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "points",   label: "Point System",   icon: Activity },
    { id: "ranks",    label: "Ranks & Bonuses", icon: Crown },
    { id: "combos",   label: "Combo Bonuses",   icon: Zap },
    { id: "penalties",label: "Penalties",        icon: Shield },
    { id: "events",   label: "Bonus Events",    icon: BadgeDollarSign },
    { id: "kpis",     label: "KPI Targets",     icon: Target },
    { id: "audit",    label: "Audit Log",        icon: History },
  ];

  return (
    <div className="space-y-0 max-w-6xl">
      {/* Page header — hidden when embedded inside Settings */}
      {!embedded && (
        <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Settings size={22} /> Goals Engine Settings
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Configure every aspect of the scoring and bonus system</p>
          </div>
        </div>
      )}
      {/* Action toolbar — always visible */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div />
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(v => !v)} className={previewOpen ? "border-primary text-primary" : ""}>
            {previewOpen ? <EyeOff size={13} className="mr-1.5" /> : <Eye size={13} className="mr-1.5" />}
            {previewOpen ? "Hide Preview" : "Preview Impact"}
          </Button>
          {isDirty && (
            <>
              <Button variant="ghost" size="sm" onClick={resetToSaved}>
                <RotateCcw size={13} className="mr-1.5" /> Discard
              </Button>
              <Button size="sm" onClick={save} disabled={updateCfg.isPending}>
                <Save size={13} className="mr-1.5" />
                {updateCfg.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </>
          )}
          {!isDirty && (
            <Button variant="outline" size="sm" onClick={resetToDefault} className="text-muted-foreground">
              <RotateCcw size={13} className="mr-1.5" /> Reset to Defaults
            </Button>
          )}
        </div>
      </div>

      {isDirty && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm font-medium flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
          You have unsaved changes — save before leaving this page.
        </div>
      )}

      <div className={`flex gap-5 ${previewOpen ? "xl:gap-6" : ""}`}>
        {/* Left tab nav */}
        <div className="flex-shrink-0 w-44 space-y-0.5">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                activeTab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <t.icon size={15} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                {(() => { const t = TABS.find(x => x.id === activeTab); return t ? <><t.icon size={15} className="text-muted-foreground" />{t.label}</> : null; })()}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {activeTab === "points"    && <PointSystemTab cfg={editCfg} onChange={setDraft} />}
              {activeTab === "ranks"     && <RanksTab cfg={editCfg} onChange={setDraft} />}
              {activeTab === "combos"    && <CombosTab cfg={editCfg} onChange={setDraft} />}
              {activeTab === "penalties" && <PenaltiesTab cfg={editCfg} onChange={setDraft} />}
              {activeTab === "events"    && <BonusEventsTab cfg={editCfg} onChange={setDraft} />}
              {activeTab === "kpis"      && <KpiTargetsTab cfg={editCfg} onChange={setDraft} />}
              {activeTab === "audit"     && <AuditLogTab />}
            </CardContent>
          </Card>
        </div>

        {/* Preview panel */}
        {previewOpen && (
          <div className="flex-shrink-0 w-72 hidden xl:block">
            <Card className="border border-border shadow-sm sticky top-0">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Eye size={13} className="text-muted-foreground" /> Score Impact Preview
                </CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">Real-time projection vs current config</p>
              </CardHeader>
              <CardContent className="pt-3 max-h-[calc(100vh-200px)] overflow-y-auto">
                <PreviewPanel savedCfg={cfg} draftCfg={editCfg} />
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
