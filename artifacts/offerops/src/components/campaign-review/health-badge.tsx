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

// ---- STEP 5: unified evaluator → badge mapping (single brain → UI) ----

import { evaluatorBadges, type CampaignBadge, type EvaluatorOutput } from "@workspace/alert-rules";

const EVALUATOR_BADGE_STYLE: Record<CampaignBadge, string> = {
  Winner: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  "Ready to scale": "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  "Should stop": "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  "Needs optimization": "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  "Traffic anomaly": "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200",
};

/**
 * Renders the unified evaluator's badges for a campaign. Same evaluator output
 * that drives the Daily Mission Board — one brain, same decisions everywhere.
 */
export function EvaluatorBadges({
  output,
  className,
}: {
  output: EvaluatorOutput;
  className?: string;
}) {
  const badges = evaluatorBadges(output);
  if (badges.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {badges.map((b) => (
        <span
          key={b}
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            EVALUATOR_BADGE_STYLE[b],
          )}
        >
          {b}
        </span>
      ))}
    </span>
  );
}
