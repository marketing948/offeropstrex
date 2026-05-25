import { useState } from "react";
import { useLocation } from "wouter";
import type { TodoTask, TodoTaskStatus } from "@workspace/api-client-react";
import { getTaskTypeVisual } from "@/lib/task-type-visuals";
import {
  formatTaskAge,
  getTaskVisualWeight,
  isCampaignOpsTask,
  isCompletedWorkerTask,
  isManualTask,
  isNewlyAssigned,
  isOverdueTask,
  taskLinkPath,
  type TaskVisualWeight,
} from "@/lib/work-queue";
import {
  formatDueDate,
  platformLabel,
  taskInstructions,
  workerTaskHeadline,
} from "@/lib/worker-tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarClock,
  ChevronDown,
  Copy,
  ExternalLink,
  Layers,
  MoreHorizontal,
  PlayCircle,
  User,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_LABEL: Record<TodoTaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

const WEIGHT_STYLES: Record<TaskVisualWeight, string> = {
  critical:
    "border-red-300/90 bg-red-50/40 shadow-sm ring-1 ring-red-200/60 dark:bg-red-950/20 dark:ring-red-900/50",
  elevated: "border-primary/25 bg-card shadow-sm",
  normal: "border-border bg-card",
  muted: "border-border/70 bg-muted/15 opacity-80",
};

function StatusPill({ status }: { status: TodoTaskStatus }) {
  const styles =
    status === "DONE"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200"
      : status === "IN_PROGRESS"
        ? "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-200"
        : status === "BLOCKED"
          ? "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-100"
          : "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/50 dark:text-slate-200";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${styles}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function WorkQueueRow({
  task,
  showAssignee,
  trafficSourceNames,
  onOpen,
  onStart,
  starting,
}: {
  task: TodoTask;
  showAssignee: boolean;
  trafficSourceNames: Map<number, string>;
  onOpen: () => void;
  onStart?: () => void;
  starting?: boolean;
}) {
  const [, nav] = useLocation();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

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
  const instructions = taskInstructions(task);
  const canStart = !readOnly && task.status === "TODO" && onStart;
  const blockedReason = (task as { blockedReason?: string | null }).blockedReason;
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

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <article
        className={`group rounded-xl border transition-colors hover:border-primary/30 ${WEIGHT_STYLES[weight]}`}
      >
        <div className={`h-1 rounded-t-xl ${visual.accentBar}`} />

        <div className="flex min-h-[5.5rem] flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-3 text-left sm:items-center"
            onClick={onOpen}
          >
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${visual.iconBg}`}
            >
              <Icon className={`h-5 w-5 ${visual.iconFg}`} />
            </span>

            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={task.status} />
                <Badge
                  variant="outline"
                  className={`border-0 text-[10px] font-semibold ${visual.badgeBg} ${visual.badgeFg}`}
                >
                  {visual.label}
                </Badge>
                {task.priority === "high" && !readOnly && (
                  <Badge variant="destructive" className="text-[10px]">
                    High priority
                  </Badge>
                )}
                {isNewlyAssigned(task) && (
                  <Badge className="border-0 bg-violet-100 text-[10px] text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
                    New
                  </Badge>
                )}
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

              <h2 className="text-base font-semibold leading-snug text-foreground">
                {workerTaskHeadline(task)}
              </h2>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {showAssignee && task.employeeName && (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                    <User className="h-3 w-3" />
                    {task.employeeName}
                  </span>
                )}
                {task.batchName && (
                  <span className="inline-flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    {task.batchName}
                  </span>
                )}
                {platform && <span>{platform}</span>}
                {trafficSourceName && <span>{trafficSourceName}</span>}
                {dueLabel && (
                  <span className={overdue ? "font-semibold text-red-600" : ""}>
                    <CalendarClock className="mr-0.5 inline h-3 w-3" />
                    {dueLabel}
                    {overdue ? " · overdue" : ""}
                  </span>
                )}
                {age && <span>Assigned {age}</span>}
              </div>
            </div>
          </button>

          <div className="flex shrink-0 items-center justify-end gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
            {canStart && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1"
                disabled={starting}
                onClick={(e) => {
                  e.stopPropagation();
                  onStart?.();
                }}
              >
                <PlayCircle className="h-3.5 w-3.5" />
                Start
              </Button>
            )}
            <Button type="button" size="sm" className="h-9" onClick={onOpen}>
              {readOnly ? "View" : "Open"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  aria-label="Task actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={onOpen}>Open details</DropdownMenuItem>
                {canStart && (
                  <DropdownMenuItem onClick={() => onStart?.()}>Mark in progress</DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => void copyLink()}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy link
                </DropdownMenuItem>
                {batchId != null && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => nav(`/testing-batches/${batchId}`)}>
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      Open batch
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label={expanded ? "Collapse details" : "Expand details"}
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        {task.status === "BLOCKED" && blockedReason && (
          <p className="mx-4 mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {blockedReason}
          </p>
        )}

        <CollapsibleContent>
          <div className="border-t border-border/60 px-4 py-3 text-sm">
            <p className="text-muted-foreground leading-relaxed">{instructions}</p>
            {task.description?.trim() && task.description.trim() !== instructions && (
              <p className="mt-2 text-xs text-muted-foreground/90">{task.description.trim()}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={onOpen}>
                Full details & completion
              </Button>
              {batchId != null && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => nav(`/testing-batches/${batchId}`)}
                >
                  Related batch
                </Button>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </article>
    </Collapsible>
  );
}
