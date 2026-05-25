import type { DatePreset, QueueTab } from "@/lib/work-queue";
import { QUEUE_TAB_OPTIONS } from "@/lib/work-queue";
import { DateFilterBar } from "@/components/date-filter-bar";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export function WorkQueueToolbar({
  queueTab,
  onQueueTabChange,
  tabCounts,
  search,
  onSearchChange,
  datePreset,
  onDatePresetChange,
  dateFrom,
  dateTo,
  onCustomDueRangeChange,
}: {
  queueTab: QueueTab;
  onQueueTabChange: (tab: QueueTab) => void;
  tabCounts: Record<QueueTab, number>;
  search: string;
  onSearchChange: (v: string) => void;
  datePreset: DatePreset;
  onDatePresetChange: (p: DatePreset) => void;
  dateFrom: string;
  dateTo: string;
  onCustomDueRangeChange: (from: string, to: string) => void;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-1 space-y-3 border-b border-border bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search work queue…"
          className="h-10 pl-9"
          aria-label="Search work queue"
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
        {QUEUE_TAB_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onQueueTabChange(key)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
              queueTab === key
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {label}
            {tabCounts[key] > 0 && (
              <span
                className={`ml-1.5 tabular-nums ${
                  key === "blocked" || key === "overdue"
                    ? "text-red-600 dark:text-red-400"
                    : ""
                }`}
              >
                {tabCounts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      <DateFilterBar
        preset={datePreset}
        onPresetChange={onDatePresetChange}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onCustomRangeChange={onCustomDueRangeChange}
        showAllOption
      />
    </div>
  );
}
