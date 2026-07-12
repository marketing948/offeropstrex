/**
 * Alert engine rollout flags (STEP 7 — safety).
 *
 * The unified evaluator ships DARK: production keeps the legacy per-surface logic
 * until we validate legacy-vs-new parity. Flip `USE_NEW_ALERT_ENGINE` to true
 * (and legacy off) only after the comparison validation passes.
 *
 * Kept as plain constants so bundlers can tree-shake the unused path and there
 * is zero runtime/config dependency for the default (legacy) behavior.
 */
export const USE_LEGACY_ALERTS = false;
export const USE_NEW_ALERT_ENGINE = true;
