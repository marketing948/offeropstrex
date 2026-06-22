import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { PerformanceEngineLayout } from "@/components/performance-engine/performance-engine-layout";
import { MonthlyGoalsPage } from "@/components/performance-engine/monthly-goals-page";
import AdminGoalsConfig from "@/pages/admin-goals-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Target, Zap, Crown, History } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { fetchMonthlyGoalsDashboard, currentMonthKey, formatMonthLabel } from "@/lib/performance-engine/api";

function OverviewPage() {
  const { activeWorkspaceId } = useWorkspace();
  const dashQ = useQuery({
    queryKey: ["pe-overview", activeWorkspaceId],
    enabled: !!activeWorkspaceId,
    queryFn: () => fetchMonthlyGoalsDashboard(activeWorkspaceId!, currentMonthKey()),
  });

  const month = formatMonthLabel(currentMonthKey());
  const workers = dashQ.data?.workers.length ?? 0;
  const onTrack = dashQ.data?.workers.filter((w) => w.status === "On track" || w.status === "Strong").length ?? 0;
  const behind = dashQ.data?.workers.filter((w) => w.status === "Behind").length ?? 0;
  const totalXp = dashQ.data?.leaderboard.reduce((s, r) => s + r.xp, 0) ?? 0;

  return (
    <div className="p-6 lg:p-8">
      <h1 className="text-2xl font-bold mb-2">Overview</h1>
      <p className="text-muted-foreground text-sm mb-6">Team performance snapshot for {month}.</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {[
          { label: "Workers tracked", value: workers },
          { label: "On track / strong", value: onTrack },
          { label: "Behind", value: behind },
          { label: "Team XP (month)", value: totalXp.toLocaleString() },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-medium">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {[
          { href: "/performance/monthly-goals", icon: Target, title: "Monthly Goals", desc: "Team dashboard & worker progress" },
          { href: "/performance/xp-rules", icon: Zap, title: "XP Rules", desc: "Action-based reward configuration" },
          { href: "/performance/ranks", icon: Crown, title: "Ranks & Bonuses", desc: "Rank tiers and combo bonuses" },
          { href: "/performance/audit", icon: History, title: "Audit Log", desc: "Goals config change history" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-xl border p-4 hover:bg-slate-50 transition-colors flex gap-3"
          >
            <item.icon className="text-blue-600 shrink-0" size={22} />
            <div>
              <p className="font-semibold">{item.title}</p>
              <p className="text-sm text-muted-foreground">{item.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PerformanceEngineRoutes() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (location === "/performance" || location === "/performance/") {
      setLocation("/performance/monthly-goals");
    }
  }, [location, setLocation]);

  return (
    <Switch>
      <Route path="/performance/overview" component={OverviewPage} />
      <Route path="/performance/monthly-goals" component={MonthlyGoalsPage} />
      <Route path="/performance/xp-rules">
        {() => (
          <div className="p-6 lg:p-8">
            <AdminGoalsConfig embedded allowedTabs={["points", "eventRules"]} initialTab="points" />
          </div>
        )}
      </Route>
      <Route path="/performance/ranks">
        {() => (
          <div className="p-6 lg:p-8">
            <AdminGoalsConfig embedded allowedTabs={["ranks", "combos"]} initialTab="ranks" />
          </div>
        )}
      </Route>
      <Route path="/performance/penalties">
        {() => (
          <div className="p-6 lg:p-8">
            <AdminGoalsConfig embedded allowedTabs={["penalties"]} initialTab="penalties" />
          </div>
        )}
      </Route>
      <Route path="/performance/bonus-events">
        {() => (
          <div className="p-6 lg:p-8">
            <AdminGoalsConfig embedded allowedTabs={["events"]} initialTab="events" />
          </div>
        )}
      </Route>
      <Route path="/performance/audit">
        {() => (
          <div className="p-6 lg:p-8">
            <AdminGoalsConfig embedded allowedTabs={["audit"]} initialTab="audit" />
          </div>
        )}
      </Route>
      <Route path="/performance/settings">
        {() => (
          <div className="p-6 lg:p-8">
            <AdminGoalsConfig embedded allowedTabs={["kpis"]} initialTab="kpis" />
          </div>
        )}
      </Route>
      <Route path="/performance/monthly-goals" component={MonthlyGoalsPage} />
    </Switch>
  );
}

export default function PerformanceEnginePage() {
  return (
    <PerformanceEngineLayout>
      <PerformanceEngineRoutes />
    </PerformanceEngineLayout>
  );
}
