import type { Request, Response } from "express";
import { requireWorkspaceAccess } from "./workspace-access.ts";
import { parseWorkspaceIdFromBody } from "./parse-workspace-id.ts";

export { parseWorkspaceIdFromBody } from "./parse-workspace-id.ts";

/**
 * Validate `workspaceId` from the request body and run the access check.
 * On any failure, sends the appropriate HTTP error response and returns null.
 * On success, returns the validated workspaceId.
 *
 * Use in POST/PATCH/PUT routes whose body must carry an explicit workspaceId.
 * Together with `requireWorkspaceFromQuery` (workspace-access.ts), every
 * domain INSERT in the codebase has a single chokepoint that proves the
 * caller is authorized for the targeted workspace.
 */
export async function requireWorkspaceFromBody(
  req: Request,
  res: Response,
): Promise<number | null> {
  const parsed = parseWorkspaceIdFromBody(req.body);
  if (!parsed.ok) {
    res.status(parsed.status).json({ error: parsed.error });
    return null;
  }
  return requireWorkspaceAccess(req, res, parsed.id);
}

export { requireWorkspaceAccess, requireWorkspaceFromQuery, requireAdmin } from "./workspace-access.ts";
