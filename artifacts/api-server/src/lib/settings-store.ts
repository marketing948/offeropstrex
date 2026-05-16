import { eq, and } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";

/**
 * Workspace-scoped settings store. Replaces the previous global key-value
 * helpers in routes/sync.ts and routes/settings.ts. Every read and write
 * MUST be scoped to a workspace; there is no "default workspace" fallback.
 */

export async function getSettingValue(workspaceId: number, key: string): Promise<string | null> {
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error(`getSettingValue: invalid workspaceId ${workspaceId}`);
  }
  const [row] = await db.select()
    .from(settingsTable)
    .where(and(eq(settingsTable.workspaceId, workspaceId), eq(settingsTable.key, key)));
  return row?.value ?? null;
}

export async function upsertSetting(workspaceId: number, key: string, value: string | null): Promise<void> {
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error(`upsertSetting: invalid workspaceId ${workspaceId}`);
  }
  const [existing] = await db.select({ id: settingsTable.id })
    .from(settingsTable)
    .where(and(eq(settingsTable.workspaceId, workspaceId), eq(settingsTable.key, key)));
  if (existing) {
    await db.update(settingsTable)
      .set({ value })
      .where(eq(settingsTable.id, existing.id));
  } else {
    await db.insert(settingsTable).values({ workspaceId, key, value });
  }
}
