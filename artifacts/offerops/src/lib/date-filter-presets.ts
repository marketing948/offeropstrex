import { parseDueDate } from "@/lib/worker-tasks";

/** Canonical platform date presets (UI labels must match DATE_RANGE_PRESET_LABELS). */
export type DateRangePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"
  | "custom";

/** Work queue due-date filter includes “no due date filter”. */
export type DateFilterPreset = DateRangePreset | "all";

export type ResolvedDateRange = {
  dateFrom: string;
  dateTo: string;
};

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 Days",
  last30: "Last 30 Days",
  thisWeek: "This Week",
  thisMonth: "This Month",
  lastMonth: "Last Month",
  custom: "Custom Range",
};

export const DATE_RANGE_PRESET_OPTIONS: { key: DateRangePreset; label: string }[] = (
  ["today", "yesterday", "last7", "last30", "thisWeek", "thisMonth", "lastMonth", "custom"] as const
).map((key) => ({ key, label: DATE_RANGE_PRESET_LABELS[key] }));

export const DATE_FILTER_PRESET_OPTIONS: { key: DateFilterPreset; label: string }[] = [
  { key: "all", label: "Any due date" },
  ...DATE_RANGE_PRESET_OPTIONS,
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayIsoDate(now = new Date()): string {
  return formatIsoDate(now);
}

export function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function weekStartLocal(now: Date): Date {
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = startOfLocalDay(now);
  start.setDate(start.getDate() - diff);
  return start;
}

/** Resolve preset to inclusive local-date ISO range (YYYY-MM-DD). */
export function resolveDateRangeFromPreset(
  preset: DateRangePreset,
  now = new Date(),
  custom?: Partial<ResolvedDateRange>,
): ResolvedDateRange {
  if (preset === "custom") {
    const dateFrom = custom?.dateFrom?.trim() || todayIsoDate(now);
    const dateTo = custom?.dateTo?.trim() || dateFrom;
    return { dateFrom, dateTo: dateTo >= dateFrom ? dateTo : dateFrom };
  }

  const todayStart = startOfLocalDay(now);
  const todayIso = formatIsoDate(todayStart);

  switch (preset) {
    case "today":
      return { dateFrom: todayIso, dateTo: todayIso };
    case "yesterday": {
      const y = new Date(todayStart);
      y.setDate(y.getDate() - 1);
      const iso = formatIsoDate(y);
      return { dateFrom: iso, dateTo: iso };
    }
    case "last7": {
      const from = new Date(todayStart);
      from.setDate(from.getDate() - 6);
      return { dateFrom: formatIsoDate(from), dateTo: todayIso };
    }
    case "last30": {
      const from = new Date(todayStart);
      from.setDate(from.getDate() - 29);
      return { dateFrom: formatIsoDate(from), dateTo: todayIso };
    }
    case "thisWeek":
      return { dateFrom: formatIsoDate(weekStartLocal(now)), dateTo: todayIso };
    case "thisMonth": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { dateFrom: formatIsoDate(from), dateTo: formatIsoDate(to) };
    }
    case "lastMonth": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { dateFrom: formatIsoDate(from), dateTo: formatIsoDate(to) };
    }
    default:
      return { dateFrom: todayIso, dateTo: todayIso };
  }
}

export function inferPresetFromRange(
  dateFrom: string,
  dateTo: string,
  now = new Date(),
): DateRangePreset {
  if (!dateFrom && !dateTo) return "last7";
  const from = dateFrom.trim() || dateTo.trim();
  const to = dateTo.trim() || from;
  for (const { key } of DATE_RANGE_PRESET_OPTIONS) {
    if (key === "custom") continue;
    const r = resolveDateRangeFromPreset(key, now);
    if (r.dateFrom === from && r.dateTo === to) return key;
  }
  return "custom";
}

export function listIsoDatesInRange(dateFrom: string, dateTo: string): string[] {
  if (!ISO_DATE_RE.test(dateFrom) || !ISO_DATE_RE.test(dateTo)) return [];
  const out: string[] = [];
  const cur = new Date(`${dateFrom}T12:00:00`);
  const end = new Date(`${dateTo}T12:00:00`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return [];
  while (cur <= end) {
    out.push(formatIsoDate(cur));
    cur.setDate(cur.getDate() + 1);
    if (out.length > 366) break;
  }
  return out;
}

/** Client-side due-date filter for work queue (no API change). */
export function dueDateInPreset(
  dueDate: string | null | undefined,
  preset: DateFilterPreset,
  now = new Date(),
): boolean {
  if (preset === "all") return true;
  const due = parseDueDate(dueDate);
  if (!due) return false;

  const range = resolveDateRangeFromPreset(preset, now);
  const start = new Date(`${range.dateFrom}T00:00:00`);
  const end = endOfLocalDay(new Date(`${range.dateTo}T12:00:00`));
  return due >= start && due <= end;
}

export function readDateFilterFromSearch(
  search: string,
  fallback: DateRangePreset,
): { preset: DateRangePreset; dateFrom: string; dateTo: string } {
  const params = new URLSearchParams(search);
  const presetRaw = params.get("date_preset") as DateRangePreset | null;
  const preset =
    presetRaw && DATE_RANGE_PRESET_OPTIONS.some((o) => o.key === presetRaw)
      ? presetRaw
      : fallback;
  const customFrom = params.get("date_from") ?? "";
  const customTo = params.get("date_to") ?? "";
  if (preset === "custom" && customFrom && customTo) {
    return { preset, dateFrom: customFrom, dateTo: customTo };
  }
  const resolved = resolveDateRangeFromPreset(preset);
  return { preset, ...resolved };
}

export function writeDateFilterToSearch(
  search: string,
  preset: DateRangePreset,
  range: ResolvedDateRange,
): string {
  const params = new URLSearchParams(search);
  params.set("date_preset", preset);
  if (preset === "custom") {
    params.set("date_from", range.dateFrom);
    params.set("date_to", range.dateTo);
  } else {
    params.delete("date_from");
    params.delete("date_to");
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function loadDateFilterStorage(
  storageKey: string,
  fallback: DateRangePreset,
): { preset: DateRangePreset; dateFrom: string; dateTo: string } | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      preset?: DateRangePreset;
      dateFrom?: string;
      dateTo?: string;
    };
    const preset = parsed.preset ?? fallback;
    if (preset === "custom" && parsed.dateFrom && parsed.dateTo) {
      return { preset, dateFrom: parsed.dateFrom, dateTo: parsed.dateTo };
    }
    if (DATE_RANGE_PRESET_OPTIONS.some((o) => o.key === preset && o.key !== "custom")) {
      return { preset, ...resolveDateRangeFromPreset(preset) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveDateFilterStorage(
  storageKey: string,
  preset: DateRangePreset,
  range: ResolvedDateRange,
): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ preset, ...range }));
  } catch {
    /* ignore */
  }
}
