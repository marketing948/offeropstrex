import { useLocation } from "wouter";
import type { TodoTask, TodoTaskStatus } from "@workspace/api-client-react";
import { getTaskTypeVisual } from "@/lib/task-type-visuals";
import {
  formatTaskAge,
  getTaskVisualWeight,
  isCompletedWorkerTask,
  isOverdueTask,
  taskLinkPath,
  type TaskVisualWeight,
} from "@/lib/work-queue";
import {
  getTaskFamilyConfig,
  resolveTaskFamily,
  type TaskFamilyId,
} from "@/lib/work-queue-families";
import {
  formatDueDate,
  platformLabel,
  workerTaskHeadline,
} from "@/lib/worker-tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarClock,
  Copy,
  ExternalLink,
  Layers,
  MoreHorizontal,
  PlayCircle,
  User,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<TodoTaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

const WEIGHT_ROW: Record<TaskVisualWeight, string> = {
  critical: "bg-red-50/50 dark:bg-red-950/15",
  elevated: "bg-primary/[0.03]",
  normal: "",
  muted: "opacity-75",
};

function StatusPill({ status }: { status: TodoTaskStatus }) {
  const styles =
    status === "DONE"
      ? "bg-emerald-100/90 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
      : status === "IN_PROGRESS"
        ? "bg-blue-100/90 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200"
        : status === "BLOCKED"
          ? "bg-amber-100/90 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100"
          : "bg-slate-100/90 text-slate-700 dark:bg-slate-900/50 dark:text-slate-200";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        styles,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function WorkQueueRow({
  task,
  familyId,
  showAssignee,
  trafficSourceNames,
  onOpen,
  onStart,
  starting,
}: {
  task: TodoTask;
  familyId?: TaskFamilyId;
  showAssignee: boolean;
  trafficSourceNames: Map<number, string>;
  onOpen: () => void;
  onStart?: () => void;
  starting?: boolean;
}) {
  const [, nav] = useLocation();
  const { toast } = useToast();

  const family = getTaskFamilyConfig(familyId ?? resolveTaskFamily(task));
  const visual = getTaskTypeVisual(task.taskType as string);
  const Icon = visual.icon;
  const weight = getTaskVisualWeight(task);
  const readOnly = isCompletedWorkerTask(task);
  const overdue = isOverdueTask(task);
  const dueLabel = formatDueDate(task.dueDate);
  const age = formatTaskAge(task.createdAt);
  const platform = platformLabel(task);
  const trafficSourceId = (task as { trafficSourceId?: number | null }).trafficSourceId;
  const trafficSourceName =
    task.trafficSourceName ??
    (trafficSourceId != null ? trafficSourceNames.get(trafficSourceId) : null);
  const canStart = !readOnly && task.status === "TODO" && onStart;
  const batchId = task.relatedBatchId;

  async function copyLink() {
    const url = `${window.location.origin}${taskLinkPath(task.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Could not copy link", variant: "destructive" });
    }
  }

  const metaParts = [
    showAssignee && task.employeeName ? task.employeeName : null,
    task.batchName,
    platform,
    trafficSourceName,
  ].filter(Boolean);

  return (
    <article
      className={cn(
        "group flex flex-col gap-0 sm:flex-row sm:items-center",
        WEIGHT_ROW[weight],
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left sm:py-2"
        onClick={onOpen}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            family.iconBg,
          )}
        >
          <Icon className={cn("h-3.5 w-3.5", family.iconFg)} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight text-foreground">
            {workerTaskHeadline(task)}
          </p>
          {metaParts.length > 0 && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-[11px] text-muted-foreground">
              {showAssignee && task.employeeName && (
                <span className="inline-flex items-center gap-0.5">
                  <User className="h-2.5 w-2.5" />
                  {task.employeeName}
                </span>
              )}
              {task.batchName && (
                <span className="inline-flex items-center gap-0.5">
                  <Layers className="h-2.5 w-2.5" />
                  {task.batchName}
                </span>
              )}
              {platform && <span>{platform}</span>}
              {trafficSourceName && <span>{trafficSourceName}</span>}
            </p>
          )}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-2 border-t border-border/40 px-3 py-2 sm:border-t-0 sm:px-0 sm:py-2 sm:pr-1">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 sm:items-end sm:px-3">
          <StatusPill status={task.status} />
          {dueLabel ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[10px] tabular-nums",
                overdue ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground",
              )}
            >
              <CalendarClock className="h-2.5 w-2.5" />
              {dueLabel}
            </span>
          ) : age ? (
            <span className="text-[10px] text-muted-foreground">{age}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-0.5">
          {task.priority === "high" && !readOnly && (
            <Badge variant="destructive" className="h-5 px-1.5 text-[9px]">
              High
            </Badge>
          )}
          {canStart && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 sm:hidden"
              disabled={starting}
              aria-label="Start task"
              onClick={(e) => {
                e.stopPropagation();
                onStart?.();
              }}
            >
              <PlayCircle className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden h-8 px-2 text-xs sm:inline-flex"
            onClick={onOpen}
          >
            {readOnly ? "View" : "Open"}
          </Button>
          {canStart && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="hidden h-8 gap-1 px-2 text-xs sm:inline-flex"
              disabled={starting}
              onClick={(e) => {
                e.stopPropagation();
                onStart?.();
              }}
            >
              <PlayCircle className="h-3 w-3" />
              Start
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Task actions"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onOpen}>Open details</DropdownMenuItem>
              {canStart && (
                <DropdownMenuItem onClick={() => onStart?.()}>Mark in progress</DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => void copyLink()}>
                <Copy className="mr-2 h-3 w-3" />
                Copy link
              </DropdownMenuItem>
              {batchId != null && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => nav(`/testing-batches/${batchId}`)}>
                    <ExternalLink className="mr-2 h-3 w-3" />
                    Open batch
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {task.status === "BLOCKED" && (task as { blockedReason?: string | null }).blockedReason && (
        <p className="border-t border-amber-200/60 bg-amber-50/80 px-3 py-1.5 text-[11px] text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100 sm:col-span-full">
          {(task as { blockedReason?: string }).blockedReason}
        </p>
      )}
    </article>
  );
}
