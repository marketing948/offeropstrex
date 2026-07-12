/**
 * Live Campaigns — campaign detail drawer.
 */

import { useEffect, useState } from "react";
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
  summaryHealthBadgeClass,
} from "@/components/live-campaigns/live-campaign-health";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SendCampaignToReviewDialog } from "@/components/live-campaigns/send-campaign-to-review-dialog";
import {
  ClipboardCheck,
  Copy,
  ExternalLink,
  FlaskConical,
  Upload,
} from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { authedJson } from "@/lib/api-fetch";
import { useWorkspace } from "@/lib/workspace-context";
import { resolveDisplayRoiPercent, profitFromCostRevenue } from "@/lib/campaign-metrics";

function fmtMoney(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toReviewInput(c: MonitoringCampaign): ReviewCampaignInput {
  const cost = Number(c.cost ?? 0);
  const revenue = Number(c.revenue ?? 0);
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
    revenue,
    cost,
    roi: resolveDisplayRoiPercent(cost, revenue, c.roi) ?? 0,
    voluumCampaignId: c.voluumCampaignId,
  };
}

function MetricTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cn("mt-1 text-sm font-bold tabular-nums", tone ?? "text-slate-900")}>{value}</p>
    </div>
  );
}

export function LiveCampaignDrawer({
  campaign,
  rangeMetrics,
  performanceRangeLabel,
  offerCount,
  rules,
  open,
  onClose,
  onImportCsv,
  onCloseCampaign,
  onCampaignUpdated,
  isReviewedToday = false,
  onMarkedReviewed,
}: {
  campaign: MonitoringCampaign | null;
  rangeMetrics: DailyMetricRow | undefined;
  performanceRangeLabel: string;
  offerCount: number;
  rules: AlertRulesConfig;
  open: boolean;
  onClose: () => void;
  onImportCsv: () => void;
  onCloseCampaign: (c: { id: number; name: string }) => void;
  onCampaignUpdated?: () => void;
  isReviewedToday?: boolean;
  onMarkedReviewed?: () => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [markingReviewed, setMarkingReviewed] = useState(false);
  const [offerCountDraft, setOfferCountDraft] = useState(offerCount > 0 ? String(offerCount) : "");
  const [savingOfferCount, setSavingOfferCount] = useState(false);

  useEffect(() => {
    setOfferCountDraft(offerCount > 0 ? String(offerCount) : "");
  }, [campaign?.id, offerCount]);

  if (!campaign) return null;

  const reviewInput = toReviewInput(campaign);
  const monitoring = evaluateCampaignMonitoringHealth(reviewInput, offerCount, rules);
  const range =
    rangeMetrics != null
      ? {
          visits: rangeMetrics.visits,
          conversions: rangeMetrics.conversions,
          cost: Number(rangeMetrics.cost),
          revenue: Number(rangeMetrics.revenue),
          profit: profitFromCostRevenue(rangeMetrics.cost, rangeMetrics.revenue),
          roi: resolveDisplayRoiPercent(
            rangeMetrics.cost,
            rangeMetrics.revenue,
            rangeMetrics.roi,
          ),
        }
      : null;
  const health = deriveSummaryHealth(range, reviewInput, offerCount, rules);
  const pacing = deriveTrafficPacing(Number(campaign.clicks ?? 0), monitoring.targetPct, offerCount);
  const lifetimeRoi = resolveDisplayRoiPercent(
    campaign.cost,
    campaign.revenue,
    campaign.roi,
  );
  const visitsPerOffer = offerCount > 0 ? Number(campaign.clicks ?? 0) / offerCount : null;
  const rangeProfit = range?.profit ?? null;
  const lifetimeProfit = profitFromCostRevenue(campaign.cost, campaign.revenue);
  const scaling = isScalingOpportunity({
    campaignPurpose: campaign.campaignPurpose,
    status: campaign.status,
    profit: rangeProfit ?? lifetimeProfit,
    roi: range?.roi ?? lifetimeRoi,
    liveStartedAt: campaign.liveStartedAt,
  });

  async function saveOfferCount() {
    const target = campaign;
    if (!target) return;
    const parsed = Number(offerCountDraft);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      toast({
        title: "Offer count must be a positive integer",
        variant: "destructive",
      });
      return;
    }
    try {
      setSavingOfferCount(true);
      await authedJson(`/api/campaigns/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({ offerCount: parsed }),
      });
      toast({ title: "Offer count updated" });
      onCampaignUpdated?.();
    } catch (e: unknown) {
      toast({
        title: "Could not update offer count",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSavingOfferCount(false);
    }
  }

  async function copyVoluumId() {
    if (!campaign?.voluumCampaignId) return;
    try {
      await navigator.clipboard.writeText(campaign.voluumCampaignId);
      toast({ title: "Voluum ID copied" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  }

  async function markCampaignReviewed() {
    if (!campaign || !activeWorkspaceId) return;
    setMarkingReviewed(true);
    try {
      await authedJson(`/api/campaigns/${campaign.id}/mark-reviewed`, {
        method: "POST",
        body: JSON.stringify({ workspaceId: activeWorkspaceId }),
      });
      toast({ title: "Campaign marked as reviewed" });
      onMarkedReviewed?.();
      onCampaignUpdated?.();
    } catch (e: unknown) {
      toast({
        title: "Could not mark reviewed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setMarkingReviewed(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="line-clamp-2 pr-8 text-left text-lg leading-snug" title={campaign.campaignName}>
            {campaign.campaignName}
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-left">
              <Badge
                variant="outline"
                className={cn("text-[10px] font-semibold", campaignTypeBadgeClass(campaign.campaignPurpose))}
              >
                {campaignTypeLabel(campaign.campaignPurpose)}
              </Badge>
              <Badge
                variant="outline"
                className={cn("uppercase text-[10px] font-semibold", platformBadgeClass(campaign.platform))}
              >
                {campaign.platform}
              </Badge>
              <Badge variant="outline" className="text-[10px] capitalize">
                {campaign.status.replace(/_/g, " ")}
              </Badge>
              {isReviewedToday && (
                <Badge className="border-emerald-300 bg-emerald-100 text-[10px] font-bold text-emerald-800">
                  Reviewed today
                </Badge>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Type</span>
            <span className="font-medium text-slate-800">{campaignTypeLabel(campaign.campaignPurpose)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Network</span>
            <span className="font-medium text-slate-800">{campaign.batchAffiliateNetwork ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">GEO</span>
            <span className="font-medium uppercase text-slate-800">{campaign.batchGeo ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">Source</span>
            <span className="font-medium text-slate-800">{campaign.trafficSourceName ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">OS</span>
            <span className="font-medium uppercase text-slate-800">{campaign.platform}</span>
          </div>
        </div>

        <section className="mt-6 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Selected Range Performance · {performanceRangeLabel}
          </h3>
          {range ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <MetricTile label="Visits" value={range.visits.toLocaleString()} />
              <MetricTile label="Offer Count" value={offerCount > 0 ? String(offerCount) : "Missing offer count"} />
              <MetricTile
                label="Visits / Offer"
                value={visitsPerOffer != null ? Math.ceil(visitsPerOffer).toLocaleString() : "—"}
              />
              <MetricTile label="Cost" value={fmtMoney(range.cost)} />
              <MetricTile label="Revenue" value={fmtMoney(range.revenue)} />
              <MetricTile
                label="Profit"
                value={fmtMoney(range.profit)}
                tone={metricToneClass(metricTone(range.profit, "money"))}
              />
              <MetricTile
                label="ROI"
                value={fmtPct(range.roi)}
                tone={metricToneClass(metricTone(range.roi, "roi"))}
              />
              <MetricTile label="Conv" value={range.conversions.toLocaleString()} />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
              No data for this range. Import Voluum CSV metrics.
            </p>
          )}
          <p className="text-xs text-slate-500">
            Lifetime visits pacing: {pacing.label} ({monitoring.targetPct}% of target)
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Lifetime</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetricTile label="Cost" value={fmtMoney(campaign.cost)} />
            <MetricTile label="Revenue" value={fmtMoney(campaign.revenue)} />
            <MetricTile
              label="ROI"
              value={fmtPct(lifetimeRoi)}
              tone={metricToneClass(metricTone(lifetimeRoi, "roi"))}
            />
            <MetricTile label="Conv" value={(campaign.conversions ?? 0).toLocaleString()} />
            <MetricTile label="Winners" value={String(campaign.winnersCount ?? "—")} />
          </div>
        </section>

        <section className="mt-6 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Campaign Context</h3>
          <dl className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm">
            {campaign.batchName && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Batch</dt>
                <dd className="text-right font-medium text-slate-800">{campaign.batchName}</dd>
              </div>
            )}
            {campaign.employeeName && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Worker</dt>
                <dd className="text-right font-medium text-slate-800">{campaign.employeeName}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Went live</dt>
              <dd className="text-right font-medium text-slate-800">{fmtDate(campaign.liveStartedAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Campaign ID</dt>
              <dd className="font-mono text-xs text-slate-800">{campaign.id}</dd>
            </div>
            {campaign.voluumCampaignId && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Voluum ID</dt>
                <dd className="max-w-[200px] truncate font-mono text-xs text-slate-800">
                  {campaign.voluumCampaignId}
                </dd>
              </div>
            )}
          </dl>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Edit Offer Count</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                className="h-9 w-28 rounded-md border border-slate-200 px-2 text-sm"
                value={offerCountDraft}
                onChange={(e) => setOfferCountDraft(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="e.g. 2"
              />
              <Button size="sm" onClick={() => void saveOfferCount()} disabled={savingOfferCount}>
                {savingOfferCount ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-6 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {campaign.campaignPurpose === "working"
              ? "Scaling Opportunities"
              : campaign.campaignPurpose === "testing"
                ? "Winner Candidates"
                : "Action Required"}
          </h3>
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3">
            {campaign.campaignPurpose === "working" ? (
              scaling ? (
                <>
                  <Badge
                    variant="outline"
                    className="border-emerald-300 bg-emerald-50 text-[11px] font-semibold text-emerald-800"
                  >
                    Scaling Opportunity
                  </Badge>
                  <p className="mt-2 text-sm text-slate-600">
                    Profit and ROI are positive with at least 2 days live. Review whether to scale spend.
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-600">
                  This campaign is already working. It is not a scaling opportunity yet (needs profit &gt; 0,
                  ROI &gt; 0, and ≥2 days live).
                </p>
              )
            ) : (
              <>
                <Badge
                  variant="outline"
                  className={cn("text-[11px] font-semibold", summaryHealthBadgeClass(health.status))}
                >
                  {health.label}
                </Badge>
                <p className="mt-2 text-sm text-slate-600">{health.reason}</p>
              </>
            )}
          </div>
        </section>

        <section className="mt-6 space-y-2 border-t border-slate-200 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Actions</h3>
          <div className="flex flex-col gap-2">
            <Button
              variant={isReviewedToday ? "secondary" : "default"}
              className="justify-start"
              disabled={markingReviewed || isReviewedToday}
              onClick={() => void markCampaignReviewed()}
            >
              <ClipboardCheck className="mr-2 h-4 w-4" />
              {isReviewedToday ? "Campaign reviewed" : "Mark campaign reviewed"}
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => setReviewOpen(true)}
            >
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Send Campaign to review
            </Button>
            {campaign.batchId != null && (
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => {
                  navigate(`/testing-batches/${campaign.batchId}`);
                  onClose();
                }}
              >
                <FlaskConical className="mr-2 h-4 w-4" />
                Open Batch
              </Button>
            )}
            <Button variant="outline" className="justify-start" onClick={onImportCsv}>
              <Upload className="mr-2 h-4 w-4" />
              Import Voluum CSV
            </Button>
            {campaign.voluumCampaignId && (
              <Button variant="outline" className="justify-start" onClick={() => void copyVoluumId()}>
                <Copy className="mr-2 h-4 w-4" />
                Copy Voluum ID
              </Button>
            )}
            {campaign.status !== "closed" && (
              <Button
                variant="outline"
                className="justify-start text-red-700 hover:text-red-800"
                onClick={() => {
                  onCloseCampaign({ id: campaign.id, name: campaign.campaignName });
                  onClose();
                }}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Close campaign
              </Button>
            )}
          </div>
        </section>

        <SendCampaignToReviewDialog
          open={reviewOpen}
          campaignId={campaign.id}
          campaignName={campaign.campaignName}
          onOpenChange={setReviewOpen}
        />
      </SheetContent>
    </Sheet>
  );
}
