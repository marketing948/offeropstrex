/**
 * Operations Hub — inline drilldown sheets for Today's Focus and Open Tasks.
 */

import { useMemo } from "react";
import { Link } from "wouter";
import type { TodoTask } from "@workspace/api-client-react";
import type { FocusItem } from "@/components/operations-hub/ops-hub-drilldown-data";
import {
  getOpenTasksByCategory,
  isOverdueOpenTask,
  OPEN_TASK_CATEGORY_LABELS,
  type OpenTaskCategory,
} from "@/components/operations-hub/ops-task-counts";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  Ban,
  Calendar,
  ChevronRight,
  Clock,
  ExternalLink,
  FlaskConical,
  Globe,
  ListTodo,
  OctagonAlert,
} from "lucide-react";

function taskCategoryLabel(task: TodoTask, today: string): string | null {
  if (task.status === "BLOCKED") return "Blocked";
  if (isOverdueOpenTask(task, today)) return "Overdue";
  if (task.priority === "high") return "Critical";
  return null;
}

function TaskRow({
  task,
  today,
  onSelect,
}: {
  task: TodoTask;
  today: string;
  onSelect: (task: TodoTask) => void;
}) {
  const category = taskCategoryLabel(task, today);
  const related =
    task.batchName ??
    task.trafficSourceName ??
    (task.relatedBatchId ? `Batch #${task.relatedBatchId}` : null);

  return (
    <button
      type="button"
      onClick={() => onSelect(task)}
      className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-900">{task.title}</p>
          {category && (
            <Badge variant="outline" className="text-[10px] font-bold uppercase">
              {category}
            </Badge>
          )}
          {task.priority === "high" && task.status !== "BLOCKED" && (
            <Badge className="bg-red-100 text-[10px] font-bold uppercase text-red-700 hover:bg-red-100">
              High
            </Badge>
          )}
        </div>
        {task.description && (
          <p className="mt-1 line-clamp-2 text-xs text-slate-500">{task.description}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span className="capitalize">{task.status.toLowerCase().replace("_", " ")}</span>
          {related && <span>{related}</span>}
          {task.dueDate && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Due {task.dueDate.slice(0, 10)}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
    </button>
  );
}

export function OpsTaskListSheet({
  open,
  category,
  taskIds,
  tasks,
  today,
  onClose,
  onSelectTask,
}: {
  open: boolean;
  category: OpenTaskCategory | null;
  /** When set, shows only these task IDs (e.g. from Today's Focus). */
  taskIds?: number[] | null;
  tasks: TodoTask[];
  today: string;
  onClose: () => void;
  onSelectTask: (task: TodoTask) => void;
}) {
  const filtered = useMemo(() => {
    if (taskIds?.length) {
      const byId = new Map(tasks.map((t) => [t.id, t]));
      return taskIds.map((id) => byId.get(id)).filter((t): t is TodoTask => !!t);
    }
    return category ? getOpenTasksByCategory(tasks, category, today) : [];
  }, [tasks, category, today, taskIds]);

  const title = taskIds?.length
    ? "Related tasks"
    : category
      ? OPEN_TASK_CATEGORY_LABELS[category]
      : "Open tasks";
  const Icon =
    category === "critical"
      ? OctagonAlert
      : category === "blocked"
        ? Ban
        : category === "overdue"
          ? Clock
          : ListTodo;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-left">
            <Icon className="h-5 w-5 text-orange-600" />
            {title}
          </SheetTitle>
          <SheetDescription className="text-left">
            {filtered.length === 0
              ? "No tasks in this category right now."
              : `${filtered.length} task${filtered.length === 1 ? "" : "s"} from your workspace queue.`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex-1 space-y-2 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-600">Nothing to show here</p>
              <p className="mt-1 text-xs text-slate-500">
                Tasks appear when they match this category in your live queue.
              </p>
            </div>
          ) : (
            filtered.map((task) => (
              <TaskRow key={task.id} task={task} today={today} onSelect={onSelectTask} />
            ))
          )}
        </div>

        <div className="mt-4 border-t border-slate-200 pt-4">
          <Link href="/tasks">
            <Button variant="outline" className="w-full justify-between" onClick={onClose}>
              Open full Work Queue
              <ExternalLink className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function resolveFocusTasks(item: FocusItem, tasks: TodoTask[]): TodoTask[] {
  const ids = item.context?.taskIds;
  if (!ids?.length) return [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is TodoTask => !!t);
}

export function OpsFocusDetailSheet({
  open,
  item,
  tasks,
  onClose,
  onOpenTasks,
  onNavigate,
}: {
  open: boolean;
  item: FocusItem | null;
  tasks: TodoTask[];
  onClose: () => void;
  onOpenTasks: (taskIds: number[]) => void;
  onNavigate: (path: string) => void;
}) {
  const relatedTasks = useMemo(
    () => (item ? resolveFocusTasks(item, tasks) : []),
    [item, tasks],
  );
  const ctx = item?.context;

  if (!item) return null;

  const hasTasks = relatedTasks.length > 0;
  const hasNav = !!ctx?.navigationPath;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-left">
            <span className="mr-2">{item.emoji}</span>
            {item.title}
          </SheetTitle>
          <SheetDescription className="text-left text-sm text-slate-600">
            {item.text}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 flex-1 space-y-5 overflow-y-auto pr-1">
          {item.reason && (
            <section className="rounded-xl border border-violet-200/60 bg-violet-50/50 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">
                Why it matters
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{item.reason}</p>
            </section>
          )}

          {(ctx?.network || ctx?.geo || ctx?.batchName) && (
            <section className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Related context
              </p>
              <div className="space-y-2">
                {ctx.network && (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <Globe className="h-4 w-4 text-slate-400" />
                    <span className="font-medium text-slate-800">{ctx.network}</span>
                    {ctx.geo && <span className="text-slate-500">· {ctx.geo}</span>}
                  </div>
                )}
                {ctx.batchName && (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <FlaskConical className="h-4 w-4 text-slate-400" />
                    <span className="font-medium text-slate-800">{ctx.batchName}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {ctx?.metricLabel && ctx.metricValue && (
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {ctx.metricLabel}
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{ctx.metricValue}</p>
            </section>
          )}

          {ctx?.suggestedAction && (
            <section>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Suggested next action
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{ctx.suggestedAction}</p>
            </section>
          )}

          {hasTasks && (
            <section className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Linked tasks ({relatedTasks.length})
              </p>
              {relatedTasks.slice(0, 3).map((task) => (
                <div
                  key={task.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                >
                  {task.title}
                </div>
              ))}
              {relatedTasks.length > 3 && (
                <p className="text-xs text-slate-500">
                  +{relatedTasks.length - 3} more in the queue
                </p>
              )}
            </section>
          )}
        </div>

        <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
          {hasTasks ? (
            <Button
              className="w-full justify-between"
              onClick={() => {
                onOpenTasks(relatedTasks.map((t) => t.id));
                onClose();
              }}
            >
              Open related tasks
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : hasNav ? (
            <Button
              className="w-full justify-between"
              onClick={() => {
                onNavigate(ctx.navigationPath!);
                onClose();
              }}
            >
              View details
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button className="w-full" disabled>
              No linked task yet
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
