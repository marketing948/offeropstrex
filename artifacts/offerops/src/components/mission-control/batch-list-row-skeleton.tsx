import { Skeleton } from "@/components/ui/skeleton";

/** Fixed height to match BatchListRow and prevent layout shift. */
export function BatchListRowSkeleton() {
  return (
    <div className="h-[7.75rem] w-full rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <Skeleton className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <Skeleton className="h-3 w-full max-w-[12rem]" />
            <Skeleton className="h-3 w-full max-w-[8rem]" />
            <Skeleton className="h-3 w-full max-w-[14rem] sm:col-span-2" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-14 rounded-md" />
          </div>
        </div>
        <Skeleton className="mt-1 h-4 w-4 shrink-0" />
      </div>
    </div>
  );
}
