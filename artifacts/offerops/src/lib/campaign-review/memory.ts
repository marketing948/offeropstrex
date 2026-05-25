import type { ReviewMemoryEvent, ReviewMemoryEventType } from "@/lib/campaign-review/types";

const STORAGE_PREFIX = "offerops.campaignReview.memory";
const ESCALATION_MS = 4 * 60 * 60 * 1000;

type StoredState = {
  firstSeenAt: Record<string, string>;
  dismissedUntil: Record<string, string>;
  events: ReviewMemoryEvent[];
};

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
  hours = 8,
): void {
  const state = loadState(workspaceId, employeeId);
  const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  state.dismissedUntil[String(campaignId)] = until;
  saveState(workspaceId, employeeId, state);
}

export function shouldEscalateReview(
  workspaceId: number,
  employeeId: number,
  campaignId: number,
): boolean {
  const state = loadState(workspaceId, employeeId);
  const key = String(campaignId);
  const first = state.firstSeenAt[key];
  if (!first) return false;
  const firstMs = new Date(first).getTime();
  if (Date.now() - firstMs < ESCALATION_MS) return false;
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
): boolean {
  if (!shouldEscalateReview(workspaceId, employeeId, campaignId)) return false;
  const already = loadState(workspaceId, employeeId).events.some(
    (e) =>
      e.campaignId === campaignId &&
      e.type === "escalated" &&
      Date.now() - new Date(e.createdAt).getTime() < ESCALATION_MS,
  );
  if (already) return true;
  recordReviewEvent(workspaceId, employeeId, {
    campaignId,
    type: "escalated",
    note: "Review signal open 4+ hours without resolution",
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
  windowDays = 7,
): OperationalScoreSummary {
  const state = loadState(workspaceId, employeeId);
  const cutoff = Date.now() - windowDays * 86_400_000;
  const recent = state.events.filter((e) => new Date(e.createdAt).getTime() >= cutoff);

  let score = 50;
  let timelyReviews = 0;
  let penalties = 0;
  let positives = 0;

  for (const e of recent) {
    switch (e.type as ReviewMemoryEventType) {
      case "reviewed":
      case "winner_candidate":
      case "scaling_task_suggested":
        score += 4;
        positives += 1;
        timelyReviews += 1;
        break;
      case "escalated":
      case "ignored":
        score -= 6;
        penalties += 1;
        break;
      case "dismissed_signal":
        score -= 1;
        break;
      case "action_taken":
        score += 2;
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
