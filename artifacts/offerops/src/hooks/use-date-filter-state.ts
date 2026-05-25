import { useCallback, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  inferPresetFromRange,
  loadDateFilterStorage,
  readDateFilterFromSearch,
  resolveDateRangeFromPreset,
  saveDateFilterStorage,
  writeDateFilterToSearch,
  type DateRangePreset,
  type ResolvedDateRange,
} from "@/lib/date-filter-presets";

type Options = {
  storageKey: string;
  defaultPreset: DateRangePreset;
  /** Sync date_preset / date_from / date_to to the URL for deep links. */
  syncUrl?: boolean;
};

export function useDateFilterState({
  storageKey,
  defaultPreset,
  syncUrl = true,
}: Options) {
  const [location, setLocation] = useLocation();

  const initial = useMemo(() => {
    if (syncUrl && typeof window !== "undefined") {
      const fromUrl = readDateFilterFromSearch(window.location.search, defaultPreset);
      if (
        window.location.search.includes("date_preset") ||
        window.location.search.includes("date_from")
      ) {
        return fromUrl;
      }
    }
    const stored = loadDateFilterStorage(storageKey, defaultPreset);
    if (stored) return stored;
    return { preset: defaultPreset, ...resolveDateRangeFromPreset(defaultPreset) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount init only
  }, []);

  const [preset, setPreset] = useState<DateRangePreset>(initial.preset);
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);

  const range: ResolvedDateRange = useMemo(
    () => ({ dateFrom, dateTo }),
    [dateFrom, dateTo],
  );

  const persist = useCallback(
    (nextPreset: DateRangePreset, nextRange: ResolvedDateRange) => {
      setPreset(nextPreset);
      setDateFrom(nextRange.dateFrom);
      setDateTo(nextRange.dateTo);
      saveDateFilterStorage(storageKey, nextPreset, nextRange);
      if (syncUrl && typeof window !== "undefined") {
        const path = location.split("?")[0] || location;
        const nextSearch = writeDateFilterToSearch(window.location.search, nextPreset, nextRange);
        setLocation(`${path}${nextSearch}`, { replace: true });
      }
    },
    [storageKey, syncUrl, location, setLocation],
  );

  const setPresetAndResolve = useCallback(
    (next: DateRangePreset) => {
      if (next === "custom") {
        persist("custom", { dateFrom, dateTo });
        return;
      }
      persist(next, resolveDateRangeFromPreset(next));
    },
    [persist, dateFrom, dateTo],
  );

  const setCustomRange = useCallback(
    (from: string, to: string) => {
      const dateFromNorm = from.trim();
      const dateToNorm = (to.trim() || from).trim();
      const next = {
        dateFrom: dateFromNorm,
        dateTo: dateToNorm >= dateFromNorm ? dateToNorm : dateFromNorm,
      };
      persist("custom", next);
    },
    [persist],
  );

  const clearToDefault = useCallback(() => {
    persist(defaultPreset, resolveDateRangeFromPreset(defaultPreset));
  }, [persist, defaultPreset]);

  return {
    preset,
    dateFrom,
    dateTo,
    range,
    setPreset: setPresetAndResolve,
    setCustomRange,
    clearToDefault,
    inferredPreset: inferPresetFromRange(dateFrom, dateTo),
  };
}
