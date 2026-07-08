import { useEffect, useMemo, useState } from "react";
/**
 * Live Campaigns — compact summary table (Sketch 3).
 */

import type { AlertRulesConfig } from "@workspace/alert-rules";
import {
  type ReviewCampaignInput,
} from "@/lib/campaign-review/heuristics";
import type { MonitoringCampaign, DailyMetricRow } from "@/components/live-campaigns/live-campaigns-monitoring-table";
import {
  campaignTypeBadgeClass,
  campaignTypeLabel,
} from "@/components/live-campaigns/live-campaign-labels";
import {
  deriveSummaryHealth,
  metricTone,
  metricToneClass,
  roiPercent,
  summaryHealthBadgeClass,
} from "@/components/live-campaigns/live-campaign-health";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { sortRows, useTableSort } from "@/lib/use-table-sort";

const TABLE_COLS = 11;

function fmtMoney(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
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
  const sort = useTableSort("visits");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const sortedCampaigns = useMemo(
    () =>
      sortRows(
        campaigns,
        sort.col,
        sort.dir,
        (row, col) => {
          const c = row as MonitoringCampaign;
          const daily = metricsByCampaignId.get(c.id);
          const range = toRangeSnapshot(daily);
          if (col === "visits") return range?.visits ?? Number(c.clicks ?? 0);
          if (col === "revenue") return range?.revenue ?? Number(c.revenue ?? 0);
          if (col === "profit") return range?.profit ?? (Number(c.revenue ?? 0) - Number(c.cost ?? 0));
          if (col === "roi") return range?.roi ?? roiPercent(c.roi);
          if (col === "conversions") return range?.conversions ?? Number(c.conversions ?? 0);
          if (col === "offerCount") return c.offerCount ?? (c.batchId != null ? offersPerBatch.get(c.batchId) ?? 0 : 0);
          if (col === "campaignName") return c.campaignName;
          if (col === "geo") return c.batchGeo ?? "";
          return 0;
        },
      ),
    [campaigns, metricsByCampaignId, offersPerBatch, sort.col, sort.dir],
  );

  const visibleIds = useMemo(() => sortedCampaigns.map((c) => c.id), [sortedCampaigns]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [campaigns]);

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const id of visibleIds) next.add(id);
      } else {
        for (const id of visibleIds) next.delete(id);
      }
      return next;
    });
  }

  function toggleOne(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-4 py-3.5">
        <div>
          <p className="text-sm font-bold tracking-tight text-slate-900">
            Performance · {performanceRangeLabel}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Click a row for details. Action Required shows what needs attention in this range.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-800">
              {selectedCount} selected
            </span>
          )}
          <Button type="button" variant="outline" size="sm" disabled className="text-xs">
            Bulk actions
          </Button>
        </div>
      </div>
      <div className="w-full overflow-x-auto">
        <Table className="w-full table-fixed">
          <TableHeader>
            <TableRow className="bg-slate-50/90 hover:bg-slate-50/90">
              <TableHead className="w-10 px-2">
                <Checkbox
                  checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                  onCheckedChange={(v) => toggleAllVisible(v === true)}
                  aria-label="Select all visible campaigns"
                  disabled={visibleIds.length === 0 || isLoading}
                />
              </TableHead>
              <SortableTableHead
                className="w-[22%] text-xs font-bold uppercase tracking-wide text-slate-500"
                label="Campaign"
                col="campaignName"
                sort={sort}
              />
              <TableHead className="w-[9%] text-xs font-bold uppercase tracking-wide text-slate-500">
                Type
              </TableHead>
              <SortableTableHead
                className="w-[7%] text-xs font-bold uppercase tracking-wide text-slate-500"
                label="GEO"
                col="geo"
                sort={sort}
              />
              <SortableTableHead label="Visits" col="visits" sort={sort} align="right" className="w-[9%]" />
              <SortableTableHead label="Conversion" col="conversions" sort={sort} align="right" className="w-[9%]" />
              <SortableTableHead label="Profit" col="profit" sort={sort} align="right" className="w-[9%]" />
              <SortableTableHead label="ROI" col="roi" sort={sort} align="right" className="w-[8%]" />
              <SortableTableHead label="Offer count" col="offerCount" sort={sort} align="right" className="w-[9%]" />
              <TableHead className="w-[12%] text-xs font-bold uppercase tracking-wide text-slate-500">
                Action Required
              </TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRowsSkeleton rows={6} cols={TABLE_COLS} />
            ) : isError ? (
              <TableSectionState
                colSpan={TABLE_COLS}
                variant="error"
                title="Couldn't load live campaigns"
                description={loadErrorMessage}
                error={error}
                onRetry={onRetry}
                retrying={retrying}
              />
            ) : campaigns.length === 0 ? (
              <TableSectionState
                colSpan={TABLE_COLS}
                variant="empty"
                title="No campaigns match these filters"
                description="Adjust filters or import Voluum metrics for the selected range."
              />
            ) : (
              sortedCampaigns.map((c) => {
                const daily = metricsByCampaignId.get(c.id);
                const range = toRangeSnapshot(daily);
                const offerCount = c.offerCount ?? (c.batchId != null ? offersPerBatch.get(c.batchId) ?? 0 : 0);
                const reviewInput = toReviewInput(c);
                const health = deriveSummaryHealth(range, reviewInput, offerCount, rules);
                const roi = range?.roi ?? null;
                const profit = range?.profit ?? null;
                const conv = range?.conversions ?? null;
                const visits = range?.visits ?? Number(c.clicks ?? 0);
                const checked = selectedIds.has(c.id);

                return (
                  <TableRow
                    key={c.id}
                    className={cn(
                      "cursor-pointer align-middle hover:bg-slate-50/80",
                      checked && "bg-violet-50/40",
                    )}
                    onClick={() => onSelectCampaign(c)}
                  >
                    <TableCell
                      className="px-2 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggleOne(c.id, v === true)}
                        aria-label={`Select ${c.campaignName}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-0 py-3">
                      <p
                        className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900"
                        title={c.campaignName}
                      >
                        {c.campaignName}
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
                    <TableCell className="py-3 text-xs font-semibold uppercase tabular-nums text-slate-700">
                      {c.batchGeo ?? "—"}
                    </TableCell>
                    <TableCell className="py-3 text-right text-sm tabular-nums text-slate-800">
                      {visits.toLocaleString()}
                    </TableCell>
                    <TableCell className="py-3 text-right text-sm tabular-nums text-slate-700">
                      {conv == null ? "—" : conv.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-3 text-right text-sm font-semibold tabular-nums",
                        metricToneClass(metricTone(profit, "money")),
                      )}
                    >
                      {profit == null ? "—" : fmtMoney(profit)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-3 text-right text-sm font-semibold tabular-nums",
                        metricToneClass(metricTone(roi, "roi")),
                      )}
                    >
                      {fmtPct(roi)}
                    </TableCell>
                    <TableCell className="py-3 text-right text-sm tabular-nums text-slate-700">
                      {offerCount > 0 ? (
                        offerCount.toLocaleString()
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-semibold text-slate-700">
                          Missing
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className={cn("max-w-full truncate text-[10px] font-semibold", summaryHealthBadgeClass(health.status))}
                        title={health.label}
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
