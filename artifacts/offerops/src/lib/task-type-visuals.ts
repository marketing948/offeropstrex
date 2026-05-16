// Single source of truth for per-task-type visuals on the Tasks tab
// and in the task detail drawer header. Keep the keys in sync with
// the literals branched on in `components/task-detail-drawer.tsx`
// and `pages/tasks.tsx::TASK_TYPE_LABEL`.

import {
  Apple,
  Smartphone,
  PlayCircle,
  Trophy,
  CheckCircle2,
  Wrench,
  TrendingUp,
  ListChecks,
  type LucideIcon,
} from "lucide-react";

export type TaskTypeVisual = {
  icon: LucideIcon;
  label: string;
  subtext: string;
  // Tailwind utility-class fragments. Kept as plain class names so
  // Tailwind's JIT scanner picks them up at build time.
  accentBar: string;       // left stripe color
  iconBg: string;          // chip background
  iconFg: string;          // chip foreground
  badgeBg: string;         // soft pill background
  badgeFg: string;         // soft pill text
  isLegacy: boolean;
};

const ACTIVE: Record<string, TaskTypeVisual> = {
  create_voluum_campaign_ios: {
    icon: Apple,
    label: "Create iOS campaign",
    subtext: "Spin up Voluum + traffic source",
    accentBar: "bg-sky-500",
    iconBg: "bg-sky-100 dark:bg-sky-900/40",
    iconFg: "text-sky-700 dark:text-sky-300",
    badgeBg: "bg-sky-100 dark:bg-sky-900/40",
    badgeFg: "text-sky-800 dark:text-sky-200",
    isLegacy: false,
  },
  create_voluum_campaign_android: {
    icon: Smartphone,
    label: "Create Android campaign",
    subtext: "Spin up Voluum + traffic source",
    accentBar: "bg-emerald-500",
    iconBg: "bg-emerald-100 dark:bg-emerald-900/40",
    iconFg: "text-emerald-700 dark:text-emerald-300",
    badgeBg: "bg-emerald-100 dark:bg-emerald-900/40",
    badgeFg: "text-emerald-800 dark:text-emerald-200",
    isLegacy: false,
  },
  take_campaign_live: {
    icon: PlayCircle,
    label: "Take campaign live",
    subtext: "Confirm it's running on the source",
    accentBar: "bg-violet-500",
    iconBg: "bg-violet-100 dark:bg-violet-900/40",
    iconFg: "text-violet-700 dark:text-violet-300",
    badgeBg: "bg-violet-100 dark:bg-violet-900/40",
    badgeFg: "text-violet-800 dark:text-violet-200",
    isLegacy: false,
  },
  find_winners: {
    icon: Trophy,
    label: "Find winners (7-day perf)",
    subtext: "Enter spend, revenue, conversions",
    accentBar: "bg-amber-500",
    iconBg: "bg-amber-100 dark:bg-amber-900/40",
    iconFg: "text-amber-700 dark:text-amber-300",
    badgeBg: "bg-amber-100 dark:bg-amber-900/40",
    badgeFg: "text-amber-800 dark:text-amber-200",
    isLegacy: false,
  },
  all_traffic_sources_tested: {
    icon: CheckCircle2,
    label: "Platform fully tested",
    subtext: "All traffic sources covered",
    accentBar: "bg-slate-500",
    iconBg: "bg-slate-100 dark:bg-slate-800/60",
    iconFg: "text-slate-700 dark:text-slate-300",
    badgeBg: "bg-slate-100 dark:bg-slate-800/60",
    badgeFg: "text-slate-800 dark:text-slate-200",
    isLegacy: false,
  },
};

const LEGACY: Record<string, TaskTypeVisual> = {
  CREATE_IOS_CAMPAIGN: { ...ACTIVE.create_voluum_campaign_ios, isLegacy: true },
  CREATE_ANDROID_CAMPAIGN: { ...ACTIVE.create_voluum_campaign_android, isLegacy: true },
  CREATE_IOS_TRACKER_CAMPAIGN: { ...ACTIVE.create_voluum_campaign_ios, isLegacy: true },
  CREATE_ANDROID_TRACKER_CAMPAIGN: { ...ACTIVE.create_voluum_campaign_android, isLegacy: true },
  GO_LIVE: { ...ACTIVE.take_campaign_live, label: "Take live", isLegacy: true },
  GO_LIVE_TRAFFIC_SOURCE_CAMPAIGN: { ...ACTIVE.take_campaign_live, label: "Take live", isLegacy: true },
  FIND_WINNERS: { ...ACTIVE.find_winners, isLegacy: true },
  OPTIMIZATION_FOLLOWUP: {
    icon: Wrench,
    label: "Optimization follow-up",
    subtext: "Tweak underperforming campaigns",
    accentBar: "bg-orange-500",
    iconBg: "bg-orange-100 dark:bg-orange-900/40",
    iconFg: "text-orange-700 dark:text-orange-300",
    badgeBg: "bg-orange-100 dark:bg-orange-900/40",
    badgeFg: "text-orange-800 dark:text-orange-200",
    isLegacy: true,
  },
  MOVE_WINNERS_TO_SCALED_CAMPAIGN: {
    icon: TrendingUp,
    label: "Move winners to scaled",
    subtext: "Promote winners in the tracker",
    accentBar: "bg-rose-500",
    iconBg: "bg-rose-100 dark:bg-rose-900/40",
    iconFg: "text-rose-700 dark:text-rose-300",
    badgeBg: "bg-rose-100 dark:bg-rose-900/40",
    badgeFg: "text-rose-800 dark:text-rose-200",
    isLegacy: true,
  },
  PAUSE_TRAFFIC_SOURCE_CAMPAIGNS: {
    icon: Wrench,
    label: "Pause traffic source",
    subtext: "Stop spend on this source",
    accentBar: "bg-zinc-500",
    iconBg: "bg-zinc-100 dark:bg-zinc-800/60",
    iconFg: "text-zinc-700 dark:text-zinc-300",
    badgeBg: "bg-zinc-100 dark:bg-zinc-800/60",
    badgeFg: "text-zinc-800 dark:text-zinc-200",
    isLegacy: true,
  },
};

const FALLBACK: TaskTypeVisual = {
  icon: ListChecks,
  label: "Task",
  subtext: "Open to view details",
  accentBar: "bg-muted-foreground/40",
  iconBg: "bg-muted",
  iconFg: "text-muted-foreground",
  badgeBg: "bg-muted",
  badgeFg: "text-muted-foreground",
  isLegacy: false,
};

export function getTaskTypeVisual(taskType: string | null | undefined): TaskTypeVisual {
  if (!taskType) return FALLBACK;
  return ACTIVE[taskType] ?? LEGACY[taskType] ?? { ...FALLBACK, label: taskType };
}

// Active types in display order for filter chips and empty states.
export const ACTIVE_TASK_TYPES: ReadonlyArray<{ key: string; visual: TaskTypeVisual }> = [
  "create_voluum_campaign_ios",
  "create_voluum_campaign_android",
  "take_campaign_live",
  "find_winners",
  "all_traffic_sources_tested",
].map((key) => ({ key, visual: ACTIVE[key] }));
