/** Client-side routes for operational entities (no backend changes). */

export type EntityNavTarget = {
  entityType: string;
  entityId: string;
  route: string;
};

export function routeForEntity(entityType: string, entityId: string): string | null {
  const id = String(entityId ?? "").trim();
  if (!id) return null;

  switch (entityType) {
    case "task":
      return `/tasks`;
    case "batch":
      return `/testing-batches/${id}`;
    case "campaign":
      return `/live-campaigns`;
    case "workspace":
      return `/ops`;
    case "sync_preview":
      return `/settings`;
    default:
      return null;
  }
}

export type NotificationLike = {
  type: string;
  batchId?: number | null;
  /** Optional future fields — safe to omit; invalid values are ignored. */
  entityType?: string | null;
  entityId?: string | number | null;
  route?: string | null;
};

function isValidInAppRoute(route: unknown): route is string {
  return (
    typeof route === "string" &&
    route.startsWith("/") &&
    !route.startsWith("//") &&
    route.length > 1
  );
}

function isValidBatchId(batchId: unknown): batchId is number {
  return typeof batchId === "number" && Number.isFinite(batchId) && batchId > 0;
}

/**
 * Resolve a notification click target. Always returns a safe in-app path
 * (never null/empty). Missing entityType, entityId, or route falls back to
 * batchId, notification type, then /ops.
 */
export function routeForNotification(n: NotificationLike): string {
  if (isValidInAppRoute(n.route)) {
    return n.route;
  }

  const entityType = String(n.entityType ?? "").trim();
  const entityId = n.entityId != null ? String(n.entityId).trim() : "";
  if (entityType && entityId) {
    const fromEntity = routeForEntity(entityType, entityId);
    if (fromEntity) return fromEntity;
  }

  if (isValidBatchId(n.batchId)) {
    return `/testing-batches/${n.batchId}`;
  }

  if (n.type === "TASK_OVERDUE") {
    return "/tasks";
  }
  if (n.type === "API_SYNC_FAILURE") {
    return "/settings";
  }

  return "/ops";
}

export function entityNavTarget(
  entityType: string,
  entityId: string,
): EntityNavTarget | null {
  const route = routeForEntity(entityType, entityId);
  if (!route) return null;
  return { entityType, entityId: String(entityId), route };
}
