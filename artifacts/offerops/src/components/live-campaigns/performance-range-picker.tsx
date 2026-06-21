/**
 * Live Campaigns — compact performance range picker (popover).
 */

import { useEffect, useState } from "react";
import {
  DATE_RANGE_PRESET_OPTIONS,
  type DateRangePreset,
} from "@/lib/date-filter-presets";
import { performanceRangeTriggerLabel } from "@/components/live-campaigns/live-campaign-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function PerformanceRangePicker({
  preset,
  dateFrom,
  dateTo,
  onPresetChange,
  onCustomRangeChange,
}: {
  preset: DateRangePreset;
  dateFrom: string;
  dateTo: string;
  onPresetChange: (preset: DateRangePreset) => void;
  onCustomRangeChange: (from: string, to: string) => void;
}) {
  const activePreset = preset === "all" ? "last7" : preset;
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(dateFrom);
  const [customTo, setCustomTo] = useState(dateTo);
  const [customMode, setCustomMode] = useState(activePreset === "custom");

  useEffect(() => {
    if (open) {
      setCustomFrom(dateFrom);
      setCustomTo(dateTo);
      setCustomMode(activePreset === "custom");
    }
  }, [open, dateFrom, dateTo, activePreset]);

  const triggerLabel = performanceRangeTriggerLabel(activePreset, dateFrom, dateTo);

  function selectPreset(key: DateRangePreset) {
    if (key === "custom") {
      setCustomMode(true);
      return;
    }
    onPresetChange(key);
    setOpen(false);
  }

  function applyCustom() {
    onCustomRangeChange(customFrom, customTo);
    setOpen(false);
  }

  function cancelCustom() {
    setCustomFrom(dateFrom);
    setCustomTo(dateTo);
    setCustomMode(activePreset === "custom");
    if (activePreset !== "custom") {
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full max-w-xl justify-between border-slate-200 bg-white px-3 text-left font-normal shadow-sm hover:bg-slate-50"
        >
          <span className="truncate text-sm text-slate-800">{triggerLabel}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        {!customMode ? (
          <ul className="py-1">
            {DATE_RANGE_PRESET_OPTIONS.map(({ key, label }) => (
              <li key={key}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50",
                    activePreset === key && "bg-slate-50 font-medium text-slate-900",
                  )}
                  onClick={() => selectPreset(key)}
                >
                  {label}
                  {activePreset === key && <Check className="h-4 w-4 text-violet-600" />}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3 p-4">
            <p className="text-sm font-semibold text-slate-900">Custom Range</p>
            <div className="space-y-2">
              <div>
                <Label htmlFor="perf-range-from" className="text-xs text-slate-500">
                  Start date
                </Label>
                <Input
                  id="perf-range-from"
                  type="date"
                  className="mt-1 h-9"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="perf-range-to" className="text-xs text-slate-500">
                  End date
                </Label>
                <Input
                  id="perf-range-to"
                  type="date"
                  className="mt-1 h-9"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={cancelCustom}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={applyCustom}>
                Apply
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
