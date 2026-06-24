export type GoalAllocationNetworkRow = {
  affiliateNetworkName: string;
  revenueTarget: number | null;
  testingTarget: number | null;
  workingTarget: number | null;
  geoCount: number;
  overrideCount: number;
  geoSplitRows: unknown[];
};

export type GoalAllocationResult = {
  overview: {
    revenue: { target: number };
    testing: { target: number };
    working: { target: number };
  };
  workerWideUnallocated: {
    revenueTarget: number | null;
    testingTarget: number | null;
    workingTarget: number | null;
  } | null;
  networks: GoalAllocationNetworkRow[];
};

export function sumNetworkMetricTargets(
  networks: GoalAllocationNetworkRow[],
  metric: "revenue" | "testing" | "working",
): number {
  const key =
    metric === "revenue"
      ? "revenueTarget"
      : metric === "testing"
        ? "testingTarget"
        : "workingTarget";
  return networks.reduce((sum, row) => sum + (row[key] ?? 0), 0);
}

export function overviewTargetMatchesNetworks(
  result: GoalAllocationResult,
  tolerance = 0.02,
): boolean {
  const revSum = sumNetworkMetricTargets(result.networks, "revenue");
  const testSum = sumNetworkMetricTargets(result.networks, "testing");
  const workSum = sumNetworkMetricTargets(result.networks, "working");

  const unalloc = result.workerWideUnallocated;
  const revTotal = revSum + (unalloc?.revenueTarget ?? 0);
  const testTotal = testSum + (unalloc?.testingTarget ?? 0);
  const workTotal = workSum + (unalloc?.workingTarget ?? 0);

  function close(a: number, b: number): boolean {
    if (a === 0 && b === 0) return true;
    return Math.abs(a - b) <= tolerance;
  }

  return (
    close(revTotal, result.overview.revenue.target) &&
    close(testTotal, result.overview.testing.target) &&
    close(workTotal, result.overview.working.target)
  );
}
