import { useQuery } from "@tanstack/react-query";
import { DEFAULT_ALERT_RULES, mergeAlertRules, type AlertRulesConfig } from "@workspace/alert-rules";
import { authedJson } from "@/lib/api-fetch";
import { useWorkspace } from "@/lib/workspace-context";

export function alertRulesQueryKey(workspaceId: number) {
  return ["alert-rules", workspaceId] as const;
}

export type UseAlertRulesOptions = {
  /**
   * When true (default), failed fetches return DEFAULT_ALERT_RULES for heuristics.
   * Settings UI should pass false so errors surface with retry.
   */
  fallbackOnError?: boolean;
};

/** Single-workspace product label when the API name is missing. */
export function workspaceConfigLabel(workspace: { name: string } | null | undefined): string {
  const name = workspace?.name?.trim();
  return name ? name : "Default Workspace";
}

export function useAlertRules(options: UseAlertRulesOptions = {}) {
  const { fallbackOnError = true } = options;
  const { activeWorkspaceId, activeWorkspace, isLoading: isWorkspaceLoading } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;
  const workspaceReady = !!activeWorkspaceId;
  const workspaceUnavailable = !isWorkspaceLoading && !workspaceReady;

  const query = useQuery({
    queryKey: alertRulesQueryKey(wsId),
    enabled: workspaceReady,
    staleTime: 60_000,
    placeholderData: DEFAULT_ALERT_RULES,
    queryFn: async (): Promise<AlertRulesConfig> => {
      const raw = await authedJson<unknown>(
        `/api/settings/alert-rules?workspace_id=${wsId}`,
      );
      return mergeAlertRules(raw);
    },
  });

  // Consumer surfaces: keep silent fallback when fetch fails.
  const rules =
    query.isError && fallbackOnError
      ? DEFAULT_ALERT_RULES
      : (query.data ?? DEFAULT_ALERT_RULES);

  const isInitialLoad = workspaceReady && query.isPending && !query.isFetched;

  return {
    rules,
    workspaceId: activeWorkspaceId,
    workspaceLabel: workspaceConfigLabel(activeWorkspace),
    workspaceReady,
    workspaceUnavailable,
    isWorkspaceLoading,
    isLoading: isInitialLoad,
    isFetching: query.isFetching,
    isError: query.isError && !fallbackOnError,
    error: query.error,
    isFetched: query.isFetched,
    refetch: query.refetch,
  };
}
