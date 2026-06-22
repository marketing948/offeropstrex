import { useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import type { RankTier } from "@/lib/goals-config";
import { RANK_COLORS } from "@/lib/goals-config";
import { rankIconFor } from "@/components/performance-engine/rank-icons";

export function CurrentRankCard({
  rank,
  nextRank,
  myXp,
  progressToNext,
  xpReady,
  variant = "default",
  href = "/profile",
}: {
  rank: RankTier | null;
  nextRank: RankTier | null;
  myXp: number;
  progressToNext: number;
  xpReady: boolean;
  variant?: "default" | "sidebar" | "profile";
  href?: string;
}) {
  const prevXpRef = useRef<number | null>(null);
  const [xpBurst, setXpBurst] = useState<{ delta: number; id: number } | null>(null);
  const [barWidth, setBarWidth] = useState(progressToNext);
  const RankIcon = rankIconFor(rank);
  const colors = rank ? (RANK_COLORS[rank.color] ?? RANK_COLORS.slate) : RANK_COLORS.slate;
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!xpReady) return undefined;

    const prev = prevXpRef.current;
    if (prev === null) {
      prevXpRef.current = myXp;
      setBarWidth(progressToNext);
      return undefined;
    }

    if (myXp > prev) {
      const delta = myXp - prev;
      prevXpRef.current = myXp;
      setXpBurst({ delta, id: Date.now() });
      requestAnimationFrame(() => setBarWidth(progressToNext));
      const hide = window.setTimeout(() => setXpBurst(null), 2200);
      return () => window.clearTimeout(hide);
    }

    prevXpRef.current = myXp;
    setBarWidth(progressToNext);
    return undefined;
  }, [myXp, progressToNext, xpReady]);

  const isSidebar = variant === "sidebar";
  const isProfile = variant === "profile";
  const navigable = !isProfile;
  const shellClass = isSidebar
    ? "relative rounded-lg border p-3 text-xs overflow-visible cursor-pointer transition-colors hover:brightness-[1.02]"
    : isProfile
      ? "relative rounded-2xl border-2 p-5 overflow-visible shadow-sm"
      : "relative rounded-lg border bg-white p-3 text-xs shadow-sm overflow-visible cursor-pointer transition-shadow hover:shadow-md";
  const shellStyle = isSidebar
    ? {
        borderColor: "hsl(var(--sidebar-border))",
        background: "hsl(var(--sidebar-accent) / 0.35)",
      }
    : isProfile && rank
      ? { borderColor: `var(--tw-${rank.color}-200, hsl(var(--border)))` }
      : undefined;
  const labelClass = isSidebar
    ? "text-[hsl(var(--sidebar-foreground)/0.55)]"
    : "text-muted-foreground";
  const trackClass = isSidebar ? "bg-[hsl(var(--sidebar-foreground)/0.12)]" : "bg-slate-100";
  const titleSize = isProfile ? "text-4xl font-black" : "font-bold";
  const iconSize = isProfile ? 30 : 14;
  const iconBox = isProfile ? "w-16 h-16 rounded-2xl" : "h-7 w-7 rounded-md";

  return (
    <div
      className={shellClass}
      style={shellStyle}
      role={navigable ? "link" : undefined}
      tabIndex={navigable ? 0 : undefined}
      onClick={navigable ? () => setLocation(href) : undefined}
      onKeyDown={
        navigable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setLocation(href);
              }
            }
          : undefined
      }
    >
      {xpBurst && (
        <span
          key={xpBurst.id}
          className="absolute -top-1 right-2 z-10 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 shadow-sm pe-xp-burst"
        >
          +{xpBurst.delta.toLocaleString()} XP
        </span>
      )}

      <div className={`flex items-center ${isProfile ? "gap-4" : "gap-2"} mb-1`}>
        <div className={`flex ${iconBox} shrink-0 items-center justify-center ${colors.bg} ${colors.text}`}>
          <RankIcon size={iconSize} strokeWidth={2.25} />
        </div>
        <div>
          <p className={`text-xs font-bold uppercase tracking-widest ${colors.text}`}>
            {rank?.name ?? "Unranked"}
          </p>
          {!isProfile && <p className={labelClass}>Your Current Rank</p>}
        </div>
      </div>

      {!isProfile && <p className={`font-bold ${colors.text}`}>{rank?.name ?? "Unranked"}</p>}
      <p className={`${isProfile ? titleSize : ""} ${labelClass} mt-1`}>
        <span className={isProfile ? "text-foreground" : ""}>{myXp.toLocaleString()}</span>
        {nextRank ? (
          <span className={isProfile ? " text-muted-foreground text-base font-normal" : ""}>
            {isProfile ? " / " : " / "}
            {nextRank.minScore.toLocaleString()} XP
          </span>
        ) : (
          " XP"
        )}
      </p>
      <div className={`${isProfile ? "h-3" : "h-1.5"} rounded-full ${trackClass} mt-2 overflow-hidden`}>
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${isProfile ? "bg-primary" : "bg-purple-500"}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      {isProfile && nextRank && (
        <p className="text-xs text-muted-foreground mt-2">
          <span className="font-semibold text-foreground">
            {(nextRank.minScore - myXp).toLocaleString()}
          </span>{" "}
          XP to {nextRank.name}
        </p>
      )}

      <style>{`
        @keyframes pe-xp-burst {
          0% { opacity: 0; transform: translateY(6px) scale(0.95); }
          15% { opacity: 1; transform: translateY(0) scale(1); }
          75% { opacity: 1; transform: translateY(-4px) scale(1); }
          100% { opacity: 0; transform: translateY(-10px) scale(0.98); }
        }
        .pe-xp-burst { animation: pe-xp-burst 2.2s ease-out forwards; }
      `}</style>
    </div>
  );
}
