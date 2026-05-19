import type { MissionControlFilter } from "@/lib/mission-control-health";

const STORAGE_KEY = "offerops.mission-control.prefs";

const VALID_FILTERS = new Set<MissionControlFilter>([
  "all",
  "attention",
  "healthy",
  "critical",
  "openTasks",
  "needsRecovery",
  "recentlyUpdated",
]);

export type MissionControlPrefs = {
  filter: MissionControlFilter;
  autoRefreshSec: number;
};

const DEFAULT_PREFS: MissionControlPrefs = {
  filter: "all",
  autoRefreshSec: 0,
};

export function loadMissionControlPrefs(): MissionControlPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<MissionControlPrefs>;
    const filter =
      typeof parsed.filter === "string" && VALID_FILTERS.has(parsed.filter as MissionControlFilter)
        ? (parsed.filter as MissionControlFilter)
        : DEFAULT_PREFS.filter;
    const autoRefreshSec =
      parsed.autoRefreshSec === 15 || parsed.autoRefreshSec === 30 ? parsed.autoRefreshSec : 0;
    return { filter, autoRefreshSec };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveMissionControlPrefs(prefs: MissionControlPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}
