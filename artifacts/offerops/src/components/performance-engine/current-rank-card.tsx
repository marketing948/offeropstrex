import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import type { RankTier } from "@/lib/goals-config";
import { RANK_COLORS } from "@/lib/goals-config";
import { rankIconFor } from "@/components/performance-engine/rank-icons";

export function CurrentRankCard({
  rank,
  nextRank,
  myXp,
  progressToNext,
  xpReady,
}: {
  rank: RankTier | null;
  nextRank: RankTier | null;
  myXp: number;
  progressToNext: number;
  xpReady: boolean;
}) {
  const prevXpRef = useRef<number | null>(null);
  const [xpBurst, setXpBurst] = useState<{ delta: number; id: number } | null>(null);
  const [barWidth, setBarWidth] = useState(progressToNext);
  const RankIcon = rankIconFor(rank);
  const colors = rank ? (RANK_COLORS[rank.color] ?? RANK_COLORS.slate) : RANK_COLORS.slate;

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

  return (
    <div className="relative rounded-lg border bg-white p-3 text-xs shadow-sm overflow-visible">
      {xpBurst && (
        <span
          key={xpBurst.id}
          className="absolute -top-1 right-2 z-10 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 shadow-sm pe-xp-burst"
        >
          +{xpBurst.delta.toLocaleString()} XP
        </span>
      )}

      <div className="flex items-center gap-2 mb-1">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${colors.bg} ${colors.text}`}>
          <RankIcon size={14} strokeWidth={2.25} />
        </div>
        <p className="text-muted-foreground">Your Current Rank</p>
      </div>

      <p className={`font-bold ${colors.text}`}>{rank?.name ?? "Unranked"}</p>
      <p className="text-muted-foreground mt-1">
        {myXp.toLocaleString()}
        {nextRank ? ` / ${nextRank.minScore.toLocaleString()} XP` : " XP"}
      </p>
      <div className="h-1.5 rounded-full bg-slate-100 mt-2 overflow-hidden">
        <div
          className="h-full bg-purple-500 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <Link href="/performance/ranks" className="text-blue-600 hover:underline mt-2 inline-block">
        View all ranks
      </Link>

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
