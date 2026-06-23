/**
 * Operations Hub — Monthly Goals hub (hero cards as metric selectors).
 */

import type { GoalCardModel, GoalKind } from "@/components/operations-hub/ops-hub-drilldown-data";
import { GoalHeroCard } from "@/components/operations-hub/goal-hero-card";
import { Skeleton } from "@/components/ui/skeleton";

export function GoalProgressHub({
  goalCards,
  loading,
  selectedMetric,
  onSelectMetric,
}: {
  goalCards: GoalCardModel[];
  loading?: boolean;
  selectedMetric: GoalKind;
  onSelectMetric: (kind: GoalKind) => void;
}) {
  return (
    <section className="space-y-4" aria-labelledby="ops-monthly-goals">
      <h2 id="ops-monthly-goals" className="sr-only">
        My Monthly Goals
      </h2>
      <div className="grid items-start gap-4 md:grid-cols-3">
        {loading
          ? [1, 2, 3].map((i) => <Skeleton key={i} className="min-h-[310px] rounded-[18px]" />)
          : goalCards.map((card) => (
              <GoalHeroCard
                key={card.kind}
                card={card}
                selected={selectedMetric === card.kind}
                onSelect={() => onSelectMetric(card.kind)}
              />
            ))}
      </div>
    </section>
  );
}
