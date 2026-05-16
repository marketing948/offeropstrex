// Phase 6b — VoluumCampaignTagInvalid rule.
//
// Spec (Automation Bible §9): a Voluum campaign whose tags do not
// satisfy the tracker-campaign tag contract is non-importable. The
// engine surfaces this to the workspace's admins via an INVALID_TAG
// in-app notification (warning severity) so the offending tag can be
// fixed at the source. The producer (sync.ts) is responsible for
// setting an appropriate `dedupeKey` so re-syncs do not flood the
// inbox; this rule emits one notification per admin per emitted event.
//
// If the workspace has no admins (a fresh workspace, or one whose
// admin assignments were revoked), no notifications are produced.

import type { Action, EventInput, Tx } from "../types.ts";
import { getWorkspaceAdminEmployeeIds } from "../lib/admins.ts";

type VoluumCampaignTagInvalidEvent = Extract<
  EventInput,
  { type: "VoluumCampaignTagInvalid" }
>;

const REASON_LABEL: Record<
  VoluumCampaignTagInvalidEvent["payload"]["reason"],
  string
> = {
  missing_tag: "no tag set",
  invalid_tag_format: "tag does not match the tracker-campaign format",
  unknown_affiliate_initials: "unknown affiliate initials",
  invalid_geo: "invalid GEO code",
  invalid_batch_number: "invalid batch number",
};

export async function handleVoluumCampaignTagInvalid(
  event: VoluumCampaignTagInvalidEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;
  const adminIds = await getWorkspaceAdminEmployeeIds(tx, workspaceId);
  if (adminIds.length === 0) return [];

  const message =
    `Voluum campaign "${payload.voluumCampaignName}" cannot be imported: ` +
    `${REASON_LABEL[payload.reason]}` +
    (payload.offendingTag ? ` (tag: \`${payload.offendingTag}\`).` : ".");

  return adminIds.map((employeeId) => ({
    type: "CreateNotification" as const,
    workspaceId,
    data: {
      employeeId,
      batchId: null,
      type: "INVALID_TAG" as const,
      severity: "warning" as const,
      message,
    },
  }));
}
