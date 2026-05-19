import type { BatchHealthRecommendation } from "@/lib/batch-health-api";
import {
  RECOMMENDATION_LABELS,
  RECOMMENDATION_TOOLTIPS,
  SEVERITY_META,
} from "@/lib/mission-control-health";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function RecommendationBadge({ rec }: { rec: BatchHealthRecommendation }) {
  const meta = SEVERITY_META[rec.severity];
  const Icon = meta.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`cursor-default gap-1 text-[10px] font-medium ${meta.badgeClass}`}
        >
          <Icon className={`h-3 w-3 shrink-0 ${meta.iconClass}`} />
          {RECOMMENDATION_LABELS[rec.code]}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs space-y-1">
        <p className="font-semibold">{RECOMMENDATION_LABELS[rec.code]}</p>
        <p className="text-primary-foreground/90">{RECOMMENDATION_TOOLTIPS[rec.code]}</p>
        <p className="font-mono text-[10px] text-primary-foreground/70">{rec.code}</p>
      </TooltipContent>
    </Tooltip>
  );
}
