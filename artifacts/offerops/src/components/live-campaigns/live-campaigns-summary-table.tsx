/**
 * Live Campaigns — compact summary table (Sketch 3).
 */

import type { AlertRulesConfig } from "@workspace/alert-rules";
import {
  evaluateCampaignMonitoringHealth,
  type ReviewCampaignInput,
} from "@/lib/campaign-review/heuristics";
import type { MonitoringCampaign, DailyMetricRow } from "@/components/live-campaigns/live-campaigns-monitoring-table";
import {
  campaignTypeBadgeClass,
  campaignTypeLabel,
  platformBadgeClass,
} from "@/components/live-campaigns/live-campaign-labels";
import {
  deriveSummaryHealth,
  deriveTrafficPacing,
  metricTone,
  metricToneClass,
  pacingBadgeClass,
  roiPercent,
  summaryHealthBadgeClass,
} from "@/components/live-campaigns/live-campaign-health";
import { formatVisitsDisplay } from "@/components/live-campaigns/live-campaign-visits";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TableRowsSkeleton,
  TableSectionState,
} from "@/components/operational-state/table-body-state";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

function fmtMoney(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function toReviewInput(c: MonitoringCampaign): ReviewCampaignInput {
  const roiNum = Number(c.roi ?? 0);
  return {
    id: c.id,
    campaignName: c.campaignName,
    batchId: c.batchId,
    batchName: c.batchName,
    employeeId: null,
    employeeName: c.employeeName,
    platform: c.platform,
    campaignPurpose: c.campaignPurpose,
    status: c.status,
    liveStartedAt: c.liveStartedAt,
    clicks: Number(c.clicks ?? 0),
    conversions: Number(c.conversions ?? 0),
    revenue: Number(c.revenue ?? 0),
    cost: Number(c.cost ?? 0),
    roi: Math.abs(roiNum) <= 1 ? roiNum * 100 : roiNum,
  };
}

function toRangeSnapshot(daily: DailyMetricRow | undefined) {
  if (!daily) return null;
  const cost = Number(daily.cost);
  const revenue = Number(daily.revenue);
  const profit = Number(daily.profit);
  return {
    visits: daily.visits,
    conversions: daily.conversions,
    cost,
    revenue,
    profit,
    roi: roiPercent(daily.roi),
  };
}

export function LiveCampaignsSummaryTable({
  campaigns,
  metricsByCampaignId,
  offersPerBatch,
  performanceRangeLabel,
  rules,
  isLoading,
  isError,
  loadErrorMessage,
  error,
  onRetry,
  retrying,
  onSelectCampaign,
}: {
  campaigns: MonitoringCampaign[];
  metricsByCampaignId: Map<number, DailyMetricRow>;
  offersPerBatch: Map<number, number>;
  performanceRangeLabel: string;
  rules: AlertRulesConfig;
  isLoading: boolean;
  isError: boolean;
  loadErrorMessage: string;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  onSelectCampaign: (campaign: MonitoringCampaign) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100">
      <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-4 py-3.5">
        <p className="text-sm font-bold tracking-tight text-slate-900">
          Performance · {performanceRangeLabel}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Click a row for details. Action Required shows what needs attention in this range.
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableRow className="bg-slate-50/90 hover:bg-slate-50/90">
              <TableHead className="sticky left-0 z-20 min-w-[200px] bg-slate-50/95 text-xs font-bold uppercase tracking-wide text-slate-500">
                Campaign
              </TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Campaign Type
              </TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wide text-slate-500">
                OS
              </TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Source
              </TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Network / GEO
              </TableHead>
              <TableHead className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Visits
              </TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                ROI
              </TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                Profit
              </TableHead>
              <TableHead className="text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                Conv
              </TableHead>
              <TableHead className="min-w-[108px] text-xs font-bold uppercase tracking-wide text-slate-500">
                Action Required
              </TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRowsSkeleton rows={6} cols={11} />
            ) : isError ? (
              <TableSectionState
                colSpan={11}
                variant="error"
                title="Couldn't load live campaigns"
                description={loadErrorMessage}
                error={error}
                onRetry={onRetry}
                retrying={retrying}
              />
            ) : campaigns.length === 0 ? (
              <TableSectionState
                colSpan={11}
                variant="empty"
                title="No campaigns match these filters"
                description="Adjust filters or import Voluum metrics for the selected range."
              />
            ) : (
              campaigns.map((c) => {
                const daily = metricsByCampaignId.get(c.id);
                const range = toRangeSnapshot(daily);
                const offerCount = c.batchId != null ? offersPerBatch.get(c.batchId) ?? 0 : 0;
                const reviewInput = toReviewInput(c);
                const monitoring = evaluateCampaignMonitoringHealth(reviewInput, offerCount, rules);
                const health = deriveSummaryHealth(range, reviewInput, offerCount, rules);
                const pacing = deriveTrafficPacing(
                  Number(c.clicks ?? 0),
                  monitoring.targetPct,
                  offerCount,
                );
                const roi = range?.roi ?? null;
                const profit = range?.profit ?? null;
                const conv = range?.conversions ?? null;
                const lifetimeVisits = Number(c.clicks ?? 0);
                const visitsDisplay = formatVisitsDisplay(
                  range,
                  lifetimeVisits,
                  offerCount,
                  monitoring.targetPct,
                  rules,
                );

                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer align-middle hover:bg-slate-50/80"
                    onClick={() => onSelectCampaign(c)}
                  >
                    <TableCell className="sticky left-0 z-10 max-w-[280px] bg-white py-3 group-hover:bg-slate-50/80">
                      <p
                        className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900"
                        title={c.campaignName}
                      >
                        {c.campaignName}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {[c.batchGeo, c.batchId != null ? `#${c.batchId}` : null, c.batchName]
                          .filter(Boolean)
                          .join(" · ") || `ID ${c.id}`}
                      </p>
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] font-semibold", campaignTypeBadgeClass(c.campaignPurpose))}
                      >
                        {campaignTypeLabel(c.campaignPurpose)}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className={cn("uppercase text-[10px] font-semibold", platformBadgeClass(c.platform))}
                      >
                        {c.platform}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[110px] truncate py-3 text-xs text-slate-700">
                      {c.trafficSourceName ?? "—"}
                    </TableCell>
                    <TableCell className="py-3 text-xs leading-snug text-slate-700">
                      <div className="truncate">{c.batchAffiliateNetwork ?? "—"}</div>
                      <div className="text-slate-500">{c.batchGeo ?? "—"}</div>
                    </TableCell>
                    <TableCell className="min-w-[120px] py-3">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "text-xs tabular-nums font-medium",
                              visitsDisplay.hasRangeData ? "text-slate-800" : "text-slate-400",
                            )}
                          >
                            {visitsDisplay.primary}
                          </p>
                          <p className="text-[10px] text-slate-500">{visitsDisplay.secondary}</p>
                          {offerCount > 0 && visitsDisplay.hasRangeData && (
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-violet-500 transition-all"
                                style={{ width: `${Math.min(100, monitoring.targetPct)}%` }}
                              />
                            </div>
                          )}
                        </div>
                        {visitsDisplay.hasRangeData && (
                          <Badge
                            variant="outline"
                            className={cn("shrink-0 text-[9px] font-semibold", pacingBadgeClass(pacing.pacing))}
                          >
                            {pacing.label}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-3 text-right text-sm font-semibold tabular-nums",
                        metricToneClass(metricTone(roi, "roi")),
                      )}
                    >
                      {fmtPct(roi)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-3 text-right text-sm font-semibold tabular-nums",
                        metricToneClass(metricTone(profit, "money")),
                      )}
                    >
                      {profit == null ? "—" : fmtMoney(profit)}
                    </TableCell>
                    <TableCell className="py-3 text-right text-sm tabular-nums text-slate-700">
                      {conv == null ? "—" : conv.toLocaleString()}
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className={cn("text-[11px] font-semibold", summaryHealthBadgeClass(health.status))}
                      >
                        {health.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 pr-3 text-slate-400">
                      <ChevronRight className="h-4 w-4" />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
