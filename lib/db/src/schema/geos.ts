import { pgTable, text, serial, boolean, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";

// Pivot Phase 2: manual lookup table — admin-managed list of GEOs
// per workspace. `code` is the canonical 2-3 letter country code
// (e.g. "DE", "US", "GB"); `name` is the display label.
export const geosTable = pgTable("geos", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqWorkspaceCode: unique("geos_workspace_code_unique").on(t.workspaceId, t.code),
}));

export const insertGeoSchema = createInsertSchema(geosTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGeo = z.infer<typeof insertGeoSchema>;
export type Geo = typeof geosTable.$inferSelect;
