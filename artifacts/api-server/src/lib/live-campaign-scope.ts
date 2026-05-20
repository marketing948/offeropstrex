import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { campaignsTable, testingBatchesTable } from "@workspace/db";
import type { checkWorkspaceAccess } from "./workspace-access.ts";

type AccessResult = Awaited<ReturnType<typeof checkWorkspaceAccess>>;

/** Same visibility rules as GET /live-campaigns (testing batch assignee vs production campaigns). */
export function appendLiveCampaignVisibilityConditions(
  access: Extract<AccessResult, { allowed: true }>,
  requestedWorkerId: number | null,
  conditions: SQL[],
): void {
  if (access.employee.role === "admin") {
    if (requestedWorkerId !== null) {
      conditions.push(
        or(
          inArray(campaignsTable.campaignPurpose, ["working", "scaling"]),
          eq(testingBatchesTable.employeeId, requestedWorkerId),
        )!,
      );
    }
    return;
  }

  conditions.push(
    or(
      inArray(campaignsTable.campaignPurpose, ["working", "scaling"]),
      eq(testingBatchesTable.employeeId, access.employee.id),
    )!,
  );
  if (requestedWorkerId !== null) {
    conditions.push(
      or(
        inArray(campaignsTable.campaignPurpose, ["working", "scaling"]),
        eq(testingBatchesTable.employeeId, requestedWorkerId),
      )!,
    );
  }
}

export function testingBatchJoin(workspaceId: number) {
  return and(
    eq(campaignsTable.batchId, testingBatchesTable.id),
    eq(testingBatchesTable.workspaceId, workspaceId),
  );
}
