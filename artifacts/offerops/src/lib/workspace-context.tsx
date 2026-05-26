import { createContext, useCallback, useContext } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetMyWorkspaces, getGetMyWorkspacesQueryKey } from "@workspace/api-client-react";
import { queryOpts } from "@/lib/ws-query";
import { readAuthToken } from "@/lib/api-fetch";

export type WorkspaceSummary = {
  id: number;
  name: string;
  isActive?: boolean;
  syncStatus?: string;
  lastSyncAt?: string | null;
  trafficSourcesSynced?: number;
  networksSynced?: number;
};

/** User-facing label for the current workspace (single-workspace product copy). */
export function workspaceConfigLabel(workspace: { name: string } | null | undefined): string {
  const name = workspace?.name?.trim();
  return name ? name : "Default Workspace";
}

interface WorkspaceContextValue {
  activeWorkspaceId: number | null;
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: WorkspaceSummary[];
  isLoading: boolean;
  workspaceReady: boolean;
  workspaceUnavailable: boolean;
  workspaceLabel: string;
  canSwitchWorkspace: boolean;
  switchWorkspace: (workspaceId: number) => void;
  isSwitchingWorkspace: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  activeWorkspaceId: null,
  activeWorkspace: null,
  availableWorkspaces: [],
  isLoading: true,
  workspaceReady: false,
  workspaceUnavailable: false,
  workspaceLabel: "Default Workspace",
  canSwitchWorkspace: false,
  switchWorkspace: () => {},
  isSwitchingWorkspace: false,
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data: workspaces, isLoading } = useGetMyWorkspaces(
    queryOpts(getGetMyWorkspacesQueryKey(), { refetchInterval: 30_000 }),
  );

  const availableWorkspaces = (workspaces ?? []) as WorkspaceSummary[];
  const activeWorkspace =
    availableWorkspaces.find((w) => w.isActive) ?? availableWorkspaces[0] ?? null;
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const workspaceReady = activeWorkspaceId != null;
  const workspaceUnavailable = !isLoading && !workspaceReady;
  const workspaceLabel = workspaceConfigLabel(activeWorkspace);
  const canSwitchWorkspace = availableWorkspaces.length > 1;

  const switchMutation = useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const token = readAuthToken();
      const baseUrl = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
      const res = await fetch(`${baseUrl}/workspaces/${id}/activate`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Activate failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetMyWorkspacesQueryKey() });
      void queryClient.invalidateQueries();
    },
  });

  const switchWorkspace = useCallback(
    (workspaceId: number) => {
      if (workspaceId === activeWorkspaceId) return;
      switchMutation.mutate({ id: workspaceId });
    },
    [activeWorkspaceId, switchMutation],
  );

  return (
    <WorkspaceContext.Provider
      value={{
        activeWorkspaceId,
        activeWorkspace,
        availableWorkspaces,
        isLoading,
        workspaceReady,
        workspaceUnavailable,
        workspaceLabel,
        canSwitchWorkspace,
        switchWorkspace,
        isSwitchingWorkspace: switchMutation.isPending,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
