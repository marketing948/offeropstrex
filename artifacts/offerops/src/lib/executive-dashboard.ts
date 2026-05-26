import {
  DEFAULT_ALERT_RULES,
  milestoneFractions,
  type AlertRulesConfig,
} from "@workspace/alert-rules";
import type {
  Offer,
  TestingBatch,
  TodoTask,
} from "@workspace/api-client-react";
import type { DashboardBreakdownRow } from "@workspace/api-client-react";

/** @deprecated Use alert rules `testing.visitsPerOffer` via useAlertRules(). */
export const VISITS_PER_OFFER_TARGET = DEFAULT_ALERT_RULES.testing.visitsPerOffer;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export type ExecutiveAlert = {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  href: string;
  meta?: string;
};

export type WinnerLifecycleRow = {
  batchId: number;
  batchName: string;
  employeeName: string | null;
  state: "winner_found" | "reviewed" | "scaling_task" | "scaling_active" | "stale";
  stateLabel: string;
  winnerCount: number;
  href: string;
};

export type BurnRiskCampaign = {
  campaignId: number;
  campaignName: string;
  batchName: string | null;
  purpose: string;
  visits: number;
  targetVisits: number;
  pctOfTarget: number;
  conversions: number;
  severity: AlertSeverity;
  reason: string;
  href: string;
};

export type PipelineSignal = {
  id: string;
  label: string;
  count: number;
  href: string;
};

export type WorkforceRow = {
  employeeId: number;
  name: string;
  testsLaunched: number;
  campaignsLaunched: number;
  winnersFound: number;
  winnersScaled: number;
  profit: number;
  roi: number;
  openTasks: number;
  activityNote: string | null;
  href: string;
};

export type LiveCampaignRow = {
  id: number;
  campaignName: string;
  batchId: number | null;
  batchName: string | null;
  campaignPurpose: string;
  status: string;
  liveStartedAt: string | null;
  clicks: number;
  conversions: number;
  roi: number;
  employeeName: string | null;
};

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY);
}

function hoursSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_HOUR);
}

export function offersByBatch(offers: Offer[]): Map<number, Offer[]> {
  const map = new Map<number, Offer[]>();
  for (const o of offers) {
    if (o.batchId == null) continue;
    const list = map.get(o.batchId) ?? [];
    list.push(o);
    map.set(o.batchId, list);
  }
  return map;
}

export function buildExecutiveAlerts(input: {
  batches: TestingBatch[];
  tasks: TodoTask[];
  offers: Offer[];
  campaigns: LiveCampaignRow[];
  suspiciousCount: number;
  syncFailureCount: number;
  employeeFilterId?: number;
  rules?: AlertRulesConfig;
}): ExecutiveAlert[] {
  const { batches, tasks, offers, campaigns, suspiciousCount, syncFailureCount } = input;
  const rules = input.rules ?? DEFAULT_ALERT_RULES;
  const alerts: ExecutiveAlert[] = [];
  const now = new Date();

  const scaledBatchIds = new Set(
    batches.filter((b) => b.status === "COMPLETED").map((b) => b.id),
  );
  const testedBatches = batches.filter((b) => b.status === "TESTED");
  const liveTestBatches = batches.filter((b) => b.status === "LIVE_TESTS");

  const winners = offers.filter((o) => o.status === "winner");
  const unscaledByBatch = new Map<number, number>();
  for (const o of winners) {
    if (o.batchId == null || scaledBatchIds.has(o.batchId)) continue;
    unscaledByBatch.set(o.batchId, (unscaledByBatch.get(o.batchId) ?? 0) + 1);
  }
  for (const [batchId, count] of unscaledByBatch) {
    if (!rules.winners.batchFinishedWinnersNoActionEnabled) continue;
    const batch = batches.find((b) => b.id === batchId);
    alerts.push({
      id: `winners-scale-${batchId}`,
      severity: "high",
      title: `${count} winner${count !== 1 ? "s" : ""} awaiting scale action`,
      description: batch
        ? `${batch.batchName} finished testing with winners but scale lifecycle has not started.`
        : "Batch has classified winners without a completed scale path.",
      href: `/testing-batches/${batchId}`,
      meta: batch?.employeeName ?? undefined,
    });
  }

  for (const b of testedBatches) {
    const openFind = tasks.some(
      (t) =>
        t.status !== "DONE" &&
        t.relatedBatchId === b.id &&
        (t.taskType === "find_winners" || t.taskType === "FIND_WINNERS"),
    );
    if (openFind) {
      alerts.push({
        id: `pick-winners-${b.id}`,
        severity: "high",
        title: "Winners ready — classification task open",
        description: `${b.batchName} is in pick-winners; close the find-winners task to advance scale prep.`,
        href: "/tasks",
        meta: b.employeeName ?? undefined,
      });
    } else {
      const batchWinners = winners.filter((o) => o.batchId === b.id).length;
      if (batchWinners > 0) {
        alerts.push({
          id: `tested-stale-${b.id}`,
          severity: "medium",
          title: "Scale-ready batch needs next step",
          description: `${b.batchName} has ${batchWinners} winner(s) classified — confirm scaling task creation.`,
          href: `/testing-batches/${b.id}`,
          meta: b.employeeName ?? undefined,
        });
      }
    }
  }

  const offerMap = offersByBatch(offers);
  for (const c of campaigns) {
    if (c.campaignPurpose !== "testing" || c.status !== "live") continue;
    const batchOffers = c.batchId != null ? offerMap.get(c.batchId)?.length ?? 0 : 0;
    const target = Math.max(batchOffers, 1) * rules.testing.visitsPerOffer;
    const visits = c.clicks ?? 0;
    const conv = c.conversions ?? 0;
    const pct = target > 0 ? visits / target : 0;
    if (conv > 0) continue;
    if (!rules.testing.zeroConversionAtMilestoneEnabled) continue;
    const thresholds: { min: number; sev: AlertSeverity; label: string }[] = milestoneFractions(rules)
      .sort((a, b) => b - a)
      .map((min, i) => ({
        min,
        sev: (i === 0 ? "critical" : i === 1 ? "high" : "medium") as AlertSeverity,
        label: `${Math.round(min * 100)}% of visit target with zero conversions`,
      }));
    for (const t of thresholds) {
      if (pct >= t.min) {
        alerts.push({
          id: `burn-test-${c.id}-${t.min}`,
          severity: t.sev,
          title: "Testing campaign burn risk",
          description: `${c.campaignName}: ${t.label}.`,
          href: `/live-campaigns`,
          meta: `${Math.round(pct * 100)}% of target · ${visits.toLocaleString()} visits`,
        });
        break;
      }
    }
    if (pct >= 1 && conv === 0) {
      alerts.push({
        id: `burn-exhaust-${c.id}`,
        severity: "medium",
        title: "Testing traffic exhausted without conversions",
        description: `${c.campaignName} reached the visit target with no conversions recorded.`,
        href: `/live-campaigns`,
      });
    }
  }

  for (const c of campaigns) {
    if (c.campaignPurpose === "testing") continue;
    if (c.status !== "live") continue;
    const conv = c.conversions ?? 0;
    const hrs = hoursSince(c.liveStartedAt);
    if (conv === 0 && hrs >= rules.scaling.noConversionsAfterHours) {
      alerts.push({
        id: `scale-no-conv-${c.id}`,
        severity: "high",
        title: "Scale campaign — no conversions yet",
        description: `${c.campaignName} has been live ${hrs}h without conversions.`,
        href: `/live-campaigns`,
      });
    }
    if (c.roi < 0 && daysSince(c.liveStartedAt) >= rules.scaling.negativeRoiDays) {
      alerts.push({
        id: `scale-roi-${c.id}`,
        severity: "medium",
        title: "Scale campaign — sustained negative ROI",
        description: `${c.campaignName} shows negative ROI after 7+ days live.`,
        href: `/live-campaigns`,
      });
    }
  }

  for (const b of liveTestBatches) {
    if (daysSince(b.liveAt) > 14) {
      alerts.push({
        id: `stuck-${b.id}`,
        severity: "medium",
        title: "Stuck testing batch",
        description: `${b.batchName} has been live ${daysSince(b.liveAt)} days without moving to pick-winners.`,
        href: `/testing-batches/${b.id}`,
        meta: b.employeeName ?? undefined,
      });
    }
  }

  const overdue = tasks.filter(
    (t) => t.status !== "DONE" && t.dueDate && new Date(t.dueDate) < now,
  );
  if (overdue.length > 0) {
    alerts.push({
      id: "overdue-tasks",
      severity: "critical",
      title: `${overdue.length} overdue operational task${overdue.length !== 1 ? "s" : ""}`,
      description: "Work queue items passed their due date and need attention.",
      href: "/tasks",
    });
  }

  const blocked = tasks.filter((t) => t.status === "BLOCKED");
  if (blocked.length > 0) {
    alerts.push({
      id: "blocked-tasks",
      severity: "high",
      title: `${blocked.length} blocked task${blocked.length !== 1 ? "s" : ""}`,
      description: "Blocked work may be holding up batch or campaign progression.",
      href: "/tasks",
    });
  }

  if (suspiciousCount > 0) {
    alerts.push({
      id: "suspicious-batches",
      severity: "medium",
      title: `${suspiciousCount} batch${suspiciousCount !== 1 ? "es" : ""} flagged for review`,
      description: "Suspicious batch signals need admin review.",
      href: "/settings",
    });
  }

  if (syncFailureCount > 0) {
    alerts.push({
      id: "sync-failures",
      severity: "high",
      title: `${syncFailureCount} sync failure notification${syncFailureCount !== 1 ? "s" : ""}`,
      description: "Workspace sync issues may affect tracker or metrics freshness.",
      href: "/settings",
    });
  }

  const severityOrder: Record<AlertSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export function buildWinnerLifecycleRows(
  batches: TestingBatch[],
  offers: Offer[],
  tasks: TodoTask[],
): WinnerLifecycleRow[] {
  const rows: WinnerLifecycleRow[] = [];
  for (const b of batches) {
    const batchOffers = offers.filter((o) => o.batchId === b.id);
    const winnerCount = batchOffers.filter((o) => o.status === "winner").length;
    if (winnerCount === 0 && b.status !== "TESTED" && b.status !== "COMPLETED") continue;

    const openFind = tasks.some(
      (t) =>
        t.status !== "DONE" &&
        t.relatedBatchId === b.id &&
        (t.taskType === "find_winners" || t.taskType === "FIND_WINNERS"),
    );

    let state: WinnerLifecycleRow["state"] = "stale";
    let stateLabel = "Awaiting action";

    if (b.status === "COMPLETED") {
      state = "scaling_active";
      stateLabel = "Scaling path complete";
    } else if (openFind) {
      state = "reviewed";
      stateLabel = "Find-winners in progress";
    } else if (b.status === "TESTED" && winnerCount > 0) {
      state = "winner_found";
      stateLabel = "Winners classified — scale prep";
    } else if (winnerCount > 0) {
      state = "winner_found";
      stateLabel = "Winners recorded";
    } else if (b.status === "TESTED") {
      state = "stale";
      stateLabel = "Pick-winners gate — no winners yet";
    }

    rows.push({
      batchId: b.id,
      batchName: b.batchName,
      employeeName: b.employeeName ?? null,
      state,
      stateLabel,
      winnerCount,
      href: `/testing-batches/${b.id}`,
    });
  }
  return rows.sort((a, b) => b.winnerCount - a.winnerCount);
}

export function buildPipelineSignals(batches: TestingBatch[]): PipelineSignal[] {
  const waiting = batches.filter(
    (b) =>
      b.status === "NEW_BATCH" || b.status === "WAITING_FOR_TRACKER_CAMPAIGNS",
  ).length;
  const readyLive = batches.filter(
    (b) => b.status === "OFFER_READY_FOR_LIVE_TESTING",
  ).length;
  const live = batches.filter((b) => b.status === "LIVE_TESTS").length;
  const pickWinners = batches.filter((b) => b.status === "TESTED").length;
  const completed = batches.filter((b) => b.status === "COMPLETED").length;

  return [
    { id: "waiting", label: "Pre-live setup", count: waiting, href: "/testing-batches" },
    { id: "ready", label: "Ready for live test", count: readyLive, href: "/testing-batches" },
    { id: "live", label: "Live testing", count: live, href: "/testing-batches" },
    { id: "tested", label: "Scale-ready (pick winners)", count: pickWinners, href: "/testing-batches" },
    { id: "done", label: "Completed / scaling", count: completed, href: "/testing-batches" },
  ];
}

export function buildWorkforceRows(input: {
  leaderboard: {
    employeeId: number;
    employeeName: string;
    batchesCreated: number;
    batchesTested: number;
    campaignsMovedToMain: number;
    openTasks: number;
  }[];
  byWorker: DashboardBreakdownRow[] | undefined;
  offers: Offer[];
  batches: TestingBatch[];
}): WorkforceRow[] {
  const profitByEmp = new Map<number, DashboardBreakdownRow>();
  for (const row of input.byWorker ?? []) {
    const id = Number(row.key);
    if (Number.isFinite(id)) profitByEmp.set(id, row);
  }

  const winnersByEmp = new Map<number, number>();
  const scaledByEmp = new Map<number, number>();
  for (const o of input.offers) {
    if (o.batchId == null) continue;
    const batch = input.batches.find((b) => b.id === o.batchId);
    if (!batch?.employeeId) continue;
    if (o.status === "winner") {
      winnersByEmp.set(batch.employeeId, (winnersByEmp.get(batch.employeeId) ?? 0) + 1);
    }
  }
  for (const b of input.batches) {
    if (b.status === "COMPLETED" && b.employeeId) {
      scaledByEmp.set(b.employeeId, (scaledByEmp.get(b.employeeId) ?? 0) + 1);
    }
  }

  return input.leaderboard.map((entry) => {
    const fin = profitByEmp.get(entry.employeeId);
    const testsLaunched = entry.batchesCreated;
    const campaignsLaunched = entry.campaignsMovedToMain;
    const winnersFound = winnersByEmp.get(entry.employeeId) ?? 0;
    const winnersScaled = scaledByEmp.get(entry.employeeId) ?? 0;
    const profit = fin?.profit ?? 0;
    const roi = fin?.roi ?? 0;

    let activityNote: string | null = null;
    if (
      testsLaunched === 0 &&
      entry.batchesTested === 0 &&
      campaignsLaunched === 0 &&
      winnersFound === 0
    ) {
      activityNote = "Low operational activity in this period";
    } else if (entry.openTasks > 8) {
      activityNote = "Heavy open-task load";
    } else if (winnersFound > 0 && winnersScaled === 0) {
      activityNote = "Winners found — scale throughput low";
    }

    return {
      employeeId: entry.employeeId,
      name: entry.employeeName,
      testsLaunched,
      campaignsLaunched,
      winnersFound,
      winnersScaled,
      profit,
      roi,
      openTasks: entry.openTasks,
      activityNote,
      href: `/employees/${entry.employeeId}`,
    };
  });
}

export function countBurnRiskCampaigns(
  campaigns: LiveCampaignRow[],
  offers: Offer[],
  rules: AlertRulesConfig = DEFAULT_ALERT_RULES,
): number {
  const offerMap = offersByBatch(offers);
  const minMilestone = Math.min(...milestoneFractions(rules), 0.5);
  let n = 0;
  for (const c of campaigns) {
    if (c.campaignPurpose !== "testing" || c.status !== "live") continue;
    const batchOffers = c.batchId != null ? offerMap.get(c.batchId)?.length ?? 0 : 0;
    const target = Math.max(batchOffers, 1) * rules.testing.visitsPerOffer;
    const pct = target > 0 ? (c.clicks ?? 0) / target : 0;
    if ((c.conversions ?? 0) === 0 && pct >= minMilestone) n += 1;
  }
  return n;
}
