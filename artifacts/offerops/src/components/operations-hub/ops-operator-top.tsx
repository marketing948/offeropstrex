/**
 * Operations Hub V3.1 — operator command center top section.
 */

import type {
  GoalKind,
  OpsCampaignRow,
} from "@/components/operations-hub/ops-hub-drilldown-data";
import { useOpsDrilldownData } from "@/components/operations-hub/ops-hub-drilldown-data";
import { GoalProgressHub } from "@/components/operations-hub/goal-progress-hub";
import type { TestingBatch, TodoTask } from "@workspace/api-client-react";

/** Hero goal cards only — page composes network / Focus / Tasks sections. */
export function OpsOperatorTop({
  batches,
  campaigns,
  tasks,
  loading: externalLoading,
  selectedMetric,
  onSelectMetric,
}: {
  batches: TestingBatch[];
  campaigns: OpsCampaignRow[];
  tasks: TodoTask[];
  loading?: boolean;
  selectedMetric: GoalKind;
  onSelectMetric: (kind: GoalKind) => void;
}) {
  const data = useOpsDrilldownData(batches, campaigns, tasks);
  const loading = externalLoading || data.isLoading;

  return (
    <GoalProgressHub
      goalCards={data.goalCards}
      loading={loading}
      selectedMetric={selectedMetric}
      onSelectMetric={onSelectMetric}
    />
  );
}

export { useOpsDrilldownData };
