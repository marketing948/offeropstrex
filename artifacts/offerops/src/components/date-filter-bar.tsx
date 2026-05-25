import type { DateFilterPreset, DateRangePreset } from "@/lib/date-filter-presets";
import {
  DATE_FILTER_PRESET_OPTIONS,
  DATE_RANGE_PRESET_OPTIONS,
} from "@/lib/date-filter-presets";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PresetKey = DateRangePreset | DateFilterPreset;

export function DateFilterBar({
  preset,
  onPresetChange,
  dateFrom,
  dateTo,
  onCustomRangeChange,
  showAllOption = false,
  sticky = false,
  className = "",
}: {
  preset: PresetKey;
  onPresetChange: (preset: PresetKey) => void;
  dateFrom: string;
  dateTo: string;
  onCustomRangeChange: (from: string, to: string) => void;
  showAllOption?: boolean;
  sticky?: boolean;
  className?: string;
}) {
  const options = showAllOption ? DATE_FILTER_PRESET_OPTIONS : DATE_RANGE_PRESET_OPTIONS;

  return (
    <div
      className={`space-y-2 ${sticky ? "sticky top-0 z-10 -mx-1 border-b border-border bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80" : ""} ${className}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Date
        </span>
        {options.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPresetChange(key)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              preset === key
                ? "border-foreground/25 bg-foreground/5 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[8.5rem] flex-1 space-y-1">
            <Label htmlFor="date-filter-from" className="text-[10px] text-muted-foreground">
              From
            </Label>
            <Input
              id="date-filter-from"
              type="date"
              value={dateFrom}
              onChange={(e) => onCustomRangeChange(e.target.value, dateTo)}
              className="h-9"
            />
          </div>
          <div className="min-w-[8.5rem] flex-1 space-y-1">
            <Label htmlFor="date-filter-to" className="text-[10px] text-muted-foreground">
              To
            </Label>
            <Input
              id="date-filter-to"
              type="date"
              value={dateTo}
              onChange={(e) => onCustomRangeChange(dateFrom, e.target.value)}
              className="h-9"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Single-day picker driven by the same preset chips (Today, Yesterday, etc.). */
export function DateFilterSingleDay({
  preset,
  onPresetChange,
  date,
  onDateChange,
  sticky = false,
  className = "",
  hint,
}: {
  preset: DateRangePreset;
  onPresetChange: (preset: DateRangePreset) => void;
  date: string;
  onDateChange: (iso: string) => void;
  sticky?: boolean;
  className?: string;
  hint?: string;
}) {
  return (
    <div className={className}>
      <DateFilterBar
        preset={preset === "custom" ? "custom" : preset}
        onPresetChange={(p) => {
          if (p === "all") return;
          onPresetChange(p as DateRangePreset);
        }}
        dateFrom={date}
        dateTo={date}
        onCustomRangeChange={(from) => onDateChange(from)}
        sticky={sticky}
      />
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
