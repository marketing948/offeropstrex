import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import type { GoalsConfig } from "@/lib/goals-config";
import type { EventPointRule } from "@/lib/worker-goals";

const CATEGORY_OPTIONS: { value: EventPointRule["category"]; label: string }[] = [
  { value: "report", label: "Report" },
  { value: "batch", label: "Batch" },
  { value: "campaign", label: "Campaign" },
  { value: "optimization", label: "Optimization" },
  { value: "manual", label: "Manual" },
  { value: "custom", label: "Custom" },
];

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

export function EventPointRulesTab({ cfg, onChange }: { cfg: GoalsConfig; onChange: (c: GoalsConfig) => void }) {
  const rules = cfg.eventPointRules ?? [];

  function updateRule(id: string, patch: Partial<EventPointRule>) {
    onChange({
      ...cfg,
      eventPointRules: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }

  function addRule() {
    const row: EventPointRule = {
      id: `epr_${Date.now()}`,
      eventKey: "custom_event",
      label: "New event rule",
      points: 10,
      isActive: true,
      category: "custom",
      description: "Configured rule — event tracking will apply when wired.",
    };
    onChange({ ...cfg, eventPointRules: [...rules, row] });
  }

  function removeRule(id: string) {
    onChange({ ...cfg, eventPointRules: rules.filter((r) => r.id !== id) });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Flexible gamification rules — separate from monthly worker goals.{" "}
        <strong>Configured rule — event tracking will apply when wired.</strong>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addRule} className="h-8 text-xs">
          <Plus size={12} className="mr-1" /> Add Event Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-lg border border-dashed text-center py-8 text-sm text-muted-foreground">
          No event point rules configured.
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-card p-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 items-end">
                <div>
                  <Label className="text-[10px] font-medium uppercase text-muted-foreground">Label</Label>
                  <Input
                    className="h-8 text-xs mt-0.5"
                    value={r.label}
                    onChange={(e) => updateRule(r.id, { label: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-medium uppercase text-muted-foreground">Event key</Label>
                  <Input
                    className="h-8 text-xs mt-0.5 font-mono"
                    value={r.eventKey}
                    onChange={(e) => updateRule(r.id, { eventKey: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-medium uppercase text-muted-foreground">Points</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs mt-0.5"
                    value={r.points}
                    onChange={(e) => updateRule(r.id, { points: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-medium uppercase text-muted-foreground">Category</Label>
                  <select
                    className="w-full h-8 text-xs px-2 rounded-md border border-input bg-background mt-0.5"
                    value={r.category ?? "custom"}
                    onChange={(e) =>
                      updateRule(r.id, { category: e.target.value as EventPointRule["category"] })
                    }
                  >
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end justify-between gap-2 pb-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">Active</span>
                    <Toggle checked={r.isActive} onChange={(v) => updateRule(r.id, { isActive: v })} />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRule(r.id)}
                    className="text-muted-foreground hover:text-destructive p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {r.description && (
                <p className="text-[11px] text-muted-foreground mt-2">{r.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
