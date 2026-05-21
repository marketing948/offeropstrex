import { useMemo } from "react";
import { wsQueryOpts } from "@/lib/ws-query";
import {
  useListEmployees, useListTestingBatches, useListOffers, useListTodoTasks,
  getListTestingBatchesQueryKey, getListOffersQueryKey, getListTodoTasksQueryKey, getListEmployeesQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace-context";
import {
  useGoalsConfig, computeScores, getRankForScore, getNextRank,
  RANK_COLORS, DEFAULT_CONFIG,
} from "@/lib/goals-config";
import type { EmployeeScores } from "@/lib/goals-config";
import {
  EXP_POINTS_THIS_MONTH,
  expComboReward,
  expLeaderboardTotal,
  expRankThreshold,
} from "@/lib/exp-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Trophy, Star, Target, TrendingUp, Zap, Crown, Award, BarChart3, User,
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
  Target, Star, TrendingUp, Zap, Crown, Trophy, Award,
};

function ProgressBar({ label, value, max, color = "bg-primary", sub }: {
  label: string; value: number; max: number; color?: string; sub?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          {value} / {max} <span className="font-semibold text-foreground">({pct}%)</span>
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ScoreBreakdown({ score }: { score: EmployeeScores }) {
  const cats = [
    { label: "Activity", val: score.activityRaw, w: 0.40, cls: "text-blue-700 bg-blue-50 border-blue-200" },
    { label: "Winners", val: score.winnerRaw, w: 0.35, cls: "text-green-700 bg-green-50 border-green-200" },
    { label: "Optimization", val: score.optimizationRaw, w: 0.15, cls: "text-orange-700 bg-orange-50 border-orange-200" },
    { label: "Discipline", val: score.disciplineRaw, w: 0.10, cls: "text-purple-700 bg-purple-50 border-purple-200" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {cats.map(c => (
        <div key={c.label} className={`rounded-lg border px-3 py-2.5 ${c.cls}`}>
          <p className="text-xs font-semibold opacity-80">{c.label}</p>
          <p className="text-xl font-black">{Math.round(c.val * c.w)}</p>
          <p className="text-[10px] opacity-60">raw {c.val} × {(c.w * 100).toFixed(0)}%</p>
        </div>
      ))}
    </div>
  );
}

export default function Profile() {
  const { currentEmployee } = useAuth();
  const isAdmin = currentEmployee?.role === "admin";
  const { data: cfgRaw } = useGoalsConfig();
  const cfg = cfgRaw ?? DEFAULT_CONFIG;

  const { activeWorkspaceId } = useWorkspace();
  const wsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const { data: employees = [] } = useListEmployees(wsParams, wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(wsParams)));
  const { data: batches = [] } = useListTestingBatches(wsParams, wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(wsParams)));
  const { data: offers = [] } = useListOffers(wsParams, wsQueryOpts(activeWorkspaceId, getListOffersQueryKey(wsParams)));
  const { data: tasks = [] } = useListTodoTasks(wsParams, wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(wsParams)));

  const scores = useMemo(
    () => computeScores(employees, batches, offers, tasks, cfg),
    [employees, batches, offers, tasks, cfg]
  );

  const myScore = scores.find(s => s.employeeId === currentEmployee?.id);
  const myRank = myScore ? getRankForScore(myScore.total, cfg) : null;
  const myNextRank = myRank ? getNextRank(myRank, cfg) : null;
  const myColors = myRank ? (RANK_COLORS[myRank.color] ?? RANK_COLORS.slate) : RANK_COLORS.slate;
  const MyIcon = myRank ? (ICON_MAP[myRank.icon] ?? Target) : Target;
  const sortedRanks = [...cfg.ranks].sort((a, b) => a.minScore - b.minScore);
  const kpiTargets = cfg.kpiTargets;
  const myLeaderboardPos = scores.findIndex(s => s.employeeId === currentEmployee?.id) + 1;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black flex-shrink-0"
          style={{ background: "hsl(var(--sidebar-primary))", color: "hsl(var(--sidebar-primary-foreground))" }}
        >
          {currentEmployee?.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{currentEmployee?.name}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-sm text-muted-foreground capitalize">{currentEmployee?.role}</span>
            {myRank && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className={`text-sm font-semibold ${myColors.text}`}>{myRank.name}</span>
              </>
            )}
            {myLeaderboardPos > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-sm text-muted-foreground">#{myLeaderboardPos} on leaderboard</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Score Card */}
      {myScore && myRank && (
        <Card className={`border-2 ${myColors.border} shadow-sm`}>
          <CardContent className="p-5">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${myColors.bg} flex-shrink-0`}>
                  <MyIcon size={30} className={myColors.text} />
                </div>
                <div>
                  <p className={`text-xs font-bold uppercase tracking-widest ${myColors.text}`}>{myRank.name}</p>
                  <p className="text-4xl font-black leading-none">{myScore.total.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{EXP_POINTS_THIS_MONTH}</p>
                </div>
              </div>

              {myNextRank ? (
                <div className="flex-1 min-w-[180px]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Next rank</span>
                    <span className={`text-xs font-bold ${(RANK_COLORS[myNextRank.color] ?? RANK_COLORS.slate).text}`}>
                      {myNextRank.name}
                    </span>
                  </div>
                  <div className="h-3 rounded-full bg-muted overflow-hidden">
                    {(() => {
                      const pct = Math.min(100, Math.round(
                        ((myScore.total - myRank.minScore) / (myNextRank.minScore - myRank.minScore)) * 100
                      ));
                      return <div className="h-full rounded-full transition-all bg-primary" style={{ width: `${pct}%` }} />;
                    })()}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    <span className="font-semibold text-foreground">{(myNextRank.minScore - myScore.total).toLocaleString()}</span>{" "}
                    EXP Points to {myNextRank.name}
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-purple-100 text-purple-700">
                  <Crown size={16} /><span className="text-sm font-bold">Max Rank!</span>
                </div>
              )}
            </div>
            <div className="mt-4"><ScoreBreakdown score={myScore} /></div>
            {myScore.earnedCombos.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {myScore.earnedCombos.map(n => (
                  <span key={n} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                    <Star size={10} /> {n}
                  </span>
                ))}
              </div>
            )}
            {myScore.comboBonus > 0 && (
              <p className="text-xs text-amber-700 mt-1.5 font-medium">+{myScore.comboBonus} combo EXP bonus included</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* KPI Progress */}
        {myScore && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target size={15} className="text-muted-foreground" /> KPI Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {kpiTargets.map((kt, i) => {
                const val = myScore[kt.key as keyof EmployeeScores] as number ?? 0;
                const colors = ["bg-blue-500","bg-green-500","bg-orange-500","bg-yellow-500","bg-purple-500","bg-pink-500"];
                return (
                  <ProgressBar
                    key={kt.id}
                    label={kt.name}
                    value={val}
                    max={kt.monthlyTarget}
                    color={colors[i % colors.length]}
                    sub={val >= kt.monthlyTarget ? "🏆 Target reached!" : undefined}
                  />
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Leaderboard */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy size={15} className="text-muted-foreground" /> Team Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {scores.slice(0, 8).map((s, i) => {
                const rank = getRankForScore(s.total, cfg);
                const col = RANK_COLORS[rank.color] ?? RANK_COLORS.slate;
                const isMe = s.employeeId === currentEmployee?.id;
                const medals = ["🥇","🥈","🥉"];
                return (
                  <div key={s.employeeId} className={`flex items-center gap-3 px-4 py-3 ${isMe ? "bg-primary/5" : "hover:bg-muted/30"} transition-colors`}>
                    <span className="text-sm font-bold w-6 text-center text-muted-foreground">
                      {i < 3 ? medals[i] : `${i+1}`}
                    </span>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${col.bg} ${col.text}`}>
                      {s.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-medium ${isMe ? "text-primary font-bold" : ""}`}>{s.name}</span>
                        {isMe && <span className="text-[10px] text-primary font-bold">(you)</span>}
                      </div>
                      <span className={`text-[10px] font-semibold ${col.text}`}>{rank.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{expLeaderboardTotal(s.total)}</p>
                      <p className="text-[10px] text-muted-foreground">{s.winners}W · {s.scaleTasks} scaled</p>
                    </div>
                  </div>
                );
              })}
              {scores.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No scores yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Combo Bonuses */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap size={15} className="text-amber-500" /> Combo Bonuses
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cfg.comboBonuses.filter(cb => cb.active).map(cb => {
              const earned = myScore?.earnedCombos.includes(cb.name);
              return (
                <div key={cb.id} className={`rounded-lg border p-3 ${earned ? "border-amber-300 bg-amber-50" : "border-border bg-card"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm font-semibold ${earned ? "text-amber-800" : ""}`}>{cb.name}</span>
                    <span className={`text-xs font-bold ${earned ? "text-amber-700" : "text-primary"}`}>{expComboReward(cb.rewardPoints)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{cb.description}</p>
                  {earned && <p className="text-xs font-semibold text-amber-700 mt-1.5 flex items-center gap-1"><Star size={10} /> Earned!</p>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Rank Tiers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Award size={15} className="text-muted-foreground" /> Rank Tiers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {sortedRanks.map(r => {
              const col = RANK_COLORS[r.color] ?? RANK_COLORS.slate;
              const Ic = ICON_MAP[r.icon] ?? Target;
              const isCurrent = myRank?.id === r.id;
              return (
                <div key={r.id} className={`rounded-lg border text-center p-3 ${isCurrent ? `${col.border} border-2 ${col.bg}` : "border-border bg-muted/20"}`}>
                  <Ic size={20} className={`mx-auto mb-1 ${col.text}`} />
                  <p className={`text-xs font-bold ${col.text}`}>{r.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{expRankThreshold(r.minScore)}</p>
                  {isCurrent && <p className="text-[10px] font-bold text-primary mt-1">← You</p>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Admin-only: Bonus Payout Overview */}
      {isAdmin && scores.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 size={15} className="text-muted-foreground" /> Bonus Payout Overview
              <span className="ml-auto text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Admin only</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-muted/30">
                  <tr>
                    {["Employee","Score","Rank","Batches","Winners","Scale","Opts","Combo EXP","Projected $"].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {scores.map(s => {
                    const rank = getRankForScore(s.total, cfg);
                    const col = RANK_COLORS[rank.color] ?? RANK_COLORS.slate;
                    return (
                      <tr key={s.employeeId} className="hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${col.bg} ${col.text}`}>
                              {s.name.charAt(0)}
                            </div>
                            <span className="text-sm font-medium">{s.name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-sm font-bold">{s.total.toLocaleString()}</td>
                        <td className="py-2.5 px-3">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${col.bg} ${col.text}`}>{rank.name}</span>
                        </td>
                        <td className="py-2.5 px-3 text-sm text-center text-muted-foreground">{s.batches}</td>
                        <td className="py-2.5 px-3 text-sm text-center font-semibold text-green-700">{s.winners || "—"}</td>
                        <td className="py-2.5 px-3 text-sm text-center font-semibold text-purple-700">{s.scaleTasks || "—"}</td>
                        <td className="py-2.5 px-3 text-sm text-center text-muted-foreground">{s.optimizations}</td>
                        <td className="py-2.5 px-3 text-sm text-center">
                          {s.comboBonus > 0 ? <span className="text-amber-700 font-semibold">+{s.comboBonus}</span> : "—"}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`text-sm font-bold ${rank.bonusAmount > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                            {rank.bonusAmount > 0 ? `$${rank.bonusAmount}` : "No bonus"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/30 font-bold">
                    <td colSpan={8} className="py-2.5 px-3 text-sm">Total Projected Payout</td>
                    <td className="py-2.5 px-3 text-sm text-green-600 font-black">
                      ${scores.reduce((acc, s) => acc + getRankForScore(s.total, cfg).bonusAmount, 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Profile info card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User size={15} className="text-muted-foreground" /> Account Info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between py-1.5 border-b">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{currentEmployee?.name}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{currentEmployee?.email}</span>
          </div>
          <div className="flex justify-between py-1.5">
            <span className="text-muted-foreground">Role</span>
            <span className="font-medium capitalize">{currentEmployee?.role}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
