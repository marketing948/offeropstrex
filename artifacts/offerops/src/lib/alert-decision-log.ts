import type { EvaluatorOutput } from "@workspace/alert-rules";

/**
 * TEMP rollout logging (STEP 3 of the alert-engine go-live).
 * Logs every unified evaluator decision outside production so we can verify the
 * same campaign resolves to the same status across Live Campaigns, Operations
 * Hub, and the Dashboard. Remove once the new engine is validated in the wild.
 */
export function logAlertDecision(
  campaignId: number | string | null | undefined,
  surface: string,
  result: EvaluatorOutput,
): void {
  if (process.env.NODE_ENV !== "production") {
    console.log("ALERT_DECISION", { campaignId, surface, result });
  }
}
