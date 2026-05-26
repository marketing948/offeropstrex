import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AlertRulesConfig } from "@workspace/alert-rules";
import { DEFAULT_ALERT_RULES } from "@workspace/alert-rules";
import { useAlertRules, alertRulesQueryKey } from "@/hooks/use-alert-rules";
import { authedJson } from "@/lib/api-fetch";
import { useWorkspace } from "@/lib/workspace-context";
import { useToast } from "@/hooks/use-toast";
import { operationalErrorMessage } from "@/lib/operational-feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell } from "lucide-react";

function NumberField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      <Input
        type="number"
        className="h-8 text-sm"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function AlertRulesSettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeWorkspaceId } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;
  const { rules: loaded, isLoading } = useAlertRules();
  const [draft, setDraft] = useState<AlertRulesConfig>(DEFAULT_ALERT_RULES);

  useEffect(() => {
    setDraft(loaded);
  }, [loaded]);

  const saveMutation = useMutation({
    mutationFn: () =>
      authedJson<AlertRulesConfig>("/api/settings/alert-rules", {
        method: "PATCH",
        body: JSON.stringify({ workspaceId: wsId, ...draft }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: alertRulesQueryKey(wsId) });
      toast({ title: "Alert rules saved" });
    },
    onError: (e) =>
      toast({
        title: "Save failed",
        description: operationalErrorMessage(e, "Could not save alert rules."),
        variant: "destructive",
      }),
  });

  if (!wsId) return <p className="text-sm text-muted-foreground">Select a workspace.</p>;
  if (isLoading) return <Skeleton className="h-48 w-full" />;

  const milestonesStr = draft.testing.trafficMilestonePercents.join(", ");

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Alert rules
          </CardTitle>
          <CardDescription>
            Workspace thresholds for Campaign Review, Executive Overview, and Live Campaign health.
            Operational scoring uses professional terminology — not gamification.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Testing campaigns
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Visits target per offer"
                value={draft.testing.visitsPerOffer}
                onChange={(n) =>
                  setDraft({ ...draft, testing: { ...draft.testing, visitsPerOffer: n } })
                }
              />
              <div className="space-y-1">
                <Label className="text-xs">Traffic milestones (%)</Label>
                <Input
                  className="h-8 text-sm"
                  value={milestonesStr}
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
                label="Traffic spike % increase"
                value={draft.testing.trafficSpikePercentIncrease}
                onChange={(n) =>
                  setDraft({ ...draft, testing: { ...draft.testing, trafficSpikePercentIncrease: n } })
                }
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
              />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Zero conversion at milestone</p>
                <p className="text-[10px] text-muted-foreground">Alert when milestones hit with no conversions</p>
              </div>
              <Switch
                checked={draft.testing.zeroConversionAtMilestoneEnabled}
                onCheckedChange={(v) =>
                  setDraft({
                    ...draft,
                    testing: { ...draft.testing, zeroConversionAtMilestoneEnabled: v },
                  })
                }
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Winners & scaling
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Min conversions (potential winner)"
                value={draft.winners.minConversionsForPotentialWinner}
                onChange={(n) =>
                  setDraft({ ...draft, winners: { ...draft.winners, minConversionsForPotentialWinner: n } })
                }
              />
              <NumberField
                label="Min ROI % (likely winner)"
                value={draft.winners.minRoiPercentForLikelyWinner}
                onChange={(n) =>
                  setDraft({ ...draft, winners: { ...draft.winners, minRoiPercentForLikelyWinner: n } })
                }
              />
              <NumberField
                label="Scale: no conversions after (hours)"
                value={draft.scaling.noConversionsAfterHours}
                onChange={(n) =>
                  setDraft({ ...draft, scaling: { ...draft.scaling, noConversionsAfterHours: n } })
                }
              />
              <NumberField
                label="Scale: negative ROI after (days)"
                value={draft.scaling.negativeRoiDays}
                onChange={(n) =>
                  setDraft({ ...draft, scaling: { ...draft.scaling, negativeRoiDays: n } })
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <p className="text-sm font-medium">Batch finished with winners — no scale action</p>
              <Switch
                checked={draft.winners.batchFinishedWinnersNoActionEnabled}
                onCheckedChange={(v) =>
                  setDraft({
                    ...draft,
                    winners: { ...draft.winners, batchFinishedWinnersNoActionEnabled: v },
                  })
                }
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Review escalation
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Ignored signal escalation (hours)"
                value={draft.review.ignoredSignalEscalationHours}
                onChange={(n) =>
                  setDraft({ ...draft, review: { ...draft.review, ignoredSignalEscalationHours: n } })
                }
              />
              <NumberField
                label="Dismissal snooze (hours)"
                value={draft.review.dismissalSnoozeHours}
                onChange={(n) =>
                  setDraft({ ...draft, review: { ...draft.review, dismissalSnoozeHours: n } })
                }
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Operational score weights
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberField
                label="Positive review points"
                value={draft.operationalScoring.positiveReviewPoints}
                onChange={(n) =>
                  setDraft({
                    ...draft,
                    operationalScoring: { ...draft.operationalScoring, positiveReviewPoints: n },
                  })
                }
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
              />
            </div>
          </section>

          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving…" : "Save alert rules"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
