/**
 * Cron gating for multi-replica deployments.
 *
 * CRON_DISABLED=true → never start in-process background crons (web tier).
 * CRON_ENABLED=false → same as disabled.
 * CRON_ENABLED=true (or unset with no CRON_DISABLED) → crons run (worker / default dev).
 *
 * CRON_DISABLED wins over CRON_ENABLED if both are set inconsistently.
 */
export type BackgroundCronResolution = {
  enabled: boolean;
  reason: string;
};

export function resolveBackgroundCronsEnabled(): BackgroundCronResolution {
  const disabledRaw = process.env.CRON_DISABLED?.trim().toLowerCase();
  if (disabledRaw === "true" || disabledRaw === "1" || disabledRaw === "yes") {
    return { enabled: false, reason: "CRON_DISABLED=true" };
  }

  const enabledRaw = process.env.CRON_ENABLED?.trim().toLowerCase();
  if (
    enabledRaw === "false" ||
    enabledRaw === "0" ||
    enabledRaw === "no"
  ) {
    return { enabled: false, reason: "CRON_ENABLED=false" };
  }

  if (
    enabledRaw === "true" ||
    enabledRaw === "1" ||
    enabledRaw === "yes"
  ) {
    return { enabled: true, reason: "CRON_ENABLED=true" };
  }

  return { enabled: true, reason: "default (crons enabled; set CRON_DISABLED=true on web replicas)" };
}
