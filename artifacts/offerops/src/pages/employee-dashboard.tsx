import { useGetEmployeeDashboardSummary, getGetEmployeeDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, FolderTree, Target } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function EmployeeDashboard() {
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const summaryParams = { workspace_id: activeWorkspaceId ?? 0, employee_id: currentEmployee?.id ?? 0 };
  const { data: summary, isLoading } = useGetEmployeeDashboardSummary(
    summaryParams,
    wsQueryOpts(activeWorkspaceId, getGetEmployeeDashboardSummaryQueryKey(summaryParams), { enabled: !!currentEmployee && !!activeWorkspaceId }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Operator Dashboard</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 border-border hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Tasks</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-16 bg-muted/50" /> : <div className="text-2xl font-bold">{summary?.openTasksCount || 0}</div>}
          </CardContent>
        </Card>
        
        <Card className="bg-card/50 border-border hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Recent Batches</CardTitle>
            <FolderTree className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-16 bg-muted/50" /> : <div className="text-2xl font-bold">{summary?.recentBatchesCount || 0}</div>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Weekly Goal Progress */}
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target size={18} className="text-primary" />
              Weekly Target
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full bg-muted/50" />
                <Skeleton className="h-12 w-full bg-muted/50" />
              </div>
            ) : summary?.weeklyGoal ? (
              <>
                <GoalProgressItem 
                  label="Batches Tested" 
                  current={summary.weeklyProgress?.batchesTested || 0} 
                  target={summary.weeklyGoal.targetBatchesTested || 0} 
                />
                <GoalProgressItem 
                  label="Main Campaigns" 
                  current={summary.weeklyProgress?.campaignsMovedToMain || 0} 
                  target={summary.weeklyGoal.targetCampaignsMovedToMain || 0} 
                />
              </>
            ) : (
              <div className="text-muted-foreground">No weekly target set.</div>
            )}
          </CardContent>
        </Card>

        {/* Monthly Goal Progress */}
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target size={18} className="text-primary" />
              Monthly Target
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full bg-muted/50" />
                <Skeleton className="h-12 w-full bg-muted/50" />
              </div>
            ) : summary?.monthlyGoal ? (
              <>
                <GoalProgressItem 
                  label="Batches Tested" 
                  current={summary.monthlyProgress?.batchesTested || 0} 
                  target={summary.monthlyGoal.targetBatchesTested || 0} 
                />
                <GoalProgressItem 
                  label="Main Campaigns" 
                  current={summary.monthlyProgress?.campaignsMovedToMain || 0} 
                  target={summary.monthlyGoal.targetCampaignsMovedToMain || 0} 
                />
              </>
            ) : (
              <div className="text-muted-foreground">No monthly target set.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function GoalProgressItem({ label, current, target }: { label: string, current: number, target: number }) {
  if (!target) return null;
  const percent = Math.min(100, Math.max(0, (current / target) * 100));
  
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{current} / {target}</span>
      </div>
      <Progress value={percent} className="h-2" />
    </div>
  );
}
