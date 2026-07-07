import type { ServerGoalsConfig } from "./goals-config-server.ts";

const DEFAULT_CONFIG: ServerGoalsConfig = {
  workerGoalTargets: [],
  pointActions: [],
  eventPointRules: [],
  kpiTargets: [],
};

export function safeParseGoalsConfig(value: unknown): Partial<ServerGoalsConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Partial<ServerGoalsConfig>;
}

export function countWorkerGoalTargets(config: Partial<ServerGoalsConfig> | null | undefined): number {
  if (!config || !Array.isArray(config.workerGoalTargets)) return 0;
  return config.workerGoalTargets.length;
}

export function mergeLegacyGoalsSettingsPreservingWorkerTargets(
  existingConfigRaw: unknown,
  incomingConfigRaw: unknown,
): ServerGoalsConfig {
  const existing = safeParseGoalsConfig(existingConfigRaw);
  const incoming = safeParseGoalsConfig(incomingConfigRaw);

  const merged = {
    ...DEFAULT_CONFIG,
    ...existing,
    ...incoming,
  } as ServerGoalsConfig;

  // Hard guard: /settings/goals must never mutate workerGoalTargets.
  merged.workerGoalTargets = Array.isArray(existing.workerGoalTargets)
    ? existing.workerGoalTargets
    : [];

  return merged;
}
