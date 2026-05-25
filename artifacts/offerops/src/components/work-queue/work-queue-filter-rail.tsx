import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { WorkQueueRailFilters } from "@/lib/work-queue-families";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: { value: WorkQueueRailFilters["status"]; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

const PRIORITY_OPTIONS: { value: WorkQueueRailFilters["priority"]; label: string }[] = [
  { value: "all", label: "All priorities" },
  { value: "high", label: "High only" },
  { value: "normal", label: "Normal & below" },
];

const DUE_OPTIONS: { value: WorkQueueRailFilters["due"]; label: string }[] = [
  { value: "all", label: "Any due date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Due this week" },
];

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RailBody({
  filters,
  onFiltersChange,
  showAssignee,
  employeeFilter,
  onEmployeeFilterChange,
  employees,
}: {
  filters: WorkQueueRailFilters;
  onFiltersChange: (next: WorkQueueRailFilters) => void;
  showAssignee: boolean;
  employeeFilter: string;
  onEmployeeFilterChange: (id: string) => void;
  employees: { id: number; name: string }[];
}) {
  return (
    <div className="space-y-3">
      <FilterSelect
        label="Status"
        value={filters.status}
        options={STATUS_OPTIONS}
        onChange={(status) => onFiltersChange({ ...filters, status })}
      />
      <FilterSelect
        label="Priority"
        value={filters.priority}
        options={PRIORITY_OPTIONS}
        onChange={(priority) => onFiltersChange({ ...filters, priority })}
      />
      <FilterSelect
        label="Due"
        value={filters.due}
        options={DUE_OPTIONS}
        onChange={(due) => onFiltersChange({ ...filters, due })}
      />
      {showAssignee && (
        <div className="space-y-1">
          <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Assignee
          </Label>
          <select
            value={employeeFilter}
            onChange={(e) => onEmployeeFilterChange(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="all">All operators</option>
            {employees.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-full text-xs"
        onClick={() =>
          onFiltersChange({ status: "all", priority: "all", due: "all" })
        }
      >
        Reset filters
      </Button>
    </div>
  );
}

export function WorkQueueFilterRail({
  filters,
  onFiltersChange,
  showAssignee,
  employeeFilter,
  onEmployeeFilterChange,
  employees,
  className,
}: {
  filters: WorkQueueRailFilters;
  onFiltersChange: (next: WorkQueueRailFilters) => void;
  showAssignee: boolean;
  employeeFilter: string;
  onEmployeeFilterChange: (id: string) => void;
  employees: { id: number; name: string }[];
  className?: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeFilterCount = [
    filters.status !== "all",
    filters.priority !== "all",
    filters.due !== "all",
    showAssignee && employeeFilter !== "all",
  ].filter(Boolean).length;

  return (
    <>
      <div className={cn("lg:hidden", className)}>
        <Collapsible open={mobileOpen} onOpenChange={setMobileOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="w-full gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded-lg border border-border bg-card p-3">
            <RailBody
              filters={filters}
              onFiltersChange={onFiltersChange}
              showAssignee={showAssignee}
              employeeFilter={employeeFilter}
              onEmployeeFilterChange={onEmployeeFilterChange}
              employees={employees}
            />
          </CollapsibleContent>
        </Collapsible>
      </div>

      <aside
        className={cn(
          "hidden shrink-0 lg:block lg:w-44 xl:w-48",
          "rounded-lg border border-border bg-card/40 p-3",
          className,
        )}
        aria-label="Queue filters"
      >
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Filters
        </p>
        <RailBody
          filters={filters}
          onFiltersChange={onFiltersChange}
          showAssignee={showAssignee}
          employeeFilter={employeeFilter}
          onEmployeeFilterChange={onEmployeeFilterChange}
          employees={employees}
        />
      </aside>
    </>
  );
}
