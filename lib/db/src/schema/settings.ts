import { pgTable, text, serial, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value"),
}, (t) => ({
  uniqWorkspaceKey: unique("settings_workspace_key_unique").on(t.workspaceId, t.key),
}));

export const insertSettingSchema = createInsertSchema(settingsTable).omit({ id: true });
export type InsertSetting = z.infer<typeof insertSettingSchema>;
export type Setting = typeof settingsTable.$inferSelect;
