import { authedJson } from "@/lib/api-fetch";

/** Mirrors GET /api/operational-activity (not yet in OpenAPI). */
export const OPERATIONAL_ACTIVITY_EVENT_TYPES = [
  "task_completed",
  "campaign_created",
  "campaign_linked",
  "campaign_live",
  "manual_metrics_submitted",
  "voluum_metrics_imported",
  "campaign_closed",
  "winner_added",
  "winner_promoted",
] as const;

export type OperationalActivityEventType = (typeof OPERATIONAL_ACTIVITY_EVENT_TYPES)[number];

export type OperationalActivityItem = {
  id: number;
  workspaceId: number;
  eventType: string;
  entityType: string;
  entityId: string;
  actorEmployeeId: number | null;
  title: string;
  description: string | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: string;
};

export type OperationalActivityResponse = {
  date: string;
  items: OperationalActivityItem[];
};

export const OPERATIONAL_ACTIVITY_EVENT_LABELS: Record<OperationalActivityEventType, string> = {
  task_completed: "Task completed",
  campaign_created: "Campaign created",
  campaign_linked: "Campaign linked",
  campaign_live: "Campaign live",
  manual_metrics_submitted: "Metrics submitted",
  voluum_metrics_imported: "Voluum CSV import",
  campaign_closed: "Campaign closed",
  winner_added: "Winner added",
  winner_promoted: "Winner promoted",
};

function apiBase(): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
}

export function getOperationalActivityQueryKey(params: {
  workspace_id: number;
  date: string;
  event_type?: string;
  actor_employee_id?: number;
}) {
  return ["operational-activity", params] as const;
}

export async function fetchOperationalActivity(params: {
  workspace_id: number;
  date: string;
  event_type?: string;
  actor_employee_id?: number;
  limit?: number;
}): Promise<OperationalActivityResponse> {
  const sp = new URLSearchParams();
  sp.set("workspace_id", String(params.workspace_id));
  sp.set("date", params.date);
  if (params.event_type) sp.set("event_type", params.event_type);
  if (params.actor_employee_id != null) {
    sp.set("actor_employee_id", String(params.actor_employee_id));
  }
  if (params.limit != null) sp.set("limit", String(params.limit));
  return authedJson<OperationalActivityResponse>(`${apiBase()}/operational-activity?${sp.toString()}`);
}

export function formatActivityTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatEntityRef(entityType: string, entityId: string): string {
  const label = entityType.replace(/_/g, " ");
  return `${label} · ${entityId}`;
}
