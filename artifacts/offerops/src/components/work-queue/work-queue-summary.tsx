import { cn } from "@/lib/utils";

export type QueueSummaryCounts = {
  myTasks: number;
  overdue: number;
  highPriority: number;
  completedToday: number;
};

export function WorkQueueSummary({
  counts,
  className,
}: {
  counts: QueueSummaryCounts;
  className?: string;
}) {
  const items = [
    { key: "my", label: "My tasks", value: counts.myTasks, tone: "text-foreground" },
    {
      key: "overdue",
      label: "Overdue",
      value: counts.overdue,
      tone: counts.overdue > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
    },
    {
      key: "high",
      label: "High priority",
      value: counts.highPriority,
      tone: counts.highPriority > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
    },
    {
      key: "done",
      label: "Completed today",
      value: counts.completedToday,
      tone: "text-emerald-700 dark:text-emerald-400",
    },
  ] as const;

  return (
    <div
      className={cn(
        "flex flex-wrap gap-2 rounded-lg border border-border/80 bg-muted/20 px-2 py-2",
        className,
      )}
      role="group"
      aria-label="Queue summary"
    >
      {items.map((item) => (
        <div
          key={item.key}
          className="flex min-w-[5.5rem] flex-1 items-baseline gap-1.5 rounded-md bg-background/80 px-2.5 py-1.5 sm:min-w-0 sm:flex-none"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {item.label}
          </span>
          <span className={cn("text-sm font-bold tabular-nums", item.tone)}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}
