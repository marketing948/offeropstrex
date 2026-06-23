import { pgTable, text, serial, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { employeesTable } from "./employees";

export const xpLedgerTable = pgTable(
  "xp_ledger",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    monthKey: text("month_key").notNull(),
    amount: integer("amount").notNull(),
    sourceType: text("source_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    goalId: text("goal_id"),
    metricKey: text("metric_key"),
    rewardRuleId: text("reward_rule_id"),
    actionType: text("action_type"),
    entityId: text("entity_id"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex("xp_ledger_idempotency_key_unique").on(t.idempotencyKey),
    workspaceMonthEmployeeIdx: index("xp_ledger_workspace_month_employee_idx").on(
      t.workspaceId,
      t.monthKey,
      t.employeeId,
      t.createdAt,
    ),
    workspaceMonthIdx: index("xp_ledger_workspace_month_idx").on(
      t.workspaceId,
      t.monthKey,
      t.createdAt,
    ),
  }),
);

export const insertXpLedgerSchema = createInsertSchema(xpLedgerTable).omit({
  id: true,
  createdAt: true,
});
export type InsertXpLedger = z.infer<typeof insertXpLedgerSchema>;
export type XpLedgerRow = typeof xpLedgerTable.$inferSelect;
