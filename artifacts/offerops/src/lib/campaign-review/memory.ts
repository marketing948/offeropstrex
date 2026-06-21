import { DEFAULT_ALERT_RULES, type AlertRulesConfig } from "@workspace/alert-rules";
import type { ReviewMemoryEvent, ReviewMemoryEventType } from "@/lib/campaign-review/types";

const STORAGE_PREFIX = "offerops.campaignReview.memory";

type StoredState = {
  firstSeenAt: Record<string, string>;
  dismissedUntil: Record<string, string>;
  events: ReviewMemoryEvent[];
};

function escalationMs(rules: AlertRulesConfig): number {
  return rules.review.ignoredSignalEscalationHours * 60 * 60 * 1000;
}

function storageKey(workspaceId: number, employeeId: number): string {
  return `${STORAGE_PREFIX}.${workspaceId}.${employeeId}`;
}

function loadState(workspaceId: number, employeeId: number): StoredState {
  if (typeof window === "undefined") {
    return { firstSeenAt: {}, dismissedUntil: {}, events: [] };
  }
  try {
    const raw = localStorage.getItem(storageKey(workspaceId, employeeId));
    if (!raw) return { firstSeenAt: {}, dismissedUntil: {}, events: [] };
    const parsed = JSON.parse(raw) as StoredState;
    return {
      firstSeenAt: parsed.firstSeenAt ?? {},
      dismissedUntil: parsed.dismissedUntil ?? {},
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return { firstSeenAt: {}, dismissedUntil: {}, events: [] };
  }
}

function saveState(workspaceId: number, employeeId: number, state: StoredState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(workspaceId, employeeId), JSON.stringify(state));
}

export function recordReviewEvent(
  workspaceId: number,
  actorEmployeeId: number,
  event: Omit<ReviewMemoryEvent, "id" | "createdAt" | "workspaceId" | "employeeId">,
): ReviewMemoryEvent {
  const state = loadState(workspaceId, actorEmployeeId);
  const full: ReviewMemoryEvent = {
    ...event,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    employeeId: actorEmployeeId,
    createdAt: new Date().toISOString(),
  };
  state.events.unshift(full);
  if (state.events.length > 200) state.events.length = 200;
  saveState(workspaceId, actorEmployeeId, state);
  return full;
}

export function getReviewEvents(
  workspaceId: number,
  employeeId: number,
  campaignId?: number,
): ReviewMemoryEvent[] {
  const state = loadState(workspaceId, employeeId);
  const list = state.events;
  if (campaignId == null) return list;
  return list.filter((e) => e.campaignId === campaignId);
}

/** Notes submitted from Live Campaigns → Send Campaign to review (local memory only). */
export function getMediaBuyerNotes(
  workspaceId: number,
  employeeId: number,
): ReviewMemoryEvent[] {
  return getReviewEvents(workspaceId, employeeId).filter(
    (e) => e.type === "action_taken" && Boolean(e.note?.trim()),
  );
}

export function getLatestMediaBuyerNote(
  workspaceId: number,
  employeeId: number,
  campaignId: number,
): ReviewMemoryEvent | null {
  return (
    getReviewEvents(workspaceId, employeeId, campaignId).find(
      (e) => e.type === "action_taken" && Boolean(e.note?.trim()),
    ) ?? null
  );
}

export function touchCampaignFirstSeen(
  workspaceId: number,
  employeeId: number,
  campaignId: number,
): string {
  const state = loadState(workspaceId, employeeId);
  const key = String(campaignId);
  if (!state.firstSeenAt[key]) {
    state.firstSeenAt[key] = new Date().toISOString();
    saveState(workspaceId, employeeId, state);
  }
  return state.firstSeenAt[key];
}

export function isCampaignDismissed(
  workspaceId: number,
  employeeId: number,
  campaignId: number,
): boolean {
  const state = loadState(workspaceId, employeeId);
  const until = state.dismissedUntil[String(campaignId)];
  if (!until) return false;
  return new Date(until).getTime() > Date.now();
}

export function dismissCampaignUntil(
  workspaceId: number,
  employeeId: number,
  campaignId: number,
  hours?: number,
  rules: AlertRulesConfig = DEFAULT_ALERT_RULES,
): void {
  const snooze = hours ?? rules.review.dismissalSnoozeHours;
  const state = loadState(workspaceId, employeeId);
  const until = new Date(Date.now() + snooze * 60 * 60 * 1000).toISOString();
  state.dismissedUntil[String(campaignId)] = until;
  saveState(workspaceId, employeeId, state);
}

export function shouldEscalateReview(
  workspaceId: number,
  employeeId: number,
  campaignId: number,
  rules: AlertRulesConfig = DEFAULT_ALERT_RULES,
): boolean {
  const state = loadState(workspaceId, employeeId);
  const key = String(campaignId);
  const first = state.firstSeenAt[key];
  if (!first) return false;
  const firstMs = new Date(first).getTime();
  if (Date.now() - firstMs < escalationMs(rules)) return false;
  const recentReview = state.events.find(
    (e) =>
      e.campaignId === campaignId &&
      (e.type === "reviewed" || e.type === "winner_candidate" || e.type === "scaling_task_suggested") &&
      new Date(e.createdAt).getTime() > firstMs,
  );
  return !recentReview;
}

export function markEscalatedIfNeeded(
  workspaceId: number,
  employeeId: number,
  campaignId: number,
  rules: AlertRulesConfig = DEFAULT_ALERT_RULES,
): boolean {
  if (!shouldEscalateReview(workspaceId, employeeId, campaignId, rules)) return false;
  const ms = escalationMs(rules);
  const already = loadState(workspaceId, employeeId).events.some(
    (e) =>
      e.campaignId === campaignId &&
      e.type === "escalated" &&
      Date.now() - new Date(e.createdAt).getTime() < ms,
  );
  if (already) return true;
  recordReviewEvent(workspaceId, employeeId, {
    campaignId,
    type: "escalated",
    note: `Review signal open ${rules.review.ignoredSignalEscalationHours}+ hours without resolution`,
  });
  return true;
}

export type OperationalScoreSummary = {
  score: number;
  reliability: "strong" | "steady" | "needs_attention";
  timelyReviews: number;
  penalties: number;
  positives: number;
};

/** Client-side operational score from review memory (not gamification). */
export function computeOperationalScore(
  workspaceId: number,
  employeeId: number,
  rules: AlertRulesConfig = DEFAULT_ALERT_RULES,
  windowDays = 7,
): OperationalScoreSummary {
  const state = loadState(workspaceId, employeeId);
  const scoring = rules.operationalScoring;
  const cutoff = Date.now() - windowDays * 86_400_000;
  const recent = state.events.filter((e) => new Date(e.createdAt).getTime() >= cutoff);

  let score = scoring.baseScore;
  let timelyReviews = 0;
  let penalties = 0;
  let positives = 0;

  for (const e of recent) {
    switch (e.type as ReviewMemoryEventType) {
      case "reviewed":
      case "winner_candidate":
      case "scaling_task_suggested":
        score += scoring.positiveReviewPoints;
        positives += 1;
        timelyReviews += 1;
        break;
      case "escalated":
        score -= scoring.escalationPenalty;
        penalties += 1;
        break;
      case "ignored":
        score -= scoring.ignoredSignalPenalty;
        penalties += 1;
        break;
      case "dismissed_signal":
        score -= scoring.dismissPenalty;
        break;
      case "action_taken":
        score += scoring.actionTakenPoints;
        positives += 1;
        break;
      default:
        break;
    }
  }

  score = Math.max(0, Math.min(100, score));
  const reliability =
    score >= 70 ? "strong" : score >= 45 ? "steady" : "needs_attention";

  return { score, reliability, timelyReviews, penalties, positives };
}
