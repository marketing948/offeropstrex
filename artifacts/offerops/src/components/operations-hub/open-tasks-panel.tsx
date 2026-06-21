/**
 * Operations Hub — Open Tasks summary panel.
 */

import { useLocation } from "wouter";
import type { TodoTask } from "@workspace/api-client-react";
import { classifyOpenTasks } from "@/components/operations-hub/ops-task-counts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Ban,
  ChevronRight,
  Clock,
  OctagonAlert,
  Siren,
} from "lucide-react";

export function OpenTasksPanel({
  tasks,
  loading,
}: {
  tasks: TodoTask[];
  loading?: boolean;
}) {
  const [, nav] = useLocation();
  const counts = classifyOpenTasks(tasks);

  return (
    <section
      className="rounded-[18px] border-2 border-orange-300/80 bg-gradient-to-br from-orange-50/90 via-white to-red-50/50 p-5 shadow-md shadow-orange-100/50 md:p-6"
      aria-labelledby="ops-open-tasks"
    >
      <div className="flex flex-wrap items-start gap-4 md:flex-nowrap">
        <div className="hidden shrink-0 sm:flex sm:items-center sm:justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-red-100 to-orange-100">
            <Siren className="h-12 w-12 text-red-500 drop-shadow-sm" strokeWidth={1.75} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-600" strokeWidth={2.25} />
                <h2
                  id="ops-open-tasks"
                  className="text-sm font-extrabold uppercase tracking-[0.14em] text-orange-700"
                >
                  Open Tasks
                </h2>
                {!loading && counts.total > 0 && (
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-2 text-[11px] font-black tabular-nums text-white shadow-sm">
                    {counts.total}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm text-slate-600">
                Critical, blocked, and overdue tasks — review and act now.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg border-slate-300 bg-white px-4 text-xs font-bold shadow-sm hover:bg-slate-50"
              onClick={() => nav("/tasks")}
            >
              View all tasks
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>

          {loading ? (
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <CounterCard
                label="Critical"
                value={counts.critical}
                tone="critical"
                onClick={() => nav("/tasks")}
              />
              <CounterCard
                label="Blocked"
                value={counts.blocked}
                tone="blocked"
                onClick={() => nav("/tasks")}
              />
              <CounterCard
                label="Overdue"
                value={counts.overdue}
                tone="overdue"
                onClick={() => nav("/tasks")}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CounterCard({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone: "critical" | "blocked" | "overdue";
  onClick: () => void;
}) {
  const styles = {
    critical: {
      card: "border-red-200/90 bg-white/90 hover:bg-red-50/50",
      icon: "bg-red-100 text-red-600",
      label: "text-red-600",
      value: "text-red-700",
      Icon: OctagonAlert,
    },
    blocked: {
      card: "border-orange-200/90 bg-white/90 hover:bg-orange-50/50",
      icon: "bg-orange-100 text-orange-600",
      label: "text-orange-600",
      value: "text-orange-700",
      Icon: Ban,
    },
    overdue: {
      card: "border-red-200/80 bg-white/90 hover:bg-red-50/40",
      icon: "bg-red-100 text-red-500",
      label: "text-red-500",
      value: "text-red-600",
      Icon: Clock,
    },
  };

  const s = styles[tone];
  const Icon = s.Icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-4 rounded-xl border-2 px-4 py-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${s.card}`}
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${s.icon}`}
      >
        <Icon className="h-5 w-5" strokeWidth={2.25} />
      </div>
      <div>
        <p className={`text-[11px] font-extrabold uppercase tracking-wider ${s.label}`}>
          {label}
        </p>
        <p className={`mt-0.5 text-4xl font-black tabular-nums leading-none ${s.value}`}>
          {value}
        </p>
      </div>
    </button>
  );
}
