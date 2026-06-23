import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";
import type { GoalsConfig, BonusEvent } from "@/lib/goals-config";
import {
  BONUS_EVENT_CATALOG,
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
    <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
      Coming soon
    </span>
  );
}

function getBonusEntry(actionType: string) {
  return BONUS_EVENT_CATALOG.find((b) => b.actionType === actionType);
}

export function BonusEventsConfigTab({ cfg, onChange }: { cfg: GoalsConfig; onChange: (c: GoalsConfig) => void }) {
  const configured = new Set(cfg.bonusEvents.map((e) => e.bonusEventType ?? e.id));

  function updateEvent(id: string, patch: Partial<BonusEvent>) {
    onChange({ ...cfg, bonusEvents: cfg.bonusEvents.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  }

  function addEvent(actionType: string) {
    const entry = getBonusEntry(actionType);
    if (!entry) return;
    const row: BonusEvent = {
      id: `bonus_${actionType}`,
      bonusEventType: entry.actionType,
      name: entry.label,
      description: entry.description,
      multiplierTarget: entry.actionType,
      multiplier: 1,
      xpAmount: entry.defaultXp,
      active: entry.connectionStatus === "connected",
      expiresAt: null,
    };
    onChange({ ...cfg, bonusEvents: [...cfg.bonusEvents, row] });
  }

  function setEventType(id: string, actionType: string) {
    const entry = getBonusEntry(actionType);
    if (!entry) return;
    updateEvent(id, {
      bonusEventType: entry.actionType,
      name: entry.label,
      description: entry.description,
      multiplierTarget: entry.actionType,
      xpAmount: entry.defaultXp,
    });
  }

  function removeEvent(id: string) {
    onChange({ ...cfg, bonusEvents: cfg.bonusEvents.filter((e) => e.id !== id) });
  }

  const catalogToShow = BONUS_EVENT_CATALOG.filter((b) => !configured.has(b.actionType));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-amber-50/50 px-4 py-3 text-sm text-amber-950">
        <p className="font-medium">Bonus events</p>
        <p className="text-xs mt-1 text-amber-900/80">
          Monthly goal bonuses are connected via goal plan XP rewards. Other bonus types require backend hooks before they award XP.
        </p>
      </div>

      {catalogToShow.length > 0 && (
        <div className="flex justify-end">
          <select
            className="h-8 text-xs px-2 rounded-md border border-input bg-background max-w-xs"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                addEvent(e.target.value);
                e.target.value = "";
              }
            }}
          >
            <option value="" disabled>Add bonus event…</option>
            {[...catalogCategoryGroups(catalogToShow).entries()].map(([cat, items]) => (
              <optgroup key={cat} label={cat}>
                {items.map((item) => (
                  <option key={item.actionType} value={item.actionType}>
                    {item.label}
                    {item.connectionStatus !== "connected" ? " (coming soon)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {cfg.bonusEvents.length === 0 ? (
        <div className="rounded-lg border border-dashed text-center py-10 text-sm text-muted-foreground">
          No bonus events configured. Monthly goal XP is awarded through Monthly Goals plans.
        </div>
      ) : (
        <div className="space-y-2">
          {cfg.bonusEvents.map((ev) => {
            const entry = getBonusEntry(ev.bonusEventType ?? ev.multiplierTarget);
            const status = entry?.connectionStatus ?? "not_connected";
            return (
              <div
                key={ev.id}
                className={`rounded-lg border p-3 ${ev.active ? "border-amber-300 bg-amber-50/40" : "border-border bg-card"}`}
              >
                <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr_90px_36px_36px] gap-2 items-end">
                  <div>
                    <Label className="text-[10px] uppercase text-muted-foreground">Bonus event type</Label>
                    <select
                      className="w-full h-8 text-sm px-2 rounded-md border border-input bg-background mt-0.5"
                      value={ev.bonusEventType ?? ev.multiplierTarget}
                      onChange={(e) => setEventType(ev.id, e.target.value)}
                    >
                      {[...catalogCategoryGroups(BONUS_EVENT_CATALOG).entries()].map(([cat, opts]) => (
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
                    <p className="text-xs text-muted-foreground mt-4 leading-snug">{ev.description}</p>
                    <ConnectionBadge status={status} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-muted-foreground">XP / bonus</Label>
                    <Input
                      type="number"
                      className="h-8 text-sm mt-0.5"
                      value={ev.xpAmount ?? ev.multiplier}
                      onChange={(e) => updateEvent(ev.id, { xpAmount: Number(e.target.value) })}
                    />
                  </div>
                  <div className="flex items-end pb-1 justify-center">
                    <Toggle checked={ev.active} onChange={(v) => updateEvent(ev.id, { active: v })} />
                  </div>
                  <div className="flex items-end pb-1 justify-center">
                    <button type="button" onClick={() => removeEvent(ev.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
