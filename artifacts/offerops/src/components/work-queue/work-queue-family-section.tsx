import { useState } from "react";
import type { TodoTask } from "@workspace/api-client-react";
import type { FamilyQueueSection } from "@/lib/work-queue-families";
import { WorkQueueRow } from "@/components/work-queue/work-queue-row";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const COLLAPSE_THRESHOLD = 6;

export function WorkQueueFamilySection({
  section,
  showAssignee,
  trafficSourceNames,
  onOpenTask,
  onStartTask,
  starting,
}: {
  section: FamilyQueueSection;
  showAssignee: boolean;
  trafficSourceNames: Map<number, string>;
  onOpenTask: (task: TodoTask) => void;
  onStartTask: (task: TodoTask) => void;
  starting?: boolean;
}) {
  const { config } = section;
  const Icon = config.icon;
  const [collapsed, setCollapsed] = useState(false);
  const showCollapse = section.tasks.length > COLLAPSE_THRESHOLD;
  const visibleTasks =
    showCollapse && collapsed ? section.tasks.slice(0, COLLAPSE_THRESHOLD) : section.tasks;

  return (
    <section
      aria-labelledby={`family-${section.id}`}
      className={cn(
        "overflow-hidden rounded-lg border border-border/80",
        config.accentBorder,
        "border-l-[3px]",
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2.5",
          config.accentBg,
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            config.iconBg,
          )}
        >
          <Icon className={cn("h-4 w-4", config.iconFg)} />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={`family-${section.id}`}
            className={cn("text-sm font-bold tracking-tight", config.accentText)}
          >
            {config.label}
          </h2>
          <p className="text-[10px] text-muted-foreground leading-snug">{config.description}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
            config.iconBg,
            config.accentText,
          )}
        >
          {section.tasks.length}
        </span>
        {showCollapse && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[10px] font-semibold uppercase"
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? "View all" : "Show less"}
            <ChevronDown className={cn("h-3 w-3", !collapsed && "rotate-180")} />
          </Button>
        )}
      </header>

      <ul className="divide-y divide-border/50 bg-background/50">
        {visibleTasks.map((task) => (
          <li key={task.id}>
            <WorkQueueRow
              task={task}
              familyId={section.familyId}
              showAssignee={showAssignee}
              trafficSourceNames={trafficSourceNames}
              onOpen={() => onOpenTask(task)}
              onStart={() => onStartTask(task)}
              starting={starting}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
