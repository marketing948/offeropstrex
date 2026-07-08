/**
 * Operation Hub — action drill-down panel (Drill Down V1).
 */

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { sortRows, useTableSort } from "@/lib/use-table-sort";
import { CompactKpi } from "@/components/operations-hub/compact-kpi";
import {
  filterByActionChip,
  useOpsActionDrilldown,
  type ActionFilterChip,
  type RevenueBreakdownRow,
  type TestingOfferRow,
  type WorkingCampaignRow,
} from "@/components/operations-hub/ops-action-drilldown-data";
import type { GoalKind, OpsCampaignRow } from "@/components/operations-hub/ops-hub-drilldown-data";
import { parseOperationsMetricParam } from "@/components/operations-hub/operational-metric-dropdown";
import type { Offer, TestingBatch } from "@workspace/api-client-react";
import {
  DollarSign,
  MousePointerClick,
  Percent,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ACTION_CHIPS: { id: ActionFilterChip; label: string }[] = [
  { id: "ready_to_scale", label: "Ready To Scale" },
  { id: "requires_attention", label: "Requires Attention" },
  { id: "no_conversions", label: "No Conversions" },
  { id: "target_reached", label: "Target Reached" },
];

const METRIC_LABEL: Record<GoalKind, string> = {
  revenue: "Revenue",
  testing: "Testing Pipeline",
  working: "Working Campaigns",
};

const HIGHLIGHT_CLASS: Record<string, string> = {
  "Near Threshold": "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
  "Ready To Scale": "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
  "Stuck Testing": "bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-100",
  "No Conversions": "bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-100",
  "Scaling Well": "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
  "Performance Dropping": "bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-100",
  "No Recent Conversions": "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
  "Missing offer count": "bg-slate-100 text-slate-900 dark:bg-slate-900/60 dark:text-slate-100",
  "Behind target": "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
  "Off target": "bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-100",
};

function fmt$(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function parseNetworkParam(search: string): string | null {
  return new URLSearchParams(search).get("network");
}

function ActionChips({
  active,
  onChange,
}: {
  active: ActionFilterChip | null;
  onChange: (chip: ActionFilterChip | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ACTION_CHIPS.map((chip) => {
        const selected = active === chip.id;
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange(selected ? null : chip.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:border-primary/40 hover:bg-muted/50",
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

function HighlightBadges({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {items.map((h) => (
        <Badge key={h} variant="outline" className={cn("text-[10px]", HIGHLIGHT_CLASS[h])}>
          {h}
        </Badge>
      ))}
    </div>
  );
}

function RevenueBreakdownTable({
  title,
  rows,
  nameHeader,
}: {
  title: string;
  rows: RevenueBreakdownRow[];
  nameHeader: string;
}) {
  const sort = useTableSort("visits");
  const sorted = useMemo(() => sortRows(rows, sort.col, sort.dir), [rows, sort.col, sort.dir]);
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No data for this breakdown.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead label={nameHeader} col="label" sort={sort} />
                <SortableTableHead label="Revenue" col="revenue" sort={sort} align="right" />
                <SortableTableHead label="Cost" col="cost" sort={sort} align="right" />
                <SortableTableHead label="Profit" col="profit" sort={sort} align="right" />
                <SortableTableHead label="ROI" col="roi" sort={sort} align="right" />
                <SortableTableHead label="Conv." col="conversions" sort={sort} align="right" />
                <SortableTableHead label="Visits" col="visits" sort={sort} align="right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt$(row.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt$(row.cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt$(row.profit)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(row.roi)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.conversions}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.visits.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function TestingTable({ rows }: { rows: TestingOfferRow[] }) {
  const sort = useTableSort("visits");
  const sorted = useMemo(() => sortRows(rows, sort.col, sort.dir), [rows, sort.col, sort.dir]);
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        No active testing offers for this network.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Offer</TableHead>
            <TableHead>GEO</TableHead>
            <TableHead>Traffic Source</TableHead>
            <SortableTableHead label="Visits" col="visits" sort={sort} align="right" />
            <SortableTableHead label="Conv." col="conversions" sort={sort} align="right" />
            <SortableTableHead label="Revenue" col="revenue" sort={sort} align="right" />
            <SortableTableHead label="Cost" col="cost" sort={sort} align="right" />
            <SortableTableHead label="ROI" col="roi" sort={sort} align="right" />
            <TableHead className="text-right">Days Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium">{row.offer}</div>
                <HighlightBadges items={row.highlights} />
              </TableCell>
              <TableCell>{row.geo}</TableCell>
              <TableCell>{row.trafficSource}</TableCell>
              <TableCell className="text-right tabular-nums">{row.visits.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{row.conversions}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt$(row.revenue)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt$(row.cost)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtPct(row.roi)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.daysActive}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function WorkingTable({ rows }: { rows: WorkingCampaignRow[] }) {
  // No visits column here, so default to Revenue DESC; all numeric columns
  // are still click-sortable.
  const sort = useTableSort("revenue");
  const sorted = useMemo(() => sortRows(rows, sort.col, sort.dir), [rows, sort.col, sort.dir]);
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        No active working campaigns for this network.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Campaign</TableHead>
            <SortableTableHead label="ROI" col="roi" sort={sort} align="right" />
            <SortableTableHead label="Revenue" col="revenue" sort={sort} align="right" />
            <SortableTableHead label="Profit" col="profit" sort={sort} align="right" />
            <SortableTableHead label="Conv." col="conversions" sort={sort} align="right" />
            <TableHead className="text-right">Last Conversion</TableHead>
            <TableHead className="text-right">Days Running</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium">{row.campaign}</div>
                <HighlightBadges items={row.highlights} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtPct(row.roi)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt$(row.revenue)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt$(row.profit)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.conversions}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtDate(row.lastConversion)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.daysRunning}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function OpsActionDrilldown({
  metric,
  network,
  batches,
  campaigns,
  offers,
}: {
  metric: GoalKind;
  network: string;
  batches: TestingBatch[];
  campaigns: OpsCampaignRow[];
  offers: Offer[];
}) {
  const [, navigate] = useLocation();
  const [actionFilter, setActionFilter] = useState<ActionFilterChip | null>(null);
  const data = useOpsActionDrilldown(metric, network, batches, campaigns, offers);

  const filteredTesting = useMemo(
    () => filterByActionChip(data.testing, actionFilter),
    [data.testing, actionFilter],
  );
  const filteredWorking = useMemo(
    () => filterByActionChip(data.working, actionFilter),
    [data.working, actionFilter],
  );
  const filteredByAffiliate = useMemo(
    () => filterByActionChip(data.revenue?.byAffiliate ?? [], actionFilter),
    [data.revenue?.byAffiliate, actionFilter],
  );
  const filteredByGeo = useMemo(
    () => filterByActionChip(data.revenue?.byGeo ?? [], actionFilter),
    [data.revenue?.byGeo, actionFilter],
  );
  const filteredByOffer = useMemo(
    () => filterByActionChip(data.revenue?.byOffer ?? [], actionFilter),
    [data.revenue?.byOffer, actionFilter],
  );

  function clearDrilldown() {
    navigate("/operations");
  }

  const totals = data.revenue?.totals;

  return (
    <section
      className="space-y-5 rounded-2xl border-2 border-primary/20 bg-gradient-to-b from-primary/5 to-background p-4 md:p-5"
      aria-labelledby="ops-action-drilldown"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button type="button" variant="ghost" size="sm" className="-ml-2 h-8 gap-1" onClick={clearDrilldown}>
            <ArrowLeft className="h-4 w-4" />
            Back to hub
          </Button>
          <div className="mt-1 flex items-center gap-2 text-primary">
            <Layers className="h-4 w-4" />
            <h2 id="ops-action-drilldown" className="text-sm font-bold uppercase tracking-widest">
              {METRIC_LABEL[metric]} · {network}
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            MTD {data.dateFrom} → {data.dateTo}
          </p>
        </div>
      </div>

      <ActionChips active={actionFilter} onChange={setActionFilter} />

      {data.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : metric === "revenue" && totals ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <CompactKpi label="Revenue" value={fmt$(totals.revenue)} icon={DollarSign} />
            <CompactKpi label="Cost" value={fmt$(totals.cost)} icon={TrendingUp} />
            <CompactKpi label="Profit" value={fmt$(totals.profit)} icon={Target} tone={totals.profit >= 0 ? "positive" : "critical"} />
            <CompactKpi label="ROI" value={fmtPct(totals.roi)} icon={Percent} />
            <CompactKpi label="Conversions" value={totals.conversions} icon={Users} />
            <CompactKpi label="Visits" value={totals.visits.toLocaleString()} icon={MousePointerClick} />
          </div>
          <RevenueBreakdownTable title="By Affiliate" rows={filteredByAffiliate} nameHeader="Affiliate" />
          <RevenueBreakdownTable title="By GEO" rows={filteredByGeo} nameHeader="GEO" />
          <RevenueBreakdownTable title="By Offer" rows={filteredByOffer} nameHeader="Offer" />
        </div>
      ) : metric === "testing" ? (
        <TestingTable rows={filteredTesting} />
      ) : (
        <WorkingTable rows={filteredWorking} />
      )}
    </section>
  );
}

export function useOpsDrilldownRoute(): { metric: GoalKind; network: string } | null {
  const [location] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  void location;
  const metric = parseOperationsMetricParam(search);
  const network = parseNetworkParam(search);
  if (!metric || !network?.trim()) return null;
  return { metric, network: network.trim() };
}
