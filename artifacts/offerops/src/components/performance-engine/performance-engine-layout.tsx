import { Link, useLocation } from "wouter";
import {
  Trophy,
  LayoutDashboard,
  Target,
  Zap,
  Crown,
  Shield,
  BadgeDollarSign,
  History,
  Settings,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { InitialsBadge } from "@/components/performance-engine/initials-badge";
import { CurrentRankCard } from "@/components/performance-engine/current-rank-card";
import { useCurrentRank } from "@/lib/performance-engine/use-current-rank";

const NAV = [
  { href: "/performance/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/performance/monthly-goals", label: "Monthly Goals", icon: Target },
  { href: "/performance/xp-rules", label: "XP Rules", icon: Zap },
  { href: "/performance/ranks", label: "Ranks & Bonuses", icon: Crown },
  { href: "/performance/penalties", label: "Penalty Rules", icon: Shield },
  { href: "/performance/bonus-events", label: "Bonus Events", icon: BadgeDollarSign },
  { href: "/performance/audit", label: "Audit Log", icon: History },
  { href: "/performance/settings", label: "Settings", icon: Settings },
] as const;

function workerInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function PerformanceEngineLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { currentEmployee } = useAuth();
  const rankData = useCurrentRank();

  return (
    <div className="flex min-h-0 flex-1 w-full min-w-0">
      <aside className="w-56 shrink-0 border-r bg-slate-50/80 flex flex-col min-h-0 self-stretch overflow-y-auto">
        <div className="px-4 py-4 border-b flex items-center gap-2">
          <Trophy size={20} className="text-blue-600" />
          <span className="font-bold text-sm">Performance Engine</span>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map((item) => {
            const active = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-600 text-white"
                    : "text-muted-foreground hover:bg-white hover:text-foreground"
                }`}
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t space-y-3">
          <CurrentRankCard
            variant="sidebar"
            rank={rankData.rank}
            nextRank={rankData.nextRank}
            myXp={rankData.myXp}
            progressToNext={rankData.progressToNext}
            xpReady={rankData.xpReady}
          />

          {currentEmployee && (
            <div className="flex items-center gap-2 px-1">
              <InitialsBadge initials={workerInitials(currentEmployee.name)} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate">{currentEmployee.name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{currentEmployee.role}</p>
              </div>
              <ChevronDown size={14} className="text-muted-foreground shrink-0" />
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 min-w-0 bg-background">{children}</div>
    </div>
  );
}
