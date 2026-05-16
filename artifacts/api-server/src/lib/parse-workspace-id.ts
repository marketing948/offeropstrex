export type WorkspaceIdParseResult =
  | { ok: true; id: number }
  | { ok: false; status: number; error: string };

/**
 * Pure parser for `workspaceId` (or snake_case alias) from a request body.
 * No DB / auth side effects so it can be unit-tested in isolation.
 *
 * Used by `requireWorkspaceFromBody` (require-workspace.ts), which adds the
 * Express response handling and the workspace-access check on top.
 */
export function parseWorkspaceIdFromBody(body: unknown): WorkspaceIdParseResult {
  const obj = (body ?? {}) as Record<string, unknown>;
  const raw = obj.workspaceId ?? obj.workspace_id;
  if (raw === undefined || raw === null || raw === "") {
    return { ok: false, status: 400, error: "workspaceId is required in request body" };
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, status: 400, error: "workspaceId must be a positive integer" };
  }
  return { ok: true, id };
}
