import type { DatePreset, QueueTab } from "@/lib/work-queue";
import { DATE_PRESET_OPTIONS, QUEUE_TAB_OPTIONS } from "@/lib/work-queue";
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
  showEmployeeFilter,
  employeeFilter,
  onEmployeeFilterChange,
  employees,
}: {
  queueTab: QueueTab;
  onQueueTabChange: (tab: QueueTab) => void;
  tabCounts: Record<QueueTab, number>;
  search: string;
  onSearchChange: (v: string) => void;
  datePreset: DatePreset;
  onDatePresetChange: (p: DatePreset) => void;
  showEmployeeFilter?: boolean;
  employeeFilter: string;
  onEmployeeFilterChange: (id: string) => void;
  employees: { id: number; name: string }[];
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

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Due
        </span>
        {DATE_PRESET_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onDatePresetChange(key)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              datePreset === key
                ? "border-foreground/25 bg-foreground/5 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {showEmployeeFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Employee
          </span>
          <select
            value={employeeFilter}
            onChange={(e) => onEmployeeFilterChange(e.target.value)}
            className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
