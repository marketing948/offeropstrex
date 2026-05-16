import { createContext, useContext } from "react";
import { useGetMyWorkspaces, getGetMyWorkspacesQueryKey } from "@workspace/api-client-react";
import { queryOpts } from "@/lib/ws-query";

interface WorkspaceContextValue {
  activeWorkspaceId: number | null;
  activeWorkspace: { id: number; name: string } | null;
  isLoading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  activeWorkspaceId: null,
  activeWorkspace: null,
  isLoading: true,
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { data: workspaces, isLoading } = useGetMyWorkspaces(
    queryOpts(getGetMyWorkspacesQueryKey(), { refetchInterval: 30000 })
  );

  const activeWorkspace = workspaces?.find(w => w.isActive) ?? workspaces?.[0] ?? null;
  const activeWorkspaceId = activeWorkspace?.id ?? null;

  return (
    <WorkspaceContext.Provider value={{ activeWorkspaceId, activeWorkspace: activeWorkspace as WorkspaceContextValue["activeWorkspace"], isLoading }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
