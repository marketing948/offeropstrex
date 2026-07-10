import { useLocation } from "wouter";
import type { AlertRulesConfig } from "@workspace/alert-rules";
import {
  evaluateCampaignMonitoringHealth,
  type ReviewCampaignInput,
} from "@/lib/campaign-review/heuristics";
import type { CampaignHealthStatus } from "@/lib/campaign-review/types";
import { CampaignHealthBadge } from "@/components/campaign-review/health-badge";
import { resolveCampaignOfferCount } from "@/components/live-campaigns/live-campaign-health";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Copy, ExternalLink, MoreHorizontal, ClipboardCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type MonitoringCampaign = {
  id: number;
  campaignName: string;
  campaignPurpose: "testing" | "working" | "scaling";
  platform: "ios" | "android";
  status: string;
  batchId: number | null;
  batchName: string | null;
  batchGeo: string | null;
  batchAffiliateNetwork: string | null;
  trafficSourceName: string | null;
  voluumCampaignId: string | null;
  liveStartedAt: string | null;
  winnersCount: number | null;
  revenue: string | null;
  cost: string | null;
  clicks: number | null;
  conversions: number | null;
  roi: string | null;
  employeeName: string | null;
  offerCount?: number | null;
};

export type DailyMetricRow = {
  cost: string;
  revenue: string;
  conversions: number;
  visits: number;
  profit: string;
  roi: string | null;
  epc: string | null;
};

function fmtMoney(v: string | number | null): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPctRaw(v: string | null): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function daysLive(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

const PURPOSE_LABELS = { testing: "Testing", working: "Working", scaling: "Scaling" };

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

function GroupHead({
  children,
  className,
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <TableHead
      colSpan={colSpan}
      className={cn(
        "h-8 border-b border-border/80 bg-muted/40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {children}
    </TableHead>
  );
}

export function LiveCampaignsMonitoringTable({
  campaigns,
  metricsByCampaignId,
  offersPerBatch,
  metricsDateLabel,
  rules,
  isLoading,
  isError,
  loadErrorMessage,
  error,
  onRetry,
  retrying,
  onCloseCampaign,
}: {
  campaigns: MonitoringCampaign[];
  metricsByCampaignId: Map<number, DailyMetricRow>;
  offersPerBatch: Map<number, number>;
  metricsDateLabel: string;
  rules: AlertRulesConfig;
  isLoading: boolean;
  isError: boolean;
  loadErrorMessage: string;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  onCloseCampaign: (c: { id: number; name: string }) => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <GroupHead className="sticky left-0 z-20 min-w-[220px] bg-muted/40 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                Campaign
              </GroupHead>
              <GroupHead className="min-w-[88px]">Purpose</GroupHead>
              <GroupHead className="min-w-[64px]">Platform</GroupHead>
              <GroupHead className="min-w-[100px]">Source</GroupHead>
              <GroupHead className="min-w-[88px]">Network / GEO</GroupHead>
              <GroupHead className="min-w-[72px]">Status</GroupHead>
              <GroupHead colSpan={3} className="text-center border-l border-border/60">
                Traffic (lifetime)
              </GroupHead>
              <GroupHead colSpan={5} className="text-center border-l border-border/60">
                Performance · {metricsDateLabel}
              </GroupHead>
              <GroupHead colSpan={4} className="text-center border-l border-border/60">
                Lifetime
              </GroupHead>
              <GroupHead colSpan={3} className="text-center border-l border-border/60">
                Lifecycle
              </GroupHead>
              <GroupHead className="w-10 border-l border-border/60"> </GroupHead>
            </TableRow>
            <TableRow className="hover:bg-transparent text-[10px]">
              <TableHead className="sticky left-0 z-20 bg-card shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]" />
              <TableHead />
              <TableHead />
              <TableHead />
              <TableHead />
              <TableHead />
              <TableHead className="text-right border-l border-border/50">Visits</TableHead>
              <TableHead className="text-right">Target %</TableHead>
              <TableHead className="text-right">Pacing</TableHead>
              <TableHead className="text-right border-l border-border/50">Cost</TableHead>
              <TableHead className="text-right">Rev</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">ROI</TableHead>
              <TableHead className="text-right">Conv</TableHead>
              <TableHead className="text-right border-l border-border/50">Cost</TableHead>
              <TableHead className="text-right">Rev</TableHead>
              <TableHead className="text-right">ROI</TableHead>
              <TableHead className="text-right">Win</TableHead>
              <TableHead className="border-l border-border/50">Live</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Health</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRowsSkeleton rows={6} cols={20} />
            ) : isError ? (
              <TableSectionState
                colSpan={20}
                variant="error"
                title="Couldn't load live campaigns"
                description={loadErrorMessage}
                error={error}
                onRetry={onRetry}
                retrying={retrying}
              />
            ) : campaigns.length === 0 ? (
              <TableSectionState
                colSpan={20}
                variant="empty"
                title="No campaigns match these filters"
                description="Adjust filters or import Voluum metrics for the selected date."
              />
            ) : (
              campaigns.map((c) => {
                const daily = metricsByCampaignId.get(c.id);
                const offerCount = resolveCampaignOfferCount(c, { offersPerBatch });
                const health = evaluateCampaignMonitoringHealth(
                  toReviewInput(c),
                  offerCount,
                  rules,
                );
                const age = daysLive(c.liveStartedAt);
                const pacing =
                  health.targetPct >= 100
                    ? "At target"
                    : health.targetPct >= 75
                      ? "High"
                      : health.targetPct >= 50
                        ? "Mid"
                        : "Low";

                return (
                  <TableRow key={c.id} className="group align-middle hover:bg-muted/30">
                    <TableCell className="sticky left-0 z-10 max-w-[260px] bg-card py-2 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)] group-hover:bg-muted/30">
                      <p className="truncate text-sm font-semibold leading-tight" title={c.campaignName}>
                        {c.campaignName}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {c.batchName && <span>{c.batchName}</span>}
                        {c.batchGeo && <span> · {c.batchGeo}</span>}
                      </p>
                      {c.voluumCampaignId && (
                        <p className="truncate font-mono text-[9px] text-muted-foreground/90">
                          {c.voluumCampaignId}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant="secondary" className="text-[9px]">
                        {PURPOSE_LABELS[c.campaignPurpose]}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className="uppercase text-[9px]">
                        {c.platform}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[100px] truncate py-2 text-xs">
                      {c.trafficSourceName ?? "—"}
                    </TableCell>
                    <TableCell className="py-2 text-[10px] leading-snug">
                      <div className="truncate">{c.batchAffiliateNetwork ?? "—"}</div>
                      <div className="text-muted-foreground">{c.batchGeo ?? "—"}</div>
                    </TableCell>
                    <TableCell className="py-2 text-[10px] capitalize">{c.status.replace(/_/g, " ")}</TableCell>
                    <TableCell className="border-l border-border/40 py-2 text-right tabular-nums text-xs">
                      {(c.clicks ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-xs">{health.targetPct}%</TableCell>
                    <TableCell className="py-2 text-right text-[10px] text-muted-foreground">{pacing}</TableCell>
                    <TableCell className="border-l border-border/40 py-2 text-right tabular-nums text-xs">
                      {daily ? fmtMoney(daily.cost) : "—"}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-xs">
                      {daily ? fmtMoney(daily.revenue) : "—"}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-xs">
                      {daily ? fmtMoney(daily.profit) : "—"}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-xs">
                      {daily ? fmtPctRaw(daily.roi) : "—"}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-xs">
                      {daily ? daily.conversions : "—"}
                    </TableCell>
                    <TableCell className="border-l border-border/40 py-2 text-right tabular-nums text-xs">
                      {fmtMoney(c.cost)}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-xs">{fmtMoney(c.revenue)}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-xs">{fmtPctRaw(c.roi)}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-xs">{c.winnersCount ?? "—"}</TableCell>
                    <TableCell className="border-l border-border/40 py-2 text-xs whitespace-nowrap">
                      {fmtDate(c.liveStartedAt)}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{age ? `${age}d` : "—"}</TableCell>
                    <TableCell className="py-2">
                      <CampaignHealthBadge
                        status={health.health as CampaignHealthStatus}
                        label={health.healthLabel}
                      />
                    </TableCell>
                    <TableCell className="py-2 pr-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => navigate(`/campaign-review`)}>
                            <ClipboardCheck className="mr-2 h-3.5 w-3.5" />
                            Review campaign
                          </DropdownMenuItem>
                          {c.batchId != null && (
                            <DropdownMenuItem onClick={() => navigate(`/testing-batches/${c.batchId}`)}>
                              <ExternalLink className="mr-2 h-3.5 w-3.5" />
                              Open batch
                            </DropdownMenuItem>
                          )}
                          {c.voluumCampaignId && (
                            <DropdownMenuItem
                              onClick={() => void copyText("Voluum ID", c.voluumCampaignId!)}
                            >
                              <Copy className="mr-2 h-3.5 w-3.5" />
                              Copy Voluum ID
                            </DropdownMenuItem>
                          )}
                          {c.status !== "closed" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onCloseCampaign({ id: c.id, name: c.campaignName })}>
                                Close campaign
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <p className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
        Daily columns reflect imported metrics for <strong>{metricsDateLabel}</strong>. Lifetime columns use campaign totals from the database. Health uses workspace alert rules.
      </p>
    </div>
  );
}
