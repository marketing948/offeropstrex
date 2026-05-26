import { AlertTriangle } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/lib/workspace-context";

export function useWorkspaceSettingsScope() {
  const ctx = useWorkspace();
  return {
    wsId: ctx.activeWorkspaceId ?? 0,
    workspaceReady: ctx.workspaceReady,
    isWorkspaceLoading: ctx.isLoading,
    workspaceUnavailable: ctx.workspaceUnavailable,
    workspaceLabel: ctx.workspaceLabel,
    activeWorkspaceId: ctx.activeWorkspaceId,
    activeWorkspace: ctx.activeWorkspace,
  };
}

export function WorkspaceSettingsSkeleton({ sections = 2 }: { sections?: number }) {
  return (
    <div className="max-w-3xl space-y-4" aria-busy="true" aria-label="Loading workspace configuration">
      <Skeleton className="h-20 w-full rounded-lg" />
      {Array.from({ length: sections }, (_, i) => (
        <Skeleton key={i} className="h-36 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function WorkspaceUnavailableState() {
  return (
    <Card className="max-w-3xl border-dashed border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Workspace configuration unavailable
        </CardTitle>
        <CardDescription>
          Settings could not be loaded because no workspace is configured for your account. Contact
          an administrator to finish workspace setup.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

/** Standard gate for workspace-scoped Settings tabs. */
export function workspaceSettingsTabGate(scope: ReturnType<typeof useWorkspaceSettingsScope>) {
  if (scope.isWorkspaceLoading) {
    return { blocked: true as const, element: <WorkspaceSettingsSkeleton /> };
  }
  if (scope.workspaceUnavailable) {
    return { blocked: true as const, element: <WorkspaceUnavailableState /> };
  }
  return { blocked: false as const, element: null };
}
