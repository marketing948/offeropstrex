/**
 * Work Queue — operational task queue at /tasks (UI-only redesign).
 * Backend task APIs and completion flows unchanged.
 */

import { useEffect, useMemo, useState } from "react";
import {
  getGetTodoTaskQueryKey,
  useGetTodoTask,
  useListTodoTasks,
  useUpdateTodoTask,
  useListWorkspaceTrafficSources,
  useListEmployees,
  getListTodoTasksQueryKey,
  getListWorkspaceTrafficSourcesQueryKey,
  getListEmployeesQueryKey,
  type TodoTask,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { TaskDetailDrawer } from "@/components/task-detail-drawer";
import { WorkQueueRow } from "@/components/work-queue/work-queue-row";
import { WorkQueueToolbar } from "@/components/work-queue/work-queue-toolbar";
import { WorkQueueSummary } from "@/components/work-queue/work-queue-summary";
import { WorkQueueFilterRail } from "@/components/work-queue/work-queue-filter-rail";
import { WorkQueueFamilySection } from "@/components/work-queue/work-queue-family-section";
import {
  compareWorkerTasks,
  compareWorkerTasksForList,
} from "@/lib/worker-tasks";
import { resolveDateRangeFromPreset } from "@/lib/date-filter-presets";
import {
  countByQueueTab,
  dueDateInPreset,
  matchesQueueTab,
  matchesWorkQueueSearch,
  type DatePreset,
  type QueueTab,
} from "@/lib/work-queue";
import {
  completedTodayCount,
  groupTasksByFamily,
  highPriorityOpenCount,
  matchesRailDue,
  matchesRailPriority,
  matchesRailStatus,
  type WorkQueueRailFilters,
} from "@/lib/work-queue-families";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ClipboardList, Plus } from "lucide-react";
import { CreateManualTaskDialog } from "@/components/create-manual-task-dialog";
import { OperationalEmpty } from "@/components/operational-state/operational-empty";
import { OperationalError } from "@/components/operational-state/operational-error";
import { QueueListSkeleton } from "@/components/operational-state/operational-skeletons";
import { RefreshingHint } from "@/components/operational-state/refreshing-hint";
import { useToast } from "@/hooks/use-toast";
import { operationalErrorMessage } from "@/lib/operational-feedback";

function parseOpenTaskIdFromUrl(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("open");
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const DEFAULT_RAIL_FILTERS: WorkQueueRailFilters = {
  status: "all",
  priority: "all",
  due: "all",
};

export default function Tasks() {
  const { activeWorkspaceId } = useWorkspace();
  const { currentEmployee } = useAuth();
  const queryClient = useQueryClient();
  const employeeId = currentEmployee?.id;
  const isAdmin = currentEmployee?.role === "admin";

  const [createManualOpen, setCreateManualOpen] = useState(false);
  const [queueTab, setQueueTab] = useState<QueueTab>("my");
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");
  const [railFilters, setRailFilters] = useState<WorkQueueRailFilters>(DEFAULT_RAIL_FILTERS);

  const handleDuePresetChange = (p: DatePreset) => {
    setDatePreset(p);
    if (p === "all" || p === "custom") return;
    const r = resolveDateRangeFromPreset(p);
    setDueDateFrom(r.dateFrom);
    setDueDateTo(r.dateTo);
  };
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [selectedTask, setSelectedTask] = useState<TodoTask | null>(null);
  const [deepLinkTaskId] = useState(() => parseOpenTaskIdFromUrl());

  const wsId = activeWorkspaceId ?? 0;

  const employeeIdForFetch = useMemo(() => {
    if (!isAdmin) return employeeId;
    if (employeeFilter !== "all") return Number(employeeFilter);
    if (queueTab === "my") return employeeId;
    return undefined;
  }, [isAdmin, employeeId, employeeFilter, queueTab]);

  const taskParams = useMemo(
    () => ({
      workspace_id: wsId,
      status_filter: "all" as const,
      ...(employeeIdForFetch ? { employee_id: employeeIdForFetch } : {}),
    }),
    [wsId, employeeIdForFetch],
  );

  const { toast } = useToast();
  const {
    data: tasks,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useListTodoTasks(
    taskParams,
    wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(taskParams), {
      staleTime: 20_000,
    }),
  );

  const employeeParams = { workspace_id: wsId };
  const { data: employees = [] } = useListEmployees(
    employeeParams,
    wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(employeeParams), {
      enabled: isAdmin && !!activeWorkspaceId,
    }),
  );

  const tsParams = { workspace_id: wsId };
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

  const { data: deepLinkedTask } = useGetTodoTask(deepLinkTaskId ?? 0, {
    query: {
      enabled: deepLinkTaskId != null,
      queryKey: getGetTodoTaskQueryKey(deepLinkTaskId ?? 0),
    },
  });

  useEffect(() => {
    if (deepLinkedTask) setSelectedTask(deepLinkedTask);
  }, [deepLinkedTask]);

  const listedTasks = useMemo(() => tasks ?? [], [tasks]);

  const tabCounts = useMemo(
    () => countByQueueTab(listedTasks, employeeId),
    [listedTasks, employeeId],
  );

  const summaryCounts = useMemo(
    () => ({
      myTasks: tabCounts.my,
      overdue: tabCounts.overdue,
      highPriority: highPriorityOpenCount(listedTasks),
      completedToday: completedTodayCount(listedTasks),
    }),
    [tabCounts, listedTasks],
  );

  const filtered = useMemo(() => {
    return listedTasks
      .filter((t) => matchesQueueTab(t, queueTab, employeeId))
      .filter((t) => dueDateInPreset(t.dueDate, datePreset))
      .filter((t) => matchesWorkQueueSearch(t, search))
      .filter(
        (t) =>
          matchesRailStatus(t, railFilters.status) &&
          matchesRailPriority(t, railFilters.priority) &&
          matchesRailDue(t, railFilters.due),
      )
      .sort(queueTab === "completed" ? compareWorkerTasksForList : compareWorkerTasks);
  }, [listedTasks, queueTab, employeeId, datePreset, search, railFilters]);

  const familySections = useMemo(() => groupTasksByFamily(filtered), [filtered]);

  const pageTitle = isAdmin ? "Operations Queue" : "Work Queue";
  const showAssignee = isAdmin && (queueTab !== "my" || employeeFilter === "all");
  const showAssigneeFilter = isAdmin && queueTab !== "my";

  async function invalidateTasks() {
    if (!activeWorkspaceId) return;
    await queryClient.invalidateQueries({
      queryKey: getListTodoTasksQueryKey(taskParams),
    });
  }

  async function markInProgress(task: TodoTask) {
    if (task.status === "IN_PROGRESS" || updateTask.isPending) return;
    try {
      await updateTask.mutateAsync({ id: task.id, data: { status: "IN_PROGRESS" } });
      await invalidateTasks();
      toast({ title: "Task moved to in progress" });
    } catch (e) {
      toast({
        title: "Could not update task",
        description: operationalErrorMessage(e, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 overflow-x-hidden pb-10">
      <header>
        <div className="flex items-center gap-2 text-primary">
          <ClipboardList className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-widest">
            {pageTitle}
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-black tracking-tight">{pageTitle}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Organized work streams by task family — scan category first, then individual tasks.
          Execution stays here; campaign review decisions live on{" "}
          <Link href="/campaign-review" className="font-medium text-primary hover:underline">
            Campaign Review
          </Link>
          .
        </p>
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

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <WorkQueueFilterRail
          filters={railFilters}
          onFiltersChange={setRailFilters}
          showAssignee={showAssigneeFilter}
          employeeFilter={employeeFilter}
          onEmployeeFilterChange={setEmployeeFilter}
          employees={employees.map((e) => ({ id: e.id, name: e.name }))}
        />

        <div className="min-w-0 flex-1 space-y-3">
          <WorkQueueSummary counts={summaryCounts} />

          <WorkQueueToolbar
            queueTab={queueTab}
            onQueueTabChange={setQueueTab}
            tabCounts={tabCounts}
            search={search}
            onSearchChange={setSearch}
            datePreset={datePreset}
            onDatePresetChange={handleDuePresetChange}
            dateFrom={dueDateFrom}
            dateTo={dueDateTo}
            onCustomDueRangeChange={(from, to) => {
              setDatePreset("custom");
              setDueDateFrom(from);
              setDueDateTo(to);
            }}
          />

          <RefreshingHint visible={isFetching && !isLoading} className="-mt-1 mb-1" />

          {isLoading ? (
            <QueueListSkeleton count={4} />
          ) : isError ? (
            <OperationalError
              title="Couldn't load the work queue"
              error={error}
              onRetry={() => void refetch()}
              retrying={isFetching}
            />
          ) : filtered.length === 0 ? (
            <EmptyQueue queueTab={queueTab} search={search} />
          ) : (
            <div className="space-y-4">
              {familySections.map((section) => (
                <WorkQueueFamilySection
                  key={section.id}
                  section={section}
                  showAssignee={showAssignee}
                  trafficSourceNames={trafficSourceNames}
                  onOpenTask={setSelectedTask}
                  onStartTask={markInProgress}
                  starting={updateTask.isPending}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <TaskDetailDrawer
        task={selectedTask}
        open={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}

function EmptyQueue({ queueTab, search }: { queueTab: QueueTab; search: string }) {
  const hasSearch = search.trim() !== "";
  const title = hasSearch
    ? "No tasks match your search"
    : queueTab === "completed"
      ? "Nothing completed in this view"
      : queueTab === "blocked"
        ? "No blocked tasks"
        : queueTab === "overdue"
          ? "Nothing overdue"
          : queueTab === "active"
            ? "No active tasks right now"
            : "Your queue is clear";
  const description = hasSearch
    ? "Try a different keyword or clear filters."
    : queueTab === "completed"
      ? "Completed work will show up here when tasks are done."
      : queueTab === "my"
        ? "You're caught up — new assignments will appear here."
        : "Nothing needs attention on this tab.";
  return (
    <OperationalEmpty icon={ClipboardList} title={title} description={description} />
  );
}
