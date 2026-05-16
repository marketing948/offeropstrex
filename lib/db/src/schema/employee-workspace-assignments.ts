import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const employeeWorkspaceAssignmentsTable = pgTable(
  "employee_workspace_assignments",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    workspaceId: integer("workspace_id").notNull(),
    role: text("role").notNull().default("employee"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.employeeId, t.workspaceId)]
);

export const insertEmployeeWorkspaceAssignmentSchema = createInsertSchema(
  employeeWorkspaceAssignmentsTable
).omit({ id: true, createdAt: true });

export type InsertEmployeeWorkspaceAssignment = z.infer<typeof insertEmployeeWorkspaceAssignmentSchema>;
export type EmployeeWorkspaceAssignment = typeof employeeWorkspaceAssignmentsTable.$inferSelect;
