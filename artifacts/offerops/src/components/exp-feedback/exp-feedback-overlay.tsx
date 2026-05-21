import { AnimatePresence, motion } from "framer-motion";
import { Zap } from "lucide-react";
import { useEffect } from "react";

export type ExpFeedbackEvent = {
  id: number;
  points: number;
  title: string;
  streak?: number;
};

const AUTO_DISMISS_MS = 2800;

export function ExpFeedbackOverlay({
  events,
  onDismiss,
}: {
  events: ExpFeedbackEvent[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-16 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6"
      aria-live="polite"
    >
      <AnimatePresence mode="popLayout">
        {events.map((event) => (
          <ExpFeedbackCard key={event.id} event={event} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ExpFeedbackCard({
  event,
  onDismiss,
}: {
  event: ExpFeedbackEvent;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(event.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [event.id, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-auto w-full max-w-sm rounded-lg border border-emerald-200/80 bg-card/95 px-4 py-3 shadow-lg backdrop-blur-sm dark:border-emerald-800/60"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Zap className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold tabular-nums tracking-tight text-foreground">
            +{event.points} EXP
          </p>
          <p className="text-sm font-medium text-muted-foreground">{event.title}</p>
          {event.streak != null && event.streak >= 2 && (
            <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
              {event.streak} tasks in a row
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
