// Phase 4 (Task #14) — rule registry. Importing this module registers
// one handler per spec-canonical event type. The registration is
// idempotent at module-load time (Node caches modules), and is invoked
// for its side effect only — the module exports `registerAllRules()`
// for tests that need to re-register after `_resetRegistryForTests()`.
//
// Order of registration is deterministic so tests can reason about the
// handler order inside a single emit().

import { registerHandler } from "../handlers.ts";
import type { EventType } from "../types.ts";
import { handleBatchCreated } from "./batch-created.ts";
import { handleBatchResultsRecorded } from "./batch-results-recorded.ts";
import { handleBatchStatsUpdated } from "./batch-stats-updated.ts";
import { handleBatchStatusChanged } from "./batch-status-changed.ts";
import { handleBatchTested } from "./batch-tested.ts";
import { handleCampaignStatusChanged } from "./campaign-status-changed.ts";
import { handleOfferImported } from "./offer-imported.ts";
import { handleOptimizationDue } from "./optimization-due.ts";
import { handleTaskCompleted } from "./task-completed.ts";
import { handleTaskOverdue } from "./task-overdue.ts";
import { handleTrackerCampaignImported } from "./tracker-campaign-imported.ts";
import { handleTrafficSourceAdvanced } from "./traffic-source-advanced.ts";
import { handleVoluumCampaignTagInvalid } from "./voluum-campaign-tag-invalid.ts";
import { handleFindWinnersDue } from "./find-winners-due.ts";

let registered = false;

/**
 * Register every Phase 4 rule. Safe to call multiple times — the
 * registry is reset only by `_resetRegistryForTests()` and this guard
 * prevents accidental double registration in production.
 */
export function registerAllRules(): void {
  if (registered) return;
  registered = true;

  registerHandler("OfferImported", handleOfferImported);
  registerHandler("BatchCreated", handleBatchCreated);
  registerHandler("TrackerCampaignImported", handleTrackerCampaignImported);
  registerHandler("BatchStatusChanged", handleBatchStatusChanged);
  registerHandler("BatchTested", handleBatchTested);
  registerHandler("BatchStatsUpdated", handleBatchStatsUpdated);
  registerHandler("TaskCompleted", handleTaskCompleted);
  registerHandler("TaskOverdue", handleTaskOverdue);
  registerHandler("TrafficSourceAdvanced", handleTrafficSourceAdvanced);
  registerHandler("VoluumCampaignTagInvalid", handleVoluumCampaignTagInvalid);
  // Pivot Phase 4 (Task #27): manual-workflow auto-task rules.
  registerHandler("CampaignStatusChanged", handleCampaignStatusChanged);
  registerHandler("BatchResultsRecorded", handleBatchResultsRecorded);
  registerHandler("OptimizationDue", handleOptimizationDue);
  registerHandler("FindWinnersDue", handleFindWinnersDue);
}

/** Test-only — clear the guard so `registerAllRules()` will re-run. */
export function _resetRulesGuardForTests(): void {
  registered = false;
}

/**
 * The exhaustive list of event types covered by Phase 4 rules. If you
 * add a new event type to `EventInput` you MUST also extend
 * `registerAllRules()` and add the type here — the compile check below
 * fails until you do.
 */
const COVERED_EVENT_TYPES = [
  "OfferImported",
  "BatchCreated",
  "TrackerCampaignImported",
  "BatchStatusChanged",
  "BatchTested",
  "BatchStatsUpdated",
  "TaskCompleted",
  "TaskOverdue",
  "TrafficSourceAdvanced",
  "VoluumCampaignTagInvalid",
  "CampaignStatusChanged",
  "BatchResultsRecorded",
  "OptimizationDue",
  "FindWinnersDue",
] as const satisfies readonly EventType[];

// Compile-time exhaustiveness: `EventType` minus what we cover must be
// `never`. If it isn't, TS rejects this assignment.
type _UncoveredEventType = Exclude<
  EventType,
  (typeof COVERED_EVENT_TYPES)[number]
>;
const _exhaustivenessCheck: _UncoveredEventType extends never ? true : false =
  true;
void _exhaustivenessCheck;

// Eagerly register on import so production code paths (`import "./engine/rules"`)
// just work without remembering to call the function.
registerAllRules();
