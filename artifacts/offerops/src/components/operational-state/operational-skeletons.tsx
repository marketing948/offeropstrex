import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function QueueRowSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      <Skeleton className="h-1 w-full rounded-none" />
      <div className="flex gap-3 p-4">
        <Skeleton className="h-11 w-11 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <Skeleton className="h-5 w-3/4 max-w-xs" />
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
      </div>
    </div>
  );
}

export function QueueListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading work queue">
      {Array.from({ length: count }, (_, i) => (
        <QueueRowSkeleton key={i} />
      ))}
    </div>
  );
}

export function KpiStripSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8"
      aria-busy="true"
      aria-label="Loading metrics"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="min-h-[4.5rem] rounded-lg border border-border bg-card px-3 py-2.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-7 w-12" />
        </div>
      ))}
    </div>
  );
}

export function ChartBlockSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-3", className)}>
      <Skeleton className="mb-2 h-3 w-28" />
      <Skeleton className="h-36 w-full rounded-md" />
    </div>
  );
}

export function PerformanceSectionSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading performance">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card px-3 py-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-2 h-6 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartBlockSkeleton />
        <ChartBlockSkeleton />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <Skeleton className="mb-3 h-3 w-24" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="mb-2 h-8 w-full" />
          ))}
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <Skeleton className="mb-3 h-3 w-28" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="mb-2 h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ActivityTimelineSkeleton({ count = 5 }: { count?: number }) {
  return (
    <ul
      className="divide-y divide-border rounded-xl border border-border bg-card"
      aria-busy="true"
      aria-label="Loading activity"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex gap-3 px-4 py-3.5">
          <Skeleton className="h-8 w-12 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-24 rounded-full" />
            <Skeleton className="h-4 w-full max-w-sm" />
            <Skeleton className="h-3 w-32" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DataTableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-border" aria-busy="true">
      <div className="flex gap-3 border-b border-border bg-muted/30 px-4 py-2">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-3 border-b border-border/60 px-4 py-3 last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ReportKpiCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      aria-busy="true"
      aria-label="Loading report summary"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card px-4 py-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-8 w-14" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function BatchAttentionSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading batch health">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[4.25rem] w-full rounded-lg" />
      ))}
    </div>
  );
}
