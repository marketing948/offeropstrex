// Phase 9b — Tasks page rebuilt around the Bible §8 task taxonomy.
//
// Pivot Phase 5 (Task #28): Clicking a task row opens a per-task-type
// detail drawer (TaskDetailDrawer) with the right form for the task —
// campaign creation, go-live confirmation, results entry, etc. The
// drawer mutates the underlying domain row and then marks the task
// DONE; the engine handles all downstream effects.
//
// Task #40: Each task type now has a distinct visual identity (icon,
// accent color, label) sourced from `lib/task-type-visuals.ts`. A
// per-type filter chip row sits above the table, and empty states
// render the active filter's icon faded out.

import { useMemo, useState } from "react";
import { useListTodoTasks, useUpdateTodoTask, TodoTaskStatus, type TodoTask } from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { getListTodoTasksQueryKey } from "@workspace/api-client-react";
import { TaskDetailDrawer } from "@/components/task-detail-drawer";
import { ACTIVE_TASK_TYPES, getTaskTypeVisual } from "@/lib/task-type-visuals";

const STATUS_LABEL: Record<TodoTaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

const STATUS_ORDER: Record<TodoTaskStatus, number> = {
  TODO: 0,
  IN_PROGRESS: 1,
  BLOCKED: 2,
  DONE: 3,
};
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

type TypeFilter = "all" | string;

export default function Tasks() {
  const { activeWorkspaceId } = useWorkspace();
  const taskParams = { workspace_id: activeWorkspaceId ?? 0 };
  const { data: tasks, isLoading } = useListTodoTasks(
    taskParams,
    wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(taskParams)),
  );
  const updateTask = useUpdateTodoTask();
  const queryClient = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<TodoTask | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const handleStatusChange = async (id: number, status: TodoTaskStatus) => {
    await updateTask.mutateAsync({ id, data: { status } });
    if (activeWorkspaceId) {
      queryClient.invalidateQueries({ queryKey: getListTodoTasksQueryKey({ workspace_id: activeWorkspaceId }) });
    }
  };

  const sorted = useMemo(() => {
    const list = (tasks ?? [])
      .slice()
      .sort((a, b) => {
        const sa = STATUS_ORDER[a.status as TodoTaskStatus] ?? 9;
        const sb = STATUS_ORDER[b.status as TodoTaskStatus] ?? 9;
        if (sa !== sb) return sa - sb;
        const pa = PRIORITY_ORDER[a.priority] ?? 9;
        const pb = PRIORITY_ORDER[b.priority] ?? 9;
        return pa - pb;
      });
    if (typeFilter === "all") return list;
    return list.filter((t) => (t.taskType as string) === typeFilter);
  }, [tasks, typeFilter]);

  // Counts per active task type for the filter chips.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of tasks ?? []) {
      if (t.status === "DONE") continue;
      const k = t.taskType as string;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [tasks]);

  const totalOpen = useMemo(
    () => (tasks ?? []).filter((t) => t.status !== "DONE").length,
    [tasks],
  );

  const filterVisual = typeFilter === "all" ? null : getTaskTypeVisual(typeFilter);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
      </div>

      {/* Per-type filter chips */}
      <div className="flex flex-wrap gap-2">
        <FilterChip
          label="All"
          count={totalOpen}
          active={typeFilter === "all"}
          onClick={() => setTypeFilter("all")}
        />
        {ACTIVE_TASK_TYPES.map(({ key, visual }) => {
          const Icon = visual.icon;
          const active = typeFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTypeFilter(key)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-foreground/20 bg-foreground/5"
                  : "border-border hover:bg-muted/40"
              }`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full ${visual.iconBg}`}>
                <Icon className={`h-3 w-3 ${visual.iconFg}`} />
              </span>
              <span>{visual.label}</span>
              {counts[key] != null && counts[key] > 0 && (
                <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${visual.badgeBg} ${visual.badgeFg}`}>
                  {counts[key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="rounded-md border border-border bg-card/50 py-12 text-center text-muted-foreground">
          Loading tasks…
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState filterVisual={filterVisual} />
      ) : (
        <div className="space-y-2">
          {sorted.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={() => setSelectedTask(task)}
              onStatusChange={(s) => handleStatusChange(task.id, s)}
            />
          ))}
        </div>
      )}

      <TaskDetailDrawer
        task={selectedTask}
        open={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active ? "border-foreground/20 bg-foreground/5" : "border-border hover:bg-muted/40"
      }`}
    >
      <span>{label}</span>
      <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
        {count}
      </span>
    </button>
  );
}

function TaskRow({
  task,
  onOpen,
  onStatusChange,
}: {
  task: TodoTask;
  onOpen: () => void;
  onStatusChange: (s: TodoTaskStatus) => void;
}) {
  const visual = getTaskTypeVisual(task.taskType as string);
  const Icon = visual.icon;
  const isDone = task.status === "DONE";
  const flashing = (task as { flashing?: boolean }).flashing;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group relative flex cursor-pointer items-stretch overflow-hidden rounded-md border border-border bg-card/50 transition hover:bg-muted/30 ${
        isDone ? "opacity-60" : ""
      } ${flashing && !isDone ? "animate-pulse bg-amber-50/50 dark:bg-amber-950/20" : ""}`}
    >
      {/* Accent stripe */}
      <div className={`w-1 shrink-0 ${visual.accentBar}`} aria-hidden />

      {/* Icon chip */}
      <div className="flex items-center pl-3 pr-1">
        <span className={`flex h-9 w-9 items-center justify-center rounded-md ${visual.iconBg}`}>
          <Icon className={`h-4 w-4 ${visual.iconFg}`} />
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 items-center gap-3 px-3 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${visual.badgeBg} ${visual.badgeFg}`}>
              {visual.label}
            </span>
            {visual.isLegacy && (
              <span className="inline-flex items-center rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Legacy
              </span>
            )}
            <Badge
              variant={
                task.priority === "high"
                  ? "destructive"
                  : task.priority === "medium"
                  ? "default"
                  : "secondary"
              }
              className="text-[10px]"
            >
              {task.priority}
            </Badge>
          </div>
          <div className={`mt-1 text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>
            {task.title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{visual.subtext}</span>
            {task.batchName && <span>· Batch: {task.batchName}</span>}
            {task.employeeName && <span>· {task.employeeName}</span>}
          </div>
        </div>

        <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
          <Select value={task.status} onValueChange={(val) => onStatusChange(val as TodoTaskStatus)}>
            <SelectTrigger className="h-8 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(TodoTaskStatus).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s] ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Checkbox
            checked={isDone}
            onCheckedChange={(checked) => onStatusChange(checked ? "DONE" : "TODO")}
            aria-label="Mark task done"
          />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ filterVisual }: { filterVisual: ReturnType<typeof getTaskTypeVisual> | null }) {
  if (!filterVisual) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/30 py-12 text-center text-sm text-muted-foreground">
        No tasks found.
      </div>
    );
  }
  const Icon = filterVisual.icon;
  return (
    <div className="rounded-md border border-dashed border-border bg-card/30 py-12 text-center">
      <span className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${filterVisual.iconBg} opacity-60`}>
        <Icon className={`h-6 w-6 ${filterVisual.iconFg}`} />
      </span>
      <p className="text-sm text-muted-foreground">No {filterVisual.label.toLowerCase()} right now.</p>
    </div>
  );
}
