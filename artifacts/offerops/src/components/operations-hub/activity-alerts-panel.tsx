import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useListNotifications,
  useMarkNotificationRead,
  getListNotificationsQueryKey,
  useListTodoTasks,
  getListTodoTasksQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth";
import {
  fetchOperationalActivity,
  formatActivityTime,
  getOperationalActivityQueryKey,
  OPERATIONAL_ACTIVITY_EVENT_LABELS,
  type OperationalActivityEventType,
  type OperationalActivityItem,
} from "@/lib/operational-activity";
import { routeForEntity, routeForNotification } from "@/lib/entity-navigation";
import { AlertTriangle, Bell, History } from "lucide-react";
import { OperationalEmpty } from "@/components/operational-state/operational-empty";
import { OperationalError } from "@/components/operational-state/operational-error";
import { ActivityTimelineSkeleton } from "@/components/operational-state/operational-skeletons";

const NOTIF_ICONS: Record<string, string> = {
  NEW_BATCH_CREATED: "🆕",
  TRACKER_CAMPAIGN_MISSING: "📡",
  INVALID_TAG: "🏷️",
  DUPLICATE_TRACKER_CAMPAIGN: "♊",
  SUSPICIOUS_BATCH_UPDATE: "⚠️",
  API_SYNC_FAILURE: "⛔",
  TASK_OVERDUE: "⏰",
};

const SEVERITY_RING: Record<string, string> = {
  info: "ring-blue-200",
  warning: "ring-amber-300",
  high: "ring-orange-400",
  critical: "ring-red-400",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ActivityAlertsPanel() {
  const { activeWorkspaceId } = useWorkspace();
  const { currentEmployee } = useAuth();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const wsId = activeWorkspaceId ?? 0;
  const today = todayIso();

  const employeeParams = { workspace_id: wsId };
  const { data: employees = [] } = useListEmployees(
    employeeParams,
    wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(employeeParams)),
  );
  const employeeNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of employees) m.set(e.id, e.name);
    return m;
  }, [employees]);

  const activityQuery = useQuery({
    queryKey: getOperationalActivityQueryKey({ workspace_id: wsId, date: today }),
    queryFn: () =>
      fetchOperationalActivity({ workspace_id: wsId, date: today, limit: 12 }),
    enabled: !!activeWorkspaceId,
    staleTime: 20_000,
  });

  const notifParams = {
    workspace_id: wsId,
    employee_id: currentEmployee?.id ?? 0,
  };
  const { data: notifications = [] } = useListNotifications(
    notifParams,
    wsQueryOpts(activeWorkspaceId, getListNotificationsQueryKey(notifParams)),
  );

  const markRead = useMarkNotificationRead({
    mutation: {
      onSuccess: () =>
        qc.invalidateQueries({
          queryKey: getListNotificationsQueryKey(notifParams),
        }),
    },
  });

  const taskParams = { workspace_id: wsId };
  const { data: tasks = [] } = useListTodoTasks(
    taskParams,
    wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(taskParams)),
  );

  const blockedTasks = useMemo(
    () => tasks.filter((t) => t.status === "BLOCKED").slice(0, 6),
    [tasks],
  );

  const recentNotifs = notifications.slice(0, 8);
  const activityItems = activityQuery.data?.items ?? [];

  const openActivity = (item: OperationalActivityItem) => {
    const route = routeForEntity(item.entityType, item.entityId);
    if (route) nav(route);
  };

  const openNotification = (n: (typeof notifications)[0]) => {
    if (!n.read) markRead.mutate({ id: n.id });
    nav(routeForNotification(n));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Recent activity
          </h3>
          <button
            type="button"
            className="ml-auto text-xs text-primary hover:underline"
            onClick={() => nav("/activity")}
          >
            View all
          </button>
        </div>
        {activityQuery.isLoading ? (
          <ActivityTimelineSkeleton count={4} />
        ) : activityQuery.isError ? (
          <OperationalError
            title="Couldn't load recent activity"
            error={activityQuery.error}
            onRetry={() => void activityQuery.refetch()}
            retrying={activityQuery.isFetching}
          />
        ) : activityItems.length === 0 ? (
          <OperationalEmpty
            icon={History}
            title="No operational activity today"
            description="Events from batches, tasks, and campaigns will appear here."
            compact
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {activityItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                  onClick={() => openActivity(item)}
                >
                  <time className="w-12 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {formatActivityTime(item.createdAt)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{item.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {OPERATIONAL_ACTIVITY_EVENT_LABELS[
                        item.eventType as OperationalActivityEventType
                      ] ?? item.eventType}
                      {item.actorEmployeeId != null &&
                        ` · ${employeeNameById.get(item.actorEmployeeId) ?? "Employee"}`}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Notifications
            </h3>
          </div>
          {recentNotifs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/10 px-3 py-4 text-center text-xs text-muted-foreground">
              No notifications right now.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recentNotifs.map((n) => {
                const sev = (n as { severity?: string }).severity ?? "info";
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`flex w-full gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/50 ${
                        !n.read ? "border-primary/20 bg-primary/5" : "border-border bg-card"
                      }`}
                      onClick={() => openNotification(n)}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ${SEVERITY_RING[sev] ?? SEVERITY_RING.info}`}
                      >
                        {NOTIF_ICONS[n.type] ?? "🔔"}
                      </span>
                      <span className="min-w-0 flex-1 leading-snug">{n.message}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {blockedTasks.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Blocked tasks
              </h3>
            </div>
            <ul className="space-y-1.5">
              {blockedTasks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-amber-200/80 bg-amber-50/50 px-2.5 py-2 text-left text-xs hover:bg-amber-50 dark:bg-amber-950/20"
                    onClick={() => nav("/tasks")}
                  >
                    <p className="font-medium leading-snug">{t.title ?? t.taskType}</p>
                    {t.batchName && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{t.batchName}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
