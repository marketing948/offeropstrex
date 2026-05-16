import { pgTable, text, serial, integer, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";

// Phase 2: Per-workspace traffic-source ordering. Replaces the
// per-(workspace, traffic_source, device) plan model with a simpler
// list of sources the workspace tests in, in a worker-controlled order.
// `position` defines the rotation order the engine walks for each batch.
export const workspaceTrafficSourcesTable = pgTable("workspace_traffic_sources", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  voluumTrafficSourceId: text("voluum_traffic_source_id"),
  position: integer("position").notNull(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => ({
  uniqWorkspacePosition: unique("workspace_traffic_sources_workspace_position_unique").on(t.workspaceId, t.position),
  uniqWorkspaceName: unique("workspace_traffic_sources_workspace_name_unique").on(t.workspaceId, t.name),
}));

export const insertWorkspaceTrafficSourceSchema = createInsertSchema(workspaceTrafficSourcesTable).omit({ id: true });
export type InsertWorkspaceTrafficSource = z.infer<typeof insertWorkspaceTrafficSourceSchema>;
export type WorkspaceTrafficSource = typeof workspaceTrafficSourcesTable.$inferSelect;
