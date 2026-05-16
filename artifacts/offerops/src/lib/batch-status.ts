/**
 * Phase 9 — Spec-canonical batch lifecycle (Automation Bible §6).
 *
 * Single source of truth for batch status display + ordering across the
 * worker UI. Replaces the legacy 12-state config that was scattered
 * (and inconsistent) across testing-batches.tsx, testing-batch-detail.tsx,
 * live-campaigns.tsx and ops-queue.tsx.
 *
 * The 6-state machine, ordered for "action-required first" sort:
 *   1. OFFER_READY_FOR_LIVE_TESTING — both trackers exist, worker must click "Live tests started"
 *   2. TESTED — clicks threshold met, awaiting winner classification
 *   3. LIVE_TESTS — clicks accumulating
 *   4. WAITING_FOR_TRACKER_CAMPAIGNS — at least one tracker still missing in Voluum
 *   5. NEW_BATCH — just created, engine emitting tracker-campaign tasks
 *   6. COMPLETED — winners marked, losers paused, lifecycle done
 */

export type BatchStatus =
  | "NEW_BATCH"
  | "WAITING_FOR_TRACKER_CAMPAIGNS"
  | "OFFER_READY_FOR_LIVE_TESTING"
  | "LIVE_TESTS"
  | "TESTED"
  | "COMPLETED";

export interface BatchStatusConfig {
  label: string;
  short: string;
  text: string;
  bg: string;
  dot: string;
  /** Border accent for action-required surfaces (cards, banners). */
  accent: string;
  /** True when the worker (or admin) is the next actor. */
  actionRequired: boolean;
  /** Step index in the lifecycle (1-based, for "step N of 6" indicators). */
  step: number;
}

export const BATCH_STATUS_CONFIG: Record<BatchStatus, BatchStatusConfig> = {
  NEW_BATCH: {
    label: "New Batch",
    short: "New",
    text: "text-slate-700",
    bg: "bg-slate-100",
    dot: "bg-slate-400",
    accent: "border-slate-200",
    actionRequired: false,
    step: 1,
  },
  WAITING_FOR_TRACKER_CAMPAIGNS: {
    label: "Waiting for Tracker Campaigns",
    short: "Waiting Trackers",
    text: "text-amber-700",
    bg: "bg-amber-50",
    dot: "bg-amber-500",
    accent: "border-amber-200",
    actionRequired: true,
    step: 2,
  },
  OFFER_READY_FOR_LIVE_TESTING: {
    label: "Offer Ready for Live Testing",
    short: "Ready for Live",
    text: "text-orange-700",
    bg: "bg-orange-50",
    dot: "bg-orange-500",
    accent: "border-orange-300",
    actionRequired: true,
    step: 3,
  },
  LIVE_TESTS: {
    label: "Live Tests",
    short: "Live",
    text: "text-cyan-700",
    bg: "bg-cyan-50",
    dot: "bg-cyan-500",
    accent: "border-cyan-200",
    actionRequired: false,
    step: 4,
  },
  TESTED: {
    label: "Tested — Pick Winners",
    short: "Tested",
    text: "text-purple-700",
    bg: "bg-purple-50",
    dot: "bg-purple-500",
    accent: "border-purple-300",
    actionRequired: true,
    step: 5,
  },
  COMPLETED: {
    label: "Completed",
    short: "Done",
    text: "text-teal-700",
    bg: "bg-teal-50",
    dot: "bg-teal-500",
    accent: "border-teal-200",
    actionRequired: false,
    step: 6,
  },
};

/** Display order for sort: action-required first, then in-flight, then done. */
export const BATCH_STATUS_ORDER: BatchStatus[] = [
  "OFFER_READY_FOR_LIVE_TESTING",
  "TESTED",
  "WAITING_FOR_TRACKER_CAMPAIGNS",
  "LIVE_TESTS",
  "NEW_BATCH",
  "COMPLETED",
];

/** Filter pills shown in the worker batches list. */
export const BATCH_STATUS_FILTERS: { value: "all" | BatchStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "OFFER_READY_FOR_LIVE_TESTING", label: "Ready for Live" },
  { value: "TESTED", label: "Pick Winners" },
  { value: "LIVE_TESTS", label: "Live" },
  { value: "WAITING_FOR_TRACKER_CAMPAIGNS", label: "Waiting Trackers" },
  { value: "NEW_BATCH", label: "New" },
  { value: "COMPLETED", label: "Completed" },
];

const FALLBACK: BatchStatusConfig = {
  label: "Unknown",
  short: "?",
  text: "text-gray-600",
  bg: "bg-gray-100",
  dot: "bg-gray-400",
  accent: "border-gray-200",
  actionRequired: false,
  step: 0,
};

export function batchStatusConfig(status: string): BatchStatusConfig {
  return (BATCH_STATUS_CONFIG as Record<string, BatchStatusConfig>)[status] ?? FALLBACK;
}

/** True when the batch belongs at the top of any "needs attention" list. */
export function isActionRequired(status: string): boolean {
  return batchStatusConfig(status).actionRequired;
}

/** Stable sort key — lower = render earlier. */
export function batchStatusSortKey(status: string): number {
  const idx = BATCH_STATUS_ORDER.indexOf(status as BatchStatus);
  return idx === -1 ? 99 : idx;
}

/** Statuses where the batch's tracker campaigns are live in Voluum. */
export const TRACKER_LIVE_STATUSES = new Set<BatchStatus>([
  "OFFER_READY_FOR_LIVE_TESTING",
  "LIVE_TESTS",
  "TESTED",
  "COMPLETED",
]);

/** Statuses where clicks are actively being driven through the tracker. */
export const TRAFFIC_LIVE_STATUSES = new Set<BatchStatus>([
  "LIVE_TESTS",
  "TESTED",
]);
