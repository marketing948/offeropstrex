/**
 * Canonical GEO display — the normalized country code shown exactly once.
 *
 * Deliberately NOT a regional-indicator flag emoji: those fall back to the two
 * ASCII code letters on Windows/Linux, which visually duplicates the code
 * ("US US"). This renders a clean code-only pill; the code text appears once in
 * the DOM. No new flag dependency is introduced.
 */

import { geoCodeText } from "@/lib/geo-flag";
import { cn } from "@/lib/utils";

export function GeoCodeLabel({
  geo,
  className,
}: {
  geo: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-700 tabular-nums",
        className,
      )}
    >
      {geoCodeText(geo)}
    </span>
  );
}
