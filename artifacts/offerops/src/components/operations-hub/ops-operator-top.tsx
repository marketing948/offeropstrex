/**
 * Operations Hub V3.1 — operator command center top section.
 */

import type {
  GoalKind,
  OpsCampaignRow,
} from "@/components/operations-hub/ops-hub-drilldown-data";
import { useOpsDrilldownData } from "@/components/operations-hub/ops-hub-drilldown-data";
import { GoalProgressHub } from "@/components/operations-hub/goal-progress-hub";
import { OpsActivityCounters } from "@/components/operations-hub/ops-activity-counters";
import type { TestingBatch, TodoTask, Offer } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { computeMetrics } from "@/lib/goals-config";
import { useMemo } from "react";

/** Hero goal cards only — page composes network / Focus / Tasks sections. */
export function OpsOperatorTop({
  batches,
  campaigns,
  tasks,
  offers = [],
  loading: externalLoading,
  selectedMetric,
  onSelectMetric,
}: {
  batches: TestingBatch[];
  campaigns: OpsCampaignRow[];
  tasks: TodoTask[];
  offers?: Offer[];
  loading?: boolean;
  selectedMetric: GoalKind;
  onSelectMetric: (kind: GoalKind) => void;
}) {
  const { currentEmployee } = useAuth();
  const data = useOpsDrilldownData(batches, campaigns, tasks);
  const loading = externalLoading || data.isLoading;

  const activityMetrics = useMemo(() => {
    if (!currentEmployee || !data.isWorker) return null;
    return computeMetrics(
      {
        id: currentEmployee.id,
        name: currentEmployee.name,
        role: currentEmployee.role,
        status: "active",
        email: currentEmployee.email,
        createdAt: new Date().toISOString(),
      },
      batches,
      offers,
      tasks,
    );
  }, [currentEmployee, data.isWorker, batches, offers, tasks]);

  return (
    <div className="space-y-6">
      <GoalProgressHub
        goalCards={data.goalCards}
        loading={loading}
        selectedMetric={selectedMetric}
        onSelectMetric={onSelectMetric}
      />
      {data.isWorker && (
        <OpsActivityCounters
          loading={loading}
          rows={[
            { label: "Batches Created", value: activityMetrics?.batches ?? batches.length },
            { label: "Live Campaigns", value: activityMetrics?.liveCampaigns ?? 0 },
            { label: "Optimizations Completed", value: activityMetrics?.optimizations ?? 0 },
            { label: "Winners Found", value: activityMetrics?.winners ?? 0 },
            { label: "Scale Tasks Created", value: activityMetrics?.scaleTasks ?? 0 },
          ]}
        />
      )}
    </div>
  );
}

export { useOpsDrilldownData };
