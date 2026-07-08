import { useCallback, useEffect, useState } from "react";
import {
  type MissionCompletionState,
  emptyCompletion,
  isDone as isDonePure,
  normalizeForToday,
  toggleDone as toggleDonePure,
} from "./daily-mission-completion.ts";

const STORAGE_PREFIX = "offerops.dailyMission";

function storageKey(workspaceId: number, employeeId: number): string {
  return `${STORAGE_PREFIX}.${workspaceId}.${employeeId}`;
}

function loadState(workspaceId: number, employeeId: number): MissionCompletionState {
  if (typeof window === "undefined") return emptyCompletion();
  try {
    const raw = localStorage.getItem(storageKey(workspaceId, employeeId));
    if (!raw) return emptyCompletion();
    return normalizeForToday(JSON.parse(raw) as MissionCompletionState);
  } catch {
    return emptyCompletion();
  }
}

function saveState(
  workspaceId: number,
  employeeId: number,
  state: MissionCompletionState,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(workspaceId, employeeId), JSON.stringify(state));
  } catch {
    // best-effort convenience layer; ignore quota/serialization errors
  }
}

/**
 * Worker-scoped, date-scoped "done for today" state for Daily Mission rows.
 * Persisted to localStorage (convenience layer only — never mutates campaign truth).
 *
 * When workspace/employee identity is unavailable (e.g. admin team view without a
 * selected worker), completion is disabled and toggling is a no-op.
 */
export function useDailyMissionCompletion(
  workspaceId: number | null | undefined,
  employeeId: number | null | undefined,
) {
  const enabled = Number.isFinite(workspaceId) && Number.isFinite(employeeId);
  const wsId = Number(workspaceId);
  const empId = Number(employeeId);

  const [state, setState] = useState<MissionCompletionState>(() =>
    enabled ? loadState(wsId, empId) : emptyCompletion(),
  );

  useEffect(() => {
    if (!enabled) {
      setState(emptyCompletion());
      return;
    }
    setState(loadState(wsId, empId));
  }, [enabled, wsId, empId]);

  const toggle = useCallback(
    (key: string) => {
      if (!enabled) return;
      setState((prev) => {
        const next = toggleDonePure(prev, key);
        saveState(wsId, empId, next);
        return next;
      });
    },
    [enabled, wsId, empId],
  );

  const isDone = useCallback((key: string) => isDonePure(state, key), [state]);

  return { state, isDone, toggle, enabled };
}
