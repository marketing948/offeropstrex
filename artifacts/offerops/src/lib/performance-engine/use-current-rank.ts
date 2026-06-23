import { useWorkerMonthlyGoals } from "@/lib/performance-engine/use-worker-monthly-goals";
import { useGoalsConfig, ensureGoalsConfig, DEFAULT_CONFIG, getRankForScore, getNextRank } from "@/lib/goals-config";
import { useAuth } from "@/lib/auth";

export function useCurrentRank() {
  const { currentEmployee } = useAuth();
  const { data: cfgRaw } = useGoalsConfig();
  const cfg = ensureGoalsConfig(cfgRaw ?? DEFAULT_CONFIG);
  const goalsQ = useWorkerMonthlyGoals(!!currentEmployee);

  const myXp = goalsQ.workerRow?.xpEarned ?? 0;
  const rank = getRankForScore(myXp, cfg);
  const nextRank = getNextRank(rank, cfg);
  const progressToNext =
    nextRank && rank
      ? Math.min(100, Math.round(((myXp - rank.minScore) / (nextRank.minScore - rank.minScore)) * 100))
      : 100;

  return {
    rank,
    nextRank,
    myXp,
    progressToNext,
    xpReady: goalsQ.isSuccess,
    isLoading: goalsQ.isLoading,
    isWorker: goalsQ.isWorker,
  };
}
