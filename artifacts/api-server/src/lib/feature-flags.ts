/**
 * Phase 2 (Task #12) feature flags.
 *
 * The Automation Bible migration ships its schema (Phase 2) and its
 * matching engine + sync rewrite (Phase 5) as separate tasks. Between
 * the two, legacy automation in `sync.ts`, `testing-batches.ts`, etc.
 * still references enum strings (`"draft"`, `"create_test_campaign"`,
 * `"ready_for_optimization"`, ...) that no longer exist in the DB
 * enum and will fail at runtime if executed.
 *
 * `OFFEROPS_AUTOMATION_V1_ENABLED` MUST stay false until Phase 5 lands.
 * It exists as a runtime kill-switch so any code path that still uses
 * the v1 (legacy) state machine can early-return without touching the
 * DB. New v2 (Automation Bible) code added in Phase 3+ does NOT consult
 * this flag — it is always live once written.
 *
 * Do not gate this on env vars in dev: the constant itself MUST be
 * `false` so the TypeScript dead-code branch is statically removable
 * when Phase 5 deletes the legacy paths.
 */
export const OFFEROPS_AUTOMATION_V1_ENABLED = false as const;

/**
 * Pivot Phase 0 — Voluum runtime kill-switch.
 *
 * The product pivot moved OfferOps to a manual-first Campaign Operations
 * flow. Voluum code remains in the repo (future automation layer) but
 * every runtime path is gated behind this flag. Default: OFF.
 *
 * When false:
 *   - All `/api/sync/voluum/*` and legacy `/api/settings/voluum*` routes
 *     return 410 Gone.
 *   - The reconciliation cron skips Voluum auto-grouping.
 *   - `engine/emit()` short-circuits Voluum-only event types
 *     (OfferImported, TrackerCampaignImported, VoluumCampaignTagInvalid,
 *     TrafficSourceAdvanced) with a single info log.
 *   - The frontend hides every Voluum control.
 *
 * Set `ENABLE_VOLUUM=true` (or `1`) to restore prior behavior.
 */
export function isVoluumEnabled(): boolean {
  const v = process.env["ENABLE_VOLUUM"];
  if (!v) return false;
  const norm = v.trim().toLowerCase();
  return norm === "true" || norm === "1" || norm === "yes" || norm === "on";
}

/** Voluum-only event types short-circuited by `emit()` when Voluum is off. */
export const VOLUUM_ONLY_EVENT_TYPES: ReadonlySet<string> = new Set([
  "OfferImported",
  "TrackerCampaignImported",
  "VoluumCampaignTagInvalid",
  "TrafficSourceAdvanced",
]);
