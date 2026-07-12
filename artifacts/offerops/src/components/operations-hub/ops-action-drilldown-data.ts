/**
 * Operation Hub — action drill-down data (live operational sources only).
 */

import { useMemo } from "react";
import {
  useListPerformance,
  useListOffers,
  getListPerformanceQueryKey,
  getListOffersQueryKey,
  type Offer,
  type Performance,
  type TestingBatch,
} from "@workspace/api-client-react";
import { DEFAULT_ALERT_RULES, type AlertRulesConfig } from "@workspace/alert-rules";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { DEFAULT_CONFIG, useGoalsConfig } from "@/lib/goals-config";
import { useAlertRules } from "@/hooks/use-alert-rules";
import {
  deriveCampaignSignals,
  deriveHealthStatus,
} from "@/lib/campaign-review/heuristics";
import { deriveSummaryHealth } from "@/components/live-campaigns/live-campaign-health";
import type { OpsCampaignRow } from "@/components/operations-hub/ops-hub-drilldown-data";
import {
  ACTIVE_TESTING_STATUSES,
  isWorkingLiveCampaign,
  monthToDateRange,
  progressPct,
  resolveNetworkTarget,
} from "@/components/operations-hub/ops-v2-metrics";
import {
  buildBatchMeta,
  buildCampaignByIdMap,
  campaignMatchesNetwork,
  filterPerfByNetwork,
  networkMatches,
  resolvePerfAttribution,
  type OpsPerformanceRow,
} from "@/components/operations-hub/ops-network-attribution";
import type { GoalKind } from "@/components/operations-hub/ops-hub-drilldown-data";

export type ActionFilterChip =
  | "ready_to_scale"
  | "requires_attention"
  | "no_conversions"
  | "target_reached";

export type ActionTag = ActionFilterChip;

export type MetricTotals = {
  revenue: number;
  cost: number;
  profit: number;
  roi: number;
  conversions: number;
  visits: number;
};

export type RevenueBreakdownRow = MetricTotals & {
  id: string;
  label: string;
  tags: ActionTag[];
};

export type TestingHighlight =
  | "Near Threshold"
  | "Ready To Scale"
  | "Stuck Testing"
  | "No Conversions";

export type TestingOfferRow = {
  id: string;
  offer: string;
  geo: string;
  trafficSource: string;
  visits: number;
  conversions: number;
  revenue: number;
  cost: number;
  roi: number;
  daysActive: number;
  highlights: TestingHighlight[];
  tags: ActionTag[];
  batchId: number;
};

export type WorkingHighlight =
  | "Scaling Well"
  | "Performance Dropping"
  | "No Recent Conversions"
  | "Missing offer count"
  | "Behind target"
  | "Off target";

export type WorkingCampaignRow = {
  id: number;
  campaign: string;
  roi: number;
  revenue: number;
  profit: number;
  conversions: number;
  lastConversion: string | null;
  daysRunning: number;
  highlights: WorkingHighlight[];
  tags: ActionTag[];
};

function num(v: unknown): number {
  return Number(v ?? 0);
}

function roiPct(revenue: number, cost: number): number {
  if (cost <= 0) return revenue > 0 ? 100 : 0;
  return ((revenue - cost) / cost) * 100;
}

function aggregatePerf(rows: Performance[]): MetricTotals {
  let revenue = 0;
  let cost = 0;
  let profit = 0;
  let conversions = 0;
  let visits = 0;
  for (const r of rows) {
    revenue += num(r.revenue);
    cost += num(r.spend);
    profit += num(r.profit);
    conversions += num(r.conversions);
    visits += num(r.clicks);
  }
  return {
    revenue,
    cost,
    profit: profit || revenue - cost,
    roi: roiPct(revenue, cost),
    conversions,
    visits,
  };
}

function perfByBatchId(perf: Performance[]): Map<number, MetricTotals> {
  const map = new Map<number, Performance[]>();
  for (const r of perf) {
    const list = map.get(r.batchId) ?? [];
    list.push(r);
    map.set(r.batchId, list);
  }
  const out = new Map<number, MetricTotals>();
  for (const [batchId, rows] of map) {
    out.set(batchId, aggregatePerf(rows));
  }
  return out;
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function tagsFromHighlights(
  highlights: string[],
  extra: Partial<Record<ActionTag, boolean>> = {},
): ActionTag[] {
  const tags = new Set<ActionTag>();
  if (highlights.includes("Ready To Scale") || extra.ready_to_scale) {
    tags.add("ready_to_scale");
  }
  if (
    highlights.includes("Near Threshold") ||
    highlights.includes("Stuck Testing") ||
    highlights.includes("Performance Dropping") ||
    extra.requires_attention
  ) {
    tags.add("requires_attention");
  }
  if (
    highlights.includes("No Conversions") ||
    highlights.includes("No Recent Conversions") ||
    extra.no_conversions
  ) {
    tags.add("no_conversions");
  }
  if (extra.target_reached) tags.add("target_reached");
  return [...tags];
}

function classifyTestingRow(
  batch: TestingBatch,
  perf: MetricTotals,
  offer: Offer,
  rules: AlertRulesConfig = DEFAULT_ALERT_RULES,
): { highlights: TestingHighlight[]; tags: ActionTag[] } {
  const highlights: TestingHighlight[] = [];
  const clicks = perf.visits;
  const threshold = batch.clicksThreshold ?? 0;

  if (batch.status === "TESTED" || offer.status === "winner" || batch.conditionsMetAt) {
    highlights.push("Ready To Scale");
  }
  if (
    batch.status === "LIVE_TESTS" &&
    threshold > 0 &&
    clicks / threshold >= rules.optimization.offTargetRatio &&
    clicks / threshold < rules.optimization.behindTargetRatio
  ) {
    highlights.push("Near Threshold");
  }
  if (
    batch.status === "LIVE_TESTS" &&
    daysSince(batch.liveAt ?? batch.testStartDate) > rules.review.staleCampaignDays
  ) {
    highlights.push("Stuck Testing");
  }
  if (perf.conversions === 0 && perf.visits > 0) {
    highlights.push("No Conversions");
  }
  if (threshold > 0 && clicks >= threshold) {
    // target reached via click cap
  }

  const tags = tagsFromHighlights(highlights, {
    target_reached:
      batch.status === "TESTED" ||
      !!(threshold > 0 && clicks >= threshold) ||
      !!batch.conditionsMetAt,
  });

  return { highlights, tags };
}

function classifyWorkingRow(
  c: OpsCampaignRow,
  rules: ReturnType<typeof useAlertRules>["rules"],
): { highlights: WorkingHighlight[]; tags: ActionTag[] } {
  const highlights: WorkingHighlight[] = [];
  const revenue = num(c.revenue);
  const cost = num(c.cost);
  const roi = cost > 0 || revenue !== 0 ? roiPct(revenue, cost) : num(c.roi);
  const conversions = num(c.conversions);
  const visits = num(c.clicks);
  const daysLive = daysSince(c.liveStartedAt ?? null);
  const offerCount = Number(c.offerCount ?? 0);

  const signals = deriveCampaignSignals(
    {
      id: c.id ?? 0,
      campaignName: c.campaignName ?? "Campaign",
      batchId: null,
      batchName: null,
      employeeId: null,
      employeeName: null,
      platform: "ios",
      campaignPurpose: c.campaignPurpose ?? "working",
      status: c.status,
      liveStartedAt: c.liveStartedAt ?? null,
      clicks: visits,
      conversions,
      revenue,
      cost,
      roi,
    },
    1,
    daysLive,
    rules,
  );
  const health = signals.length === 0 ? "healthy" : deriveHealthStatus(signals);
  const pacingHealth = deriveSummaryHealth(
    null,
    {
      id: c.id ?? 0,
      campaignName: c.campaignName ?? "Campaign",
      batchId: null,
      batchName: null,
      employeeId: null,
      employeeName: null,
      platform: "ios",
      campaignPurpose: c.campaignPurpose ?? "working",
      status: c.status,
      liveStartedAt: c.liveStartedAt ?? null,
      clicks: visits,
      conversions,
      revenue,
      cost,
      roi,
    },
    offerCount,
    rules,
  );

  if (roi >= rules.scaling.minRoiPercentForPositiveSignal && conversions > 0) {
    highlights.push("Scaling Well");
  }
  if (
    roi < 0 ||
    health === "burning" ||
    health === "traffic_risk" ||
    signals.some((s) => s.kind === "traffic_decrease" || s.kind === "burning")
  ) {
    highlights.push("Performance Dropping");
  }
  if (conversions === 0 || signals.some((s) => s.kind === "zero_conversions")) {
    highlights.push("No Recent Conversions");
  }
  if (pacingHealth.status === "missing_offer_count") {
    highlights.push("Missing offer count");
  } else if (pacingHealth.status === "behind_target") {
    highlights.push("Behind target");
  } else if (pacingHealth.status === "off_target") {
    highlights.push("Off target");
  }

  const tags = tagsFromHighlights([], {
    ready_to_scale: highlights.includes("Scaling Well"),
    requires_attention:
      highlights.includes("Performance Dropping")
      || highlights.includes("Missing offer count")
      || highlights.includes("Behind target")
      || highlights.includes("Off target"),
    no_conversions: highlights.includes("No Recent Conversions"),
    target_reached:
      roi >= rules.scaling.minRoiPercentForPositiveSignal &&
      revenue >= rules.scaling.minRevenueForStrongSignal,
  });

  return { highlights, tags };
}

function revenueRowTags(
  row: MetricTotals,
  configuredTarget: number | null,
): ActionTag[] {
  const tags: ActionTag[] = [];
  if (row.conversions === 0 && row.visits > 0) tags.push("no_conversions");
  if (configuredTarget != null && configuredTarget > 0 && row.revenue >= configuredTarget) {
    tags.push("target_reached");
  }
  if (
    configuredTarget != null &&
    configuredTarget > 0 &&
    progressPct(row.revenue, configuredTarget) < 50
  ) {
    tags.push("requires_attention");
  }
  if (row.roi > 0 && row.conversions > 0) tags.push("ready_to_scale");
  return tags;
}

export function buildRevenueDrilldown(
  network: string,
  batches: TestingBatch[],
  campaigns: OpsCampaignRow[],
  offers: Offer[],
  perf: Performance[],
  kpiTargets: typeof DEFAULT_CONFIG.kpiTargets,
): {
  totals: MetricTotals;
  byAffiliate: RevenueBreakdownRow[];
  byGeo: RevenueBreakdownRow[];
  byOffer: RevenueBreakdownRow[];
} {
  const batchMeta = buildBatchMeta(batches);
  const campaignsById = buildCampaignByIdMap(campaigns);
  const networkPerf = filterPerfByNetwork(
    perf as OpsPerformanceRow[],
    network,
    campaignsById,
    batchMeta,
  );
  const totals = aggregatePerf(networkPerf as Performance[]);

  function bucketByKey(
    keyFn: (perfRow: OpsPerformanceRow) => string,
    labelFn: (key: string) => string,
  ): RevenueBreakdownRow[] {
    const acc = new Map<string, Performance[]>();
    for (const row of networkPerf) {
      const key = keyFn(row as OpsPerformanceRow);
      acc.set(key, [...(acc.get(key) ?? []), row as Performance]);
    }

    const rows: RevenueBreakdownRow[] = [];
    for (const [key, perfRows] of acc) {
      const metrics = aggregatePerf(perfRows);
      const { target } = resolveNetworkTarget(kpiTargets, "revenue", network);
      rows.push({
        id: key,
        label: labelFn(key),
        ...metrics,
        tags: revenueRowTags(metrics, target),
      });
    }
    return rows.sort((a, b) => b.revenue - a.revenue);
  }

  const byAffiliate = bucketByKey(
    (row) => {
      if (row.campaignId != null && row.batchId == null) {
        return `campaign:${row.campaignId}`;
      }
      if (row.batchId != null) {
        const b = batches.find((batch) => batch.id === row.batchId);
        if (b) return `employee:${b.employeeId}`;
      }
      if (row.campaignId != null) {
        return `campaign:${row.campaignId}`;
      }
      return "unknown";
    },
    (key) => {
      if (key.startsWith("campaign:")) {
        const id = Number(key.slice(9));
        return campaignsById.get(id)?.campaignName ?? key;
      }
      if (key.startsWith("employee:")) {
        const id = key.slice(9);
        return batches.find((b) => String(b.employeeId) === id)?.employeeName ?? id;
      }
      return key;
    },
  );

  const byGeo = bucketByKey(
    (row) => {
      const attr = resolvePerfAttribution(row, campaignsById, batchMeta);
      return attr?.geo ?? "(unset)";
    },
    (key) => key,
  );

  const byOffer = bucketByKey(
    (row) => {
      if (row.campaignId != null) {
        const c = campaignsById.get(row.campaignId);
        if (c?.campaignName) return `campaign:${c.campaignName}`;
      }
      if (row.batchId != null) {
        const batchOffers = offers.filter((o) => o.batchId === row.batchId);
        if (batchOffers.length === 1) return `offer:${batchOffers[0]!.offerName}`;
        const b = batches.find((batch) => batch.id === row.batchId);
        return `batch:${b?.batchName ?? row.batchId}`;
      }
      return "unknown";
    },
    (key) => {
      if (key.startsWith("offer:")) return key.slice(6);
      if (key.startsWith("campaign:")) return key.slice(9);
      if (key.startsWith("batch:")) return key.slice(6);
      return key;
    },
  );

  return { totals, byAffiliate, byGeo, byOffer };
}

export function buildTestingDrilldown(
  network: string,
  batches: TestingBatch[],
  offers: Offer[],
  perf: Performance[],
  rules: AlertRulesConfig = DEFAULT_ALERT_RULES,
): TestingOfferRow[] {
  const activeBatches = batches.filter(
    (b) =>
      networkMatches(b.affiliateNetwork, network) &&
      (ACTIVE_TESTING_STATUSES as readonly string[]).includes(b.status),
  );
  const batchIds = new Set(activeBatches.map((b) => b.id));
  const byBatchPerf = perfByBatchId(perf.filter((p) => batchIds.has(p.batchId)));

  const rows: TestingOfferRow[] = [];
  for (const batch of activeBatches) {
    const perfTotals = byBatchPerf.get(batch.id) ?? {
      revenue: 0,
      cost: 0,
      profit: 0,
      roi: 0,
      conversions: 0,
      visits: 0,
    };
    const batchOffers = offers.filter((o) => o.batchId === batch.id);
    const offerList = batchOffers.length > 0 ? batchOffers : [null];

    for (const offer of offerList) {
      const { highlights, tags } = classifyTestingRow(
        batch,
        perfTotals,
        offer ?? {
          id: batch.id,
          batchId: batch.id,
          offerName: batch.batchName,
          status: "testing",
          createdAt: batch.createdAt,
        },
        rules,
      );

      rows.push({
        id: `${batch.id}-${offer?.id ?? "batch"}`,
        offer: offer?.offerName ?? batch.batchName,
        geo: batch.geo,
        trafficSource: batch.trafficSource,
        visits: perfTotals.visits,
        conversions: perfTotals.conversions,
        revenue: perfTotals.revenue,
        cost: perfTotals.cost,
        roi: perfTotals.roi,
        daysActive: daysSince(batch.liveAt ?? batch.testStartDate ?? batch.createdAt),
        highlights,
        tags,
        batchId: batch.id,
      });
    }
  }

  return rows.sort((a, b) => b.revenue - a.revenue);
}

export function buildWorkingDrilldown(
  network: string,
  campaigns: OpsCampaignRow[],
  rules: ReturnType<typeof useAlertRules>["rules"],
): WorkingCampaignRow[] {
  return campaigns
    .filter((c) => isWorkingLiveCampaign(c) && campaignMatchesNetwork(c, network))
    .map((c) => {
      const revenue = num(c.revenue);
      const cost = num(c.cost);
      const profit = revenue - cost;
      const roi = cost > 0 || revenue !== 0 ? roiPct(revenue, cost) : num(c.roi);
      const conversions = num(c.conversions);
      const { highlights, tags } = classifyWorkingRow(c, rules);

      return {
        id: c.id ?? 0,
        campaign: c.campaignName ?? "Campaign",
        roi,
        revenue,
        profit,
        conversions,
        lastConversion: conversions > 0 ? (c.updatedAt ?? null) : null,
        daysRunning: daysSince(c.liveStartedAt ?? null),
        highlights,
        tags,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export function filterByActionChip<T extends { tags: ActionTag[] }>(
  rows: T[],
  chip: ActionFilterChip | null,
): T[] {
  if (!chip) return rows;
  return rows.filter((r) => r.tags.includes(chip));
}

export function useOpsActionDrilldown(
  metric: GoalKind | null,
  network: string | null,
  batches: TestingBatch[],
  campaigns: OpsCampaignRow[],
  offers: Offer[],
) {
  const { activeWorkspaceId } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;
  const { dateFrom, dateTo } = monthToDateRange();
  const { data: cfgRaw } = useGoalsConfig();
  const cfg = cfgRaw ?? DEFAULT_CONFIG;
  const { rules } = useAlertRules();

  const perfParams = { workspace_id: wsId, date_from: dateFrom, date_to: dateTo };
  const { data: perf = [], isLoading: perfLoading } = useListPerformance(
    perfParams,
    wsQueryOpts(activeWorkspaceId, getListPerformanceQueryKey(perfParams), {
      staleTime: 60_000,
      enabled: !!metric && !!network,
    }),
  );

  const offerParams = { workspace_id: wsId };
  const { data: allOffers = [], isLoading: offersLoading } = useListOffers(
    offerParams,
    wsQueryOpts(activeWorkspaceId, getListOffersQueryKey(offerParams), {
      enabled: !!metric && !!network && metric === "testing",
    }),
  );

  const offersSource = offers.length > 0 ? offers : allOffers;

  const revenue = useMemo(() => {
    if (!network) return null;
    return buildRevenueDrilldown(
      network,
      batches,
      campaigns,
      offersSource,
      perf,
      cfg.kpiTargets,
    );
  }, [network, batches, campaigns, offersSource, perf, cfg.kpiTargets]);

  const testing = useMemo(() => {
    if (!network) return [];
    return buildTestingDrilldown(network, batches, offersSource, perf, rules);
  }, [network, batches, offersSource, perf, rules]);

  const working = useMemo(() => {
    if (!network) return [];
    return buildWorkingDrilldown(network, campaigns, rules);
  }, [network, campaigns, rules]);

  return {
    dateFrom,
    dateTo,
    revenue,
    testing,
    working,
    isLoading: perfLoading || offersLoading,
  };
}
