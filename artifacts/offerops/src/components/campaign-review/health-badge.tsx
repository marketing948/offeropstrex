import type { CampaignHealthStatus } from "@/lib/campaign-review/types";
import { cn } from "@/lib/utils";

const STYLES: Record<CampaignHealthStatus, string> = {
  healthy: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  needs_review: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  winner_candidate: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  scaling_opportunity: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  traffic_risk: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  burning: "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200",
  stale: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  attention_required: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
};

export function CampaignHealthBadge({
  status,
  label,
  className,
}: {
  status: CampaignHealthStatus;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STYLES[status],
        className,
      )}
    >
      {label}
    </span>
  );
}
