import { useQuery } from "@tanstack/react-query";
import { DEFAULT_ALERT_RULES, mergeAlertRules, type AlertRulesConfig } from "@workspace/alert-rules";
import { authedJson } from "@/lib/api-fetch";
import { useWorkspace } from "@/lib/workspace-context";

export function alertRulesQueryKey(workspaceId: number) {
  return ["alert-rules", workspaceId] as const;
}

export function useAlertRules() {
  const { activeWorkspaceId } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;

  const query = useQuery({
    queryKey: alertRulesQueryKey(wsId),
    enabled: !!activeWorkspaceId,
    staleTime: 60_000,
    queryFn: async (): Promise<AlertRulesConfig> => {
      try {
        const raw = await authedJson<unknown>(
          `/api/settings/alert-rules?workspace_id=${wsId}`,
        );
        return mergeAlertRules(raw);
      } catch {
        return DEFAULT_ALERT_RULES;
      }
    },
  });

  return {
    rules: query.data ?? DEFAULT_ALERT_RULES,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
