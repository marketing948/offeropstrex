/**
 * Operations Hub — activity counters without fake monthly targets (worker view).
 */

import { Skeleton } from "@/components/ui/skeleton";

export type ActivityCounterRow = {
  label: string;
  value: number;
};

export function OpsActivityCounters({
  rows,
  loading,
}: {
  rows: ActivityCounterRow[];
  loading?: boolean;
}) {
  return (
    <section className="space-y-3" aria-labelledby="ops-activity-counters">
      <h2 id="ops-activity-counters" className="text-sm font-bold uppercase tracking-wider text-slate-600">
        Activity Counters
      </h2>
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm divide-y divide-slate-100">
        {loading
          ? [1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-6 w-10" />
              </div>
            ))
          : rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{row.label}</span>
                <span className="text-lg font-black tabular-nums text-slate-900">{row.value}</span>
              </div>
            ))}
      </div>
    </section>
  );
}
