/**
 * Worker View Phase 1 — "Today's work" at /tasks.
 * Assigned open tasks (CampaignOps + MANUAL) with filters and completion flows.
 */

import { useEffect, useMemo, useState } from "react";
import {
  getGetTodoTaskQueryKey,
  useGetTodoTask,
  useListTodoTasks,
  useUpdateTodoTask,
  useListWorkspaceTrafficSources,
  getListTodoTasksQueryKey,
  getListWorkspaceTrafficSourcesQueryKey,
  type TodoTask,
  type TodoTaskStatus,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { TaskDetailDrawer } from "@/components/task-detail-drawer";
import { getTaskTypeVisual } from "@/lib/task-type-visuals";
import {
  compareWorkerTasks,
  formatDueDate,
  isCampaignOpsTask,
  isManualTask,
  isOpenWorkerTask,
  isOverdueTask,
  matchesWorkerFilter,
  platformLabel,
  taskInstructions,
  type WorkerTaskFilter,
} from "@/lib/worker-tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarClock, CheckSquare, ChevronRight, PlayCircle, Plus } from "lucide-react";
import { CreateManualTaskDialog } from "@/components/create-manual-task-dialog";

const STATUS_LABEL: Record<TodoTaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

const FILTER_OPTIONS: { key: WorkerTaskFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "campaignops", label: "CampaignOps" },
  { key: "manual", label: "Manual" },
  { key: "overdue", label: "Overdue" },
  { key: "blocked", label: "Blocked" },
];

function todayHeading(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function parseOpenTaskIdFromUrl(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("open");
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default function Tasks() {
  const { activeWorkspaceId } = useWorkspace();
  const { currentEmployee } = useAuth();
  const queryClient = useQueryClient();
  const employeeId = currentEmployee?.id;
  const isAdmin = currentEmployee?.role === "admin";
  const [createManualOpen, setCreateManualOpen] = useState(false);

  const taskParams = {
    workspace_id: activeWorkspaceId ?? 0,
    ...(employeeId ? { employee_id: employeeId } : {}),
  };

  const { data: tasks, isLoading } = useListTodoTasks(
    taskParams,
    wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(taskParams), {
      staleTime: 20_000,
    }),
  );

  const tsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const { data: trafficSources = [] } = useListWorkspaceTrafficSources(
    tsParams,
    wsQueryOpts(activeWorkspaceId, getListWorkspaceTrafficSourcesQueryKey(tsParams)),
  );

  const trafficSourceNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const ts of trafficSources) map.set(ts.id, ts.name);
    return map;
  }, [trafficSources]);

  const updateTask = useUpdateTodoTask();
  const [selectedTask, setSelectedTask] = useState<TodoTask | null>(null);
  const [filter, setFilter] = useState<WorkerTaskFilter>("all");
  const [deepLinkTaskId] = useState(() => parseOpenTaskIdFromUrl());

  const { data: deepLinkedTask } = useGetTodoTask(deepLinkTaskId ?? 0, {
    query: {
      enabled: deepLinkTaskId != null,
      queryKey: getGetTodoTaskQueryKey(deepLinkTaskId ?? 0),
    },
  });

  useEffect(() => {
    if (deepLinkedTask) setSelectedTask(deepLinkedTask);
  }, [deepLinkedTask]);

  const openTasks = useMemo(
    () => (tasks ?? []).filter(isOpenWorkerTask),
    [tasks],
  );

  const filtered = useMemo(() => {
    return openTasks
      .filter((t) => matchesWorkerFilter(t, filter))
      .sort(compareWorkerTasks);
  }, [openTasks, filter]);

  const counts = useMemo(() => {
    const c: Record<WorkerTaskFilter, number> = {
      all: openTasks.length,
      campaignops: openTasks.filter(isCampaignOpsTask).length,
      manual: openTasks.filter(isManualTask).length,
      overdue: openTasks.filter((t) => isOverdueTask(t)).length,
      blocked: openTasks.filter((t) => t.status === "BLOCKED").length,
    };
    return c;
  }, [openTasks]);

  async function invalidateTasks() {
    if (!activeWorkspaceId) return;
    await queryClient.invalidateQueries({
      queryKey: getListTodoTasksQueryKey({ workspace_id: activeWorkspaceId, employee_id: employeeId }),
    });
  }

  async function markInProgress(task: TodoTask) {
    if (task.status === "IN_PROGRESS") return;
    await updateTask.mutateAsync({ id: task.id, data: { status: "IN_PROGRESS" } });
    await invalidateTasks();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <header>
        <div className="flex items-center gap-2 text-primary">
          <CheckSquare className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-widest">Today&apos;s work</span>
        </div>
        <h1 className="mt-1 text-2xl font-black tracking-tight">My tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">{todayHeading()}</p>
        {!isLoading && (
          <p className="mt-2 text-sm font-medium text-foreground">
            {openTasks.length === 0
              ? "Nothing assigned right now."
              : `${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}`}
            {counts.overdue > 0 && (
              <span className="ml-2 text-red-600">· {counts.overdue} overdue</span>
            )}
          </p>
        )}
        {isAdmin && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3 gap-1.5"
            onClick={() => setCreateManualOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Create manual task
          </Button>
        )}
      </header>

      {isAdmin && (
        <CreateManualTaskDialog open={createManualOpen} onOpenChange={setCreateManualOpen} />
      )}

      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map(({ key, label }) => (
          <FilterChip
            key={key}
            label={label}
            count={counts[key]}
            active={filter === key}
            onClick={() => setFilter(key)}
          />
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => (
            <WorkerTaskCard
              key={task.id}
              task={task}
              trafficSourceNames={trafficSourceNames}
              onOpen={() => setSelectedTask(task)}
              onStart={() => markInProgress(task)}
              starting={updateTask.isPending}
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
      {count > 0 && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </button>
  );
}

function WorkerTaskCard({
  task,
  trafficSourceNames,
  onOpen,
  onStart,
  starting,
}: {
  task: TodoTask;
  trafficSourceNames: Map<number, string>;
  onOpen: () => void;
  onStart: () => void;
  starting: boolean;
}) {
  const visual = getTaskTypeVisual(task.taskType as string);
  const Icon = visual.icon;
  const overdue = isOverdueTask(task);
  const dueLabel = formatDueDate(task.dueDate);
  const platform = platformLabel(task);
  const trafficSourceId = (task as { trafficSourceId?: number | null }).trafficSourceId;
  const trafficSourceName =
    task.trafficSourceName ??
    (trafficSourceId != null ? trafficSourceNames.get(trafficSourceId) : null);
  const instructions = taskInstructions(task);
  const canStart = task.status === "TODO";
  const isBlocked = task.status === "BLOCKED";
  const blockedReason = (task as { blockedReason?: string | null }).blockedReason;

  return (
    <article
      className={`overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md ${
        isBlocked
          ? "border-amber-300/80 bg-amber-50/30 dark:bg-amber-950/10"
          : overdue
            ? "border-red-300/70 ring-1 ring-red-200/50"
            : "border-border"
      }`}
    >
      <div className={`h-1 ${visual.accentBar}`} />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${visual.iconBg}`}>
            <Icon className={`h-5 w-5 ${visual.iconFg}`} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`text-[10px] font-semibold ${visual.badgeBg} ${visual.badgeFg} border-0`}>
                {visual.label}
              </Badge>
              <Badge
                variant={
                  task.priority === "high"
                    ? "destructive"
                    : task.priority === "medium"
                      ? "default"
                      : "secondary"
                }
                className="text-[10px] capitalize"
              >
                {task.priority}
              </Badge>
              <StatusPill status={task.status} />
              {isManualTask(task) && (
                <Badge variant="secondary" className="text-[10px]">
                  Manual
                </Badge>
              )}
              {isCampaignOpsTask(task) && (
                <Badge variant="secondary" className="text-[10px]">
                  CampaignOps
                </Badge>
              )}
            </div>

            <h2 className="mt-2 text-base font-semibold leading-snug text-foreground">{task.title}</h2>

            <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">{instructions}</p>

            <dl className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {task.batchName && (
                <div>
                  <dt className="inline font-medium text-foreground/80">Batch: </dt>
                  <dd className="inline">{task.batchName}</dd>
                </div>
              )}
              {platform && (
                <div>
                  <dt className="inline font-medium text-foreground/80">Platform: </dt>
                  <dd className="inline">{platform}</dd>
                </div>
              )}
              {trafficSourceName && (
                <div className="sm:col-span-2">
                  <dt className="inline font-medium text-foreground/80">Traffic source: </dt>
                  <dd className="inline">{trafficSourceName}</dd>
                </div>
              )}
              {dueLabel && (
                <div className={overdue ? "text-red-600 sm:col-span-2" : "sm:col-span-2"}>
                  <dt className="inline font-medium">
                    <CalendarClock className="mr-0.5 inline h-3 w-3" />
                    Due:{" "}
                  </dt>
                  <dd className="inline font-medium">{dueLabel}</dd>
                  {overdue && <span className="ml-1 font-semibold">(overdue)</span>}
                </div>
              )}
            </dl>

            {isBlocked && blockedReason && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                Blocked: {blockedReason}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
          {canStart && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={starting}
              onClick={(e) => {
                e.stopPropagation();
                void onStart();
              }}
            >
              <PlayCircle className="h-3.5 w-3.5" />
              Start
            </Button>
          )}
          <Button type="button" size="sm" className="gap-1.5" onClick={onOpen}>
            {task.status === "IN_PROGRESS" ? "Continue" : "Open"}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function StatusPill({ status }: { status: TodoTaskStatus }) {
  const styles =
    status === "IN_PROGRESS"
      ? "bg-blue-50 text-blue-800 border-blue-200"
      : status === "BLOCKED"
        ? "bg-amber-50 text-amber-900 border-amber-200"
        : "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styles}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function EmptyState({ filter }: { filter: WorkerTaskFilter }) {
  const messages: Record<WorkerTaskFilter, string> = {
    all: "You have no open tasks assigned. Check back later or ask your lead for work.",
    campaignops: "No open CampaignOps tasks right now.",
    manual: "No manual reminders assigned.",
    overdue: "Nothing overdue — nice work.",
    blocked: "No blocked tasks.",
  };
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
      <CheckSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground/35" />
      <p className="text-sm font-medium text-foreground">All clear</p>
      <p className="mt-1 text-sm text-muted-foreground">{messages[filter]}</p>
    </div>
  );
}
