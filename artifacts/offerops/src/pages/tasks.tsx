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
import {
  compareWorkerTasks,
  compareWorkerTasksForList,
} from "@/lib/worker-tasks";
import {
  countByQueueTab,
  dueDateInPreset,
  groupActiveQueueTasks,
  matchesQueueTab,
  matchesWorkQueueSearch,
  type DatePreset,
  type QueueTab,
} from "@/lib/work-queue";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, Plus } from "lucide-react";
import { CreateManualTaskDialog } from "@/components/create-manual-task-dialog";

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
  const [queueTab, setQueueTab] = useState<QueueTab>("my");
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
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

  const { data: tasks, isLoading } = useListTodoTasks(
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

  const filtered = useMemo(() => {
    return listedTasks
      .filter((t) => matchesQueueTab(t, queueTab, employeeId))
      .filter((t) => dueDateInPreset(t.dueDate, datePreset))
      .filter((t) => matchesWorkQueueSearch(t, search))
      .sort(queueTab === "completed" ? compareWorkerTasksForList : compareWorkerTasks);
  }, [listedTasks, queueTab, employeeId, datePreset, search]);

  const sections = useMemo(() => {
    if (queueTab !== "active") return null;
    return groupActiveQueueTasks(filtered);
  }, [queueTab, filtered]);

  const pageTitle = isAdmin ? "Operations Queue" : "Work Queue";
  const showAssignee = isAdmin && (queueTab !== "my" || employeeFilter === "all");

  async function invalidateTasks() {
    if (!activeWorkspaceId) return;
    await queryClient.invalidateQueries({
      queryKey: getListTodoTasksQueryKey(taskParams),
    });
  }

  async function markInProgress(task: TodoTask) {
    if (task.status === "IN_PROGRESS") return;
    await updateTask.mutateAsync({ id: task.id, data: { status: "IN_PROGRESS" } });
    await invalidateTasks();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 overflow-x-hidden pb-10">
      <header>
        <div className="flex items-center gap-2 text-primary">
          <ClipboardList className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-widest">
            {pageTitle}
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-black tracking-tight">{pageTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan urgency, open details in-place, and move work forward without leaving the queue.
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

      <WorkQueueToolbar
        queueTab={queueTab}
        onQueueTabChange={setQueueTab}
        tabCounts={tabCounts}
        search={search}
        onSearchChange={setSearch}
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        showEmployeeFilter={isAdmin && queueTab !== "my"}
        employeeFilter={employeeFilter}
        onEmployeeFilterChange={setEmployeeFilter}
        employees={employees.map((e) => ({ id: e.id, name: e.name }))}
      />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyQueue queueTab={queueTab} search={search} />
      ) : sections && sections.length > 0 ? (
        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={`section-${section.id}`}>
              <h2
                id={`section-${section.id}`}
                className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"
              >
                {section.label}
                <span className="ml-2 font-mono text-[10px] text-muted-foreground/80">
                  {section.tasks.length}
                </span>
              </h2>
              <ul className="space-y-3">
                {section.tasks.map((task) => (
                  <li key={task.id}>
                    <WorkQueueRow
                      task={task}
                      showAssignee={showAssignee}
                      trafficSourceNames={trafficSourceNames}
                      onOpen={() => setSelectedTask(task)}
                      onStart={() => markInProgress(task)}
                      starting={updateTask.isPending}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((task) => (
            <li key={task.id}>
              <WorkQueueRow
                task={task}
                showAssignee={showAssignee}
                trafficSourceNames={trafficSourceNames}
                onOpen={() => setSelectedTask(task)}
                onStart={() => markInProgress(task)}
                starting={updateTask.isPending}
              />
            </li>
          ))}
        </ul>
      )}

      <TaskDetailDrawer
        task={selectedTask}
        open={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}

function EmptyQueue({ queueTab, search }: { queueTab: QueueTab; search: string }) {
  const headline =
    search.trim() !== ""
      ? "No matches"
      : queueTab === "completed"
        ? "Nothing completed yet"
        : queueTab === "blocked"
          ? "No blocked work"
          : queueTab === "overdue"
            ? "Nothing overdue"
            : "Queue is clear";
  const body =
    search.trim() !== ""
      ? "Try a different search or filter."
      : queueTab === "completed"
        ? "Finished tasks will appear here."
        : "You're caught up on this view.";
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/15 px-6 py-14 text-center">
      <ClipboardList className="mx-auto mb-3 h-10 w-10 text-muted-foreground/35" />
      <p className="text-sm font-medium text-foreground">{headline}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
