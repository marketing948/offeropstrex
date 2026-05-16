import type { QueryKey } from "@tanstack/react-query";

/**
 * Typed helpers for passing partial TanStack Query options to
 * orval-generated hooks.
 *
 * Orval generates `useFoo(params, options?: { query?: UseQueryOptions<...> })`
 * where `query.queryKey` is required. Passing an object without `queryKey`
 * fails type-checking, so consumers must supply the matching
 * `getFooQueryKey(params)` to pair with `enabled`, `refetchInterval`, etc.
 *
 * These helpers are generic over `QueryKey`, so the hook's full type
 * inference (including `data`) is preserved at every call site with no
 * `any` casts.
 */

export type PartialQueryOpts = {
  enabled?: boolean;
  refetchInterval?: number | false;
  staleTime?: number;
};

/**
 * Build hook options that gate the query on `workspaceId` being set.
 * Caller passes the orval-generated queryKey (e.g. `getFooQueryKey(params)`).
 */
export function wsQueryOpts<K extends QueryKey>(
  workspaceId: number | null | undefined,
  queryKey: K,
  extra?: PartialQueryOpts,
): { query: { queryKey: K; enabled: boolean } & PartialQueryOpts } {
  return { query: { queryKey, enabled: !!workspaceId, ...extra } };
}

/**
 * Build hook options with arbitrary partial query options (no workspace gate).
 * Caller passes the orval-generated queryKey.
 */
export function queryOpts<K extends QueryKey>(
  queryKey: K,
  opts: PartialQueryOpts,
): { query: { queryKey: K } & PartialQueryOpts } {
  return { query: { queryKey, ...opts } };
}
