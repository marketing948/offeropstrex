import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, AlertCircle } from "lucide-react";
import {
  useListEmployees,
  getListEmployeesQueryKey,
} from "@workspace/api-client-react";
import { useWorkspace } from "@/lib/workspace-context";
import { wsQueryOpts } from "@/lib/ws-query";
import { DateFilterBar } from "@/components/date-filter-bar";
import { useDateFilterState } from "@/hooks/use-date-filter-state";
import {
  OPERATIONAL_ACTIVITY_EVENT_TYPES,
  OPERATIONAL_ACTIVITY_EVENT_LABELS,
  type OperationalActivityEventType,
  type OperationalActivityItem,
  fetchOperationalActivityRange,
  formatActivityTime,
  formatEntityRef,
  getOperationalActivityQueryKey,
} from "@/lib/operational-activity";
import { routeForEntity } from "@/lib/entity-navigation";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Activity() {
  const { activeWorkspaceId } = useWorkspace();
  const [, nav] = useLocation();
  const [eventType, setEventType] = useState<string>("all");
  const [employeeId, setEmployeeId] = useState<string>("all");

  const {
    preset,
    dateFrom,
    dateTo,
    setPreset,
    setCustomRange,
  } = useDateFilterState({
    storageKey: "offerops.dateFilter.activity",
    defaultPreset: "today",
    syncUrl: true,
  });

  const wsId = activeWorkspaceId ?? 0;
  const employeeParams = { workspace_id: wsId };
  const { data: employees = [] } = useListEmployees(
    employeeParams,
    wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(employeeParams)),
  );

  const employeeNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const e of employees) map.set(e.id, e.name);
    return map;
  }, [employees]);

  const queryParams = useMemo(
    () => ({
      workspace_id: wsId,
      date_from: dateFrom,
      date_to: dateTo,
      ...(eventType !== "all" ? { event_type: eventType } : {}),
      ...(employeeId !== "all" ? { actor_employee_id: Number(employeeId) } : {}),
    }),
    [wsId, dateFrom, dateTo, eventType, employeeId],
  );

  const { data: items = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: getOperationalActivityQueryKey(queryParams),
    queryFn: () => fetchOperationalActivityRange({ ...queryParams, limitPerDay: 80 }),
    enabled: !!activeWorkspaceId,
    staleTime: 20_000,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 overflow-x-hidden pb-10">
      <header>
        <div className="flex items-center gap-2 text-primary">
          <History className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-widest">Workspace</span>
        </div>
        <h1 className="mt-1 text-2xl font-black tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational timeline. Day boundaries use UTC on the server.
        </p>
      </header>

      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <DateFilterBar
          preset={preset}
          onPresetChange={setPreset}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onCustomRangeChange={setCustomRange}
          sticky
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Event type</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All events" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {OPERATIONAL_ACTIVITY_EVENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {OPERATIONAL_ACTIVITY_EVENT_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Could not load activity</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-3 text-sm font-medium text-primary hover:underline"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
          <History className="mx-auto mb-3 h-10 w-10 text-muted-foreground/35" />
          <p className="text-sm font-medium text-foreground">No activity in this range.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try another preset or clear filters.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {isFetching && !isLoading && (
            <p className="text-xs text-muted-foreground">Refreshing…</p>
          )}
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {items.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                employeeName={
                  item.actorEmployeeId != null
                    ? employeeNameById.get(item.actorEmployeeId) ??
                      `Employee #${item.actorEmployeeId}`
                    : null
                }
                onOpen={() => {
                  const route = routeForEntity(item.entityType, item.entityId);
                  if (route) nav(route);
                }}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActivityRow({
  item,
  employeeName,
  onOpen,
}: {
  item: OperationalActivityItem;
  employeeName: string | null;
  onOpen: () => void;
}) {
  const eventLabel =
    OPERATIONAL_ACTIVITY_EVENT_LABELS[item.eventType as OperationalActivityEventType] ??
    item.eventType.replace(/_/g, " ");

  const day = item.createdAt.slice(0, 10);

  return (
    <li>
      <button
        type="button"
        className="flex w-full gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
        onClick={onOpen}
      >
        <div className="w-14 shrink-0">
          <time
            className="block text-xs font-medium tabular-nums text-muted-foreground"
            dateTime={item.createdAt}
          >
            {formatActivityTime(item.createdAt)}
          </time>
          <span className="text-[10px] text-muted-foreground/80">{day}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-medium">
              {eventLabel}
            </Badge>
            {employeeName && (
              <span className="text-xs text-muted-foreground">{employeeName}</span>
            )}
          </div>
          <p className="mt-1.5 text-sm font-medium leading-snug text-foreground">{item.title}</p>
          {item.description?.trim() && (
            <p className="mt-1 text-sm text-muted-foreground">{item.description.trim()}</p>
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground/80">
            {formatEntityRef(item.entityType, item.entityId)}
          </p>
        </div>
      </button>
    </li>
  );
}
