import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AlertRulesConfig } from "@workspace/alert-rules";
import { DEFAULT_ALERT_RULES } from "@workspace/alert-rules";
import { useAlertRules, alertRulesQueryKey } from "@/hooks/use-alert-rules";
import { authedJson } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { operationalErrorMessage } from "@/lib/operational-feedback";
import {
  useWorkspaceSettingsScope,
  workspaceSettingsTabGate,
} from "@/lib/workspace-settings-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { OperationalError } from "@/components/operational-state/operational-error";
import { RefreshingHint } from "@/components/operational-state/refreshing-hint";
import { Bell } from "lucide-react";

function NumberField({
  label,
  hint,
  value,
  onChange,
  disabled,
  step,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  step?: number;
}) {
  const safe = Number.isFinite(value) ? value : 0;
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      <Input
        type="number"
        step={step}
        className="h-8 text-sm"
        value={safe}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
    </div>
  );
}

function RuleSection({
  title,
  description,
  children,
  disabled,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className={disabled ? "pointer-events-none opacity-60" : undefined}>
        {children}
      </CardContent>
    </Card>
  );
}

export function AlertRulesSettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scope = useWorkspaceSettingsScope();
  const { wsId, workspaceLabel, workspaceReady } = scope;

  const {
    rules: loaded,
    isLoading: isRulesLoading,
    isFetching,
    isError,
    error,
    isFetched,
    refetch,
  } = useAlertRules({ fallbackOnError: false });

  const [draft, setDraft] = useState<AlertRulesConfig>(DEFAULT_ALERT_RULES);

  useEffect(() => {
    if (isFetched) {
      setDraft(loaded);
    }
  }, [loaded, isFetched]);

  const saveMutation = useMutation({
    mutationFn: () =>
      authedJson<AlertRulesConfig>("/api/settings/alert-rules", {
        method: "PATCH",
        body: JSON.stringify({ workspaceId: wsId, ...draft }),
      }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: alertRulesQueryKey(wsId) });
      setDraft(saved);
      toast({ title: "Alert rules saved" });
    },
    onError: (e) =>
      toast({
        title: "Save failed",
        description: operationalErrorMessage(e, "Could not save alert rules."),
        variant: "destructive",
      }),
  });

  const rulesSyncing = workspaceReady && isRulesLoading && !isFetched;
  const formDisabled = rulesSyncing || isError;

  const gate = workspaceSettingsTabGate(scope);
  if (gate.blocked) return gate.element;

  if (isError) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4" />
              Alert rules
            </CardTitle>
            <CardDescription>
              Configuration for {workspaceLabel}. Rules apply to this workspace.
            </CardDescription>
          </CardHeader>
        </Card>
        <OperationalError
          title="Couldn't load alert rules"
          error={error}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      </div>
    );
  }

  const milestonesStr = draft.testing.trafficMilestonePercents.join(", ");
  const usingDefaults = isFetched && JSON.stringify(loaded) === JSON.stringify(DEFAULT_ALERT_RULES);

  return (
    <div className="max-w-3xl space-y-4 pb-8">
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4 text-primary" />
                Alert rules
              </CardTitle>
              <CardDescription className="mt-1">
                Rules apply to {workspaceLabel} for Campaign Review, Executive Overview, and Live
                Campaign health.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                {workspaceLabel}
              </Badge>
              {usingDefaults ? (
                <Badge variant="secondary" className="text-[10px]">
                  Platform defaults
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  Saved config
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <RefreshingHint visible={isFetching && isFetched} className="mb-2" />
          <p className="text-xs text-muted-foreground">
            {rulesSyncing
              ? "Loading workspace alert rules… editable defaults are shown below."
              : "No saved config yet? Platform defaults are shown below — edit and save when ready."}
          </p>
        </CardContent>
      </Card>

      <RuleSection
        title="Testing rules"
        description="Traffic milestones, pacing, and burn-risk heuristics for testing campaigns."
        disabled={formDisabled}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Visits target per offer"
            value={draft.testing.visitsPerOffer}
            onChange={(n) =>
              setDraft({ ...draft, testing: { ...draft.testing, visitsPerOffer: n } })
            }
            disabled={formDisabled}
          />
          <div className="space-y-1">
            <Label className="text-xs">Traffic milestones (%)</Label>
            <Input
              className="h-8 text-sm"
              value={milestonesStr}
              disabled={formDisabled}
              onChange={(e) => {
                const parts = e.target.value
                  .split(",")
                  .map((s) => Number(s.trim()))
                  .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
                if (parts.length) {
                  setDraft({
                    ...draft,
                    testing: { ...draft.testing, trafficMilestonePercents: parts },
                  });
                }
              }}
              placeholder="50, 75, 100"
            />
          </div>
          <NumberField
            label="Pacing risk after (days live)"
            value={draft.testing.pacingRiskMinDaysLive}
            onChange={(n) =>
              setDraft({ ...draft, testing: { ...draft.testing, pacingRiskMinDaysLive: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Max traffic % for pacing risk"
            value={draft.testing.pacingRiskMaxTrafficPercent}
            onChange={(n) =>
              setDraft({
                ...draft,
                testing: { ...draft.testing, pacingRiskMaxTrafficPercent: n },
              })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Traffic spike % increase"
            value={draft.testing.trafficSpikePercentIncrease}
            onChange={(n) =>
              setDraft({ ...draft, testing: { ...draft.testing, trafficSpikePercentIncrease: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Traffic decrease % decrease"
            value={draft.testing.trafficDecreasePercentDecrease}
            onChange={(n) =>
              setDraft({
                ...draft,
                testing: { ...draft.testing, trafficDecreasePercentDecrease: n },
              })
            }
            disabled={formDisabled}
          />
        </div>
        <div className="mt-3 flex items-center justify-between rounded-md border px-3 py-2">
          <div>
            <p className="text-sm font-medium">Zero conversion at milestone</p>
            <p className="text-[10px] text-muted-foreground">
              Alert when milestones hit with no conversions
            </p>
          </div>
          <Switch
            checked={draft.testing.zeroConversionAtMilestoneEnabled}
            disabled={formDisabled}
            onCheckedChange={(v) =>
              setDraft({
                ...draft,
                testing: { ...draft.testing, zeroConversionAtMilestoneEnabled: v },
              })
            }
          />
        </div>
      </RuleSection>

      <RuleSection
        title="Winner rules"
        description="Winner detection and batch follow-up signals."
        disabled={formDisabled}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Min conversions (potential winner)"
            value={draft.winners.minConversionsForPotentialWinner}
            onChange={(n) =>
              setDraft({ ...draft, winners: { ...draft.winners, minConversionsForPotentialWinner: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Min ROI % (likely winner)"
            value={draft.winners.minRoiPercentForLikelyWinner}
            onChange={(n) =>
              setDraft({ ...draft, winners: { ...draft.winners, minRoiPercentForLikelyWinner: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="ROI-positive days before scale alert"
            value={draft.winners.roiPositiveDaysBeforeScaleAlert}
            onChange={(n) =>
              setDraft({
                ...draft,
                winners: { ...draft.winners, roiPositiveDaysBeforeScaleAlert: n },
              })
            }
            disabled={formDisabled}
          />
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <p className="text-sm font-medium">Batch finished with winners — no scale action</p>
            <Switch
              checked={draft.winners.batchFinishedWinnersNoActionEnabled}
              disabled={formDisabled}
              onCheckedChange={(v) =>
                setDraft({
                  ...draft,
                  winners: { ...draft.winners, batchFinishedWinnersNoActionEnabled: v },
                })
              }
            />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <p className="text-sm font-medium">Manual winner marked — no scale lifecycle</p>
            <Switch
              checked={draft.winners.manualWinnerNoScaleEnabled}
              disabled={formDisabled}
              onCheckedChange={(v) =>
                setDraft({
                  ...draft,
                  winners: { ...draft.winners, manualWinnerNoScaleEnabled: v },
                })
              }
            />
          </div>
        </div>
      </RuleSection>

      <RuleSection
        title="Scale rules"
        description="Scale campaign health thresholds after go-live."
        disabled={formDisabled}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="No conversions after (hours)"
            value={draft.scaling.noConversionsAfterHours}
            onChange={(n) =>
              setDraft({ ...draft, scaling: { ...draft.scaling, noConversionsAfterHours: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Negative ROI after (days)"
            value={draft.scaling.negativeRoiDays}
            onChange={(n) =>
              setDraft({ ...draft, scaling: { ...draft.scaling, negativeRoiDays: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Min ROI % (positive signal)"
            value={draft.scaling.minRoiPercentForPositiveSignal}
            onChange={(n) =>
              setDraft({
                ...draft,
                scaling: { ...draft.scaling, minRoiPercentForPositiveSignal: n },
              })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Min revenue (strong signal)"
            value={draft.scaling.minRevenueForStrongSignal}
            onChange={(n) =>
              setDraft({
                ...draft,
                scaling: { ...draft.scaling, minRevenueForStrongSignal: n },
              })
            }
            disabled={formDisabled}
          />
        </div>
      </RuleSection>

      <RuleSection
        title="Scale Today suggestions"
        description="Thresholds for the Operations Hub “Campaigns We Should Scale Today” group."
        disabled={formDisabled}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Min live days for scale"
            value={draft.scaling.minLiveDaysForScale}
            onChange={(n) =>
              setDraft({ ...draft, scaling: { ...draft.scaling, minLiveDaysForScale: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Min profit for scale"
            value={draft.scaling.minProfitForScale}
            onChange={(n) =>
              setDraft({ ...draft, scaling: { ...draft.scaling, minProfitForScale: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Min ROI % for scale"
            value={draft.scaling.minRoiPercentForScale}
            onChange={(n) =>
              setDraft({ ...draft, scaling: { ...draft.scaling, minRoiPercentForScale: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Min revenue for scale"
            value={draft.scaling.minRevenueForScale}
            onChange={(n) =>
              setDraft({ ...draft, scaling: { ...draft.scaling, minRevenueForScale: n } })
            }
            disabled={formDisabled}
          />
        </div>
      </RuleSection>

      <RuleSection
        title="Optimize Today suggestions"
        description="Thresholds for the Operations Hub “Campaigns We Should Optimize Today” group."
        disabled={formDisabled}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Off-target VPO ratio (below = off target)"
            value={draft.optimization.offTargetRatio}
            step={0.05}
            onChange={(n) =>
              setDraft({ ...draft, optimization: { ...draft.optimization, offTargetRatio: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Behind-target VPO ratio (below = behind)"
            value={draft.optimization.behindTargetRatio}
            step={0.05}
            onChange={(n) =>
              setDraft({ ...draft, optimization: { ...draft.optimization, behindTargetRatio: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Min live days before optimize review"
            value={draft.optimization.minLiveDaysForReview}
            onChange={(n) =>
              setDraft({
                ...draft,
                optimization: { ...draft.optimization, minLiveDaysForReview: n },
              })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Weak ROI % (below = optimize candidate)"
            value={draft.optimization.weakRoiPercent}
            onChange={(n) =>
              setDraft({ ...draft, optimization: { ...draft.optimization, weakRoiPercent: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Min days live (ROI review)"
            value={draft.optimization.minDaysLive}
            onChange={(n) =>
              setDraft({ ...draft, optimization: { ...draft.optimization, minDaysLive: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="ROI floor % (below = optimize)"
            value={draft.optimization.roiMinThreshold}
            onChange={(n) =>
              setDraft({ ...draft, optimization: { ...draft.optimization, roiMinThreshold: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="ROI drop threshold (pts)"
            hint="Percentage-point ROI decline that flags a campaign"
            value={draft.optimization.roiDropThreshold}
            onChange={(n) =>
              setDraft({ ...draft, optimization: { ...draft.optimization, roiDropThreshold: n } })
            }
            disabled={formDisabled}
          />
        </div>
      </RuleSection>

      <RuleSection
        title="Traffic rules"
        description="Volume / anomaly thresholds used by alerts and Optimize suggestions."
        disabled={formDisabled}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Spike increase %"
            value={draft.traffic.spikeIncreasePct}
            onChange={(n) =>
              setDraft({ ...draft, traffic: { ...draft.traffic, spikeIncreasePct: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Spike decrease %"
            value={draft.traffic.spikeDecreasePct}
            onChange={(n) =>
              setDraft({ ...draft, traffic: { ...draft.traffic, spikeDecreasePct: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Max expected visits per offer"
            value={draft.traffic.maxExpectedVisitsPerOffer}
            onChange={(n) =>
              setDraft({ ...draft, traffic: { ...draft.traffic, maxExpectedVisitsPerOffer: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Min expected visits per offer"
            value={draft.traffic.minExpectedVisitsPerOffer}
            onChange={(n) =>
              setDraft({ ...draft, traffic: { ...draft.traffic, minExpectedVisitsPerOffer: n } })
            }
            disabled={formDisabled}
          />
        </div>
      </RuleSection>

      <RuleSection
        title="Winning rule (Scale Today)"
        description="Campaigns passing all three are flagged WINNER and surfaced in Scale Today."
        disabled={formDisabled}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Min conversions"
            value={draft.winning.minConversions}
            onChange={(n) => setDraft({ ...draft, winning: { ...draft.winning, minConversions: n } })}
            disabled={formDisabled}
          />
          <NumberField
            label="Min revenue"
            value={draft.winning.minRevenue}
            onChange={(n) => setDraft({ ...draft, winning: { ...draft.winning, minRevenue: n } })}
            disabled={formDisabled}
          />
          <NumberField
            label="Min ROI %"
            value={draft.winning.minROI}
            onChange={(n) => setDraft({ ...draft, winning: { ...draft.winning, minROI: n } })}
            disabled={formDisabled}
          />
        </div>
      </RuleSection>

      <RuleSection
        title="Shutdown rule (Stop Today)"
        description="Long-running, low-performance campaigns are surfaced in “Campaigns We Should STOP”."
        disabled={formDisabled}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Min days live"
            value={draft.shutdown.minDaysLive}
            onChange={(n) => setDraft({ ...draft, shutdown: { ...draft.shutdown, minDaysLive: n } })}
            disabled={formDisabled}
          />
          <NumberField
            label="Max conversions (low)"
            value={draft.shutdown.maxConversions}
            onChange={(n) =>
              setDraft({ ...draft, shutdown: { ...draft.shutdown, maxConversions: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Max revenue (low)"
            value={draft.shutdown.maxRevenue}
            onChange={(n) => setDraft({ ...draft, shutdown: { ...draft.shutdown, maxRevenue: n } })}
            disabled={formDisabled}
          />
        </div>
      </RuleSection>

      <RuleSection
        title="Review escalation"
        description="Campaign Review queue timing and dismissal behavior."
        disabled={formDisabled}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Ignored signal escalation (hours)"
            value={draft.review.ignoredSignalEscalationHours}
            onChange={(n) =>
              setDraft({ ...draft, review: { ...draft.review, ignoredSignalEscalationHours: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Dismissal snooze (hours)"
            value={draft.review.dismissalSnoozeHours}
            onChange={(n) =>
              setDraft({ ...draft, review: { ...draft.review, dismissalSnoozeHours: n } })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Stale campaign (days)"
            value={draft.review.staleCampaignDays}
            onChange={(n) =>
              setDraft({ ...draft, review: { ...draft.review, staleCampaignDays: n } })
            }
            disabled={formDisabled}
          />
        </div>
      </RuleSection>

      <RuleSection
        title="Operational scoring"
        description="Reliability and execution quality weights from review memory (client-side)."
        disabled={formDisabled}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Base score"
            value={draft.operationalScoring.baseScore}
            onChange={(n) =>
              setDraft({
                ...draft,
                operationalScoring: { ...draft.operationalScoring, baseScore: n },
              })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Positive review points"
            value={draft.operationalScoring.positiveReviewPoints}
            onChange={(n) =>
              setDraft({
                ...draft,
                operationalScoring: { ...draft.operationalScoring, positiveReviewPoints: n },
              })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Ignored signal penalty"
            value={draft.operationalScoring.ignoredSignalPenalty}
            onChange={(n) =>
              setDraft({
                ...draft,
                operationalScoring: { ...draft.operationalScoring, ignoredSignalPenalty: n },
              })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Escalation penalty"
            value={draft.operationalScoring.escalationPenalty}
            onChange={(n) =>
              setDraft({
                ...draft,
                operationalScoring: { ...draft.operationalScoring, escalationPenalty: n },
              })
            }
            disabled={formDisabled}
          />
          <NumberField
            label="Dismiss penalty"
            value={draft.operationalScoring.dismissPenalty}
            onChange={(n) =>
              setDraft({
                ...draft,
                operationalScoring: { ...draft.operationalScoring, dismissPenalty: n },
              })
            }
            disabled={formDisabled}
          />
        </div>
      </RuleSection>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={formDisabled || saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving…" : "Save alert rules"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={formDisabled}
          onClick={() => setDraft(loaded)}
        >
          Reset to loaded values
        </Button>
      </div>
    </div>
  );
}
