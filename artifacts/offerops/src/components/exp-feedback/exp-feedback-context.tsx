import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TodoTask } from "@workspace/api-client-react";
import { DEFAULT_CONFIG, useGoalsConfig } from "@/lib/goals-config";
import {
  resolveTaskCompletionExp,
  type TaskCompletionExpOptions,
} from "@/lib/exp-task-points";
import { ExpFeedbackOverlay, type ExpFeedbackEvent } from "./exp-feedback-overlay";

/** Set true to wire a sound asset later. */
export const EXP_SOUND_ENABLED = false;

export function playExpSoundPlaceholder(): void {
  if (!EXP_SOUND_ENABLED) return;
  // Future: short subtle chime via Web Audio or <audio>.
}

const STREAK_WINDOW_MS = 45_000;

type ExpFeedbackContextValue = {
  celebrateTaskCompletion: (task: TodoTask, opts?: TaskCompletionExpOptions) => void;
};

const ExpFeedbackContext = createContext<ExpFeedbackContextValue | null>(null);

export function ExpFeedbackProvider({ children }: { children: ReactNode }) {
  const { data: cfgRaw } = useGoalsConfig();
  const cfg = cfgRaw ?? DEFAULT_CONFIG;
  const [events, setEvents] = useState<ExpFeedbackEvent[]>([]);
  const streakRef = useRef<{ count: number; lastAt: number }>({ count: 0, lastAt: 0 });
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const celebrateTaskCompletion = useCallback(
    (task: TodoTask, opts?: TaskCompletionExpOptions) => {
      const { points } = resolveTaskCompletionExp(task, cfg, opts);
      if (points <= 0) return;

      const now = Date.now();
      if (now - streakRef.current.lastAt <= STREAK_WINDOW_MS) {
        streakRef.current.count += 1;
      } else {
        streakRef.current = { count: 1, lastAt: now };
      }
      streakRef.current.lastAt = now;

      const id = ++idRef.current;
      setEvents((prev) => [
        ...prev.slice(-4),
        {
          id,
          points,
          title: "Task Completed",
          streak: streakRef.current.count >= 2 ? streakRef.current.count : undefined,
        },
      ]);

      playExpSoundPlaceholder();
    },
    [cfg],
  );

  const value = useMemo(() => ({ celebrateTaskCompletion }), [celebrateTaskCompletion]);

  return (
    <ExpFeedbackContext.Provider value={value}>
      {children}
      <ExpFeedbackOverlay events={events} onDismiss={dismiss} />
    </ExpFeedbackContext.Provider>
  );
}

export function useExpFeedback(): ExpFeedbackContextValue {
  const ctx = useContext(ExpFeedbackContext);
  if (!ctx) {
    throw new Error("useExpFeedback must be used within ExpFeedbackProvider");
  }
  return ctx;
}
