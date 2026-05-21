const MANUAL_CLOSE_LABELS: Record<string, string> = {
  opened_by_mistake: "opened by mistake",
  no_traffic_dead_campaign: "no traffic / dead campaign",
  technical_issue: "technical issue",
  winners_found: "winners found",
};

export function taskCompletedTitle(taskTitle: string): string {
  const t = taskTitle.trim() || "Task";
  return `Completed task: ${t}`;
}

export function campaignCreatedTitle(campaignName: string): string {
  return `Created campaign: ${campaignName.trim() || "Campaign"}`;
}

export function campaignLinkedTitle(params: {
  campaignName: string;
  platform: "ios" | "android";
  batchName?: string | null;
}): string {
  const name = params.campaignName.trim() || "Campaign";
  const batch = params.batchName?.trim();
  return batch
    ? `Linked ${params.platform} campaign ${name} to ${batch}`
    : `Linked ${params.platform} campaign ${name}`;
}

export function campaignLiveTitle(campaignName: string): string {
  return `Campaign went live: ${campaignName.trim() || "Campaign"}`;
}

export function manualMetricsSubmittedTitle(campaignName: string, date: string): string {
  return `Submitted daily metrics for ${campaignName.trim() || "campaign"} (${date})`;
}

export function voluumMetricsImportedTitle(date: string, imported: number, updated: number): string {
  return `Imported Voluum CSV metrics for ${date} (${imported} new, ${updated} updated)`;
}

export function campaignClosedTitle(campaignName: string, reason: string): string {
  const label = MANUAL_CLOSE_LABELS[reason] ?? reason.replace(/_/g, " ");
  return `Closed campaign: ${campaignName.trim() || "Campaign"} (${label})`;
}

export function winnersAddedTitle(campaignName: string, count: number): string {
  return count === 1
    ? `Recorded winner offer for ${campaignName.trim() || "campaign"}`
    : `Recorded ${count} winner offers for ${campaignName.trim() || "campaign"}`;
}
