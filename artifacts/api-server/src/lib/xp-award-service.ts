import { and, eq, sql, sum, gte, lt } from "drizzle-orm";
import { db, xpLedgerTable } from "@workspace/db";
import type { Tx } from "../engine/types.ts";

export type XpSourceType = "goal_completion" | "reward_rule";

export type AwardXpInput = {
  workspaceId: number;
  employeeId: number;
  monthKey: string;
  amount: number;
  sourceType: XpSourceType;
  idempotencyKey: string;
  goalId?: string | null;
  metricKey?: string | null;
  rewardRuleId?: string | null;
  actionType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
};

type DbClient = Pick<typeof db, "insert" | "select">;

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    const code = (current as { code?: string }).code;
    if (code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function awardXp(
  client: DbClient,
  input: AwardXpInput,
): Promise<{ awarded: boolean; amount: number }> {
  if (input.amount <= 0) return { awarded: false, amount: 0 };

  try {
    await client.insert(xpLedgerTable).values({
      workspaceId: input.workspaceId,
      employeeId: input.employeeId,
      monthKey: input.monthKey,
      amount: input.amount,
      sourceType: input.sourceType,
      idempotencyKey: input.idempotencyKey,
      goalId: input.goalId ?? null,
      metricKey: input.metricKey ?? null,
      rewardRuleId: input.rewardRuleId ?? null,
      actionType: input.actionType ?? null,
      entityId: input.entityId ?? null,
      metadataJson: input.metadata ?? null,
    });
    return { awarded: true, amount: input.amount };
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return { awarded: false, amount: 0 };
    }
    throw err;
  }
}

export async function awardXpInTx(tx: Tx, input: AwardXpInput) {
  return awardXp(tx, input);
}

export function goalCompletionIdempotencyKey(
  workspaceId: number,
  employeeId: number,
  goalId: string,
  metricKey: string,
  monthKey: string,
): string {
  return `goal_completion:${workspaceId}:${employeeId}:${goalId}:${metricKey}:${monthKey}`;
}

export function rewardRuleIdempotencyKey(
  workspaceId: number,
  employeeId: number,
  ruleId: string,
  actionType: string,
  entityId: string,
): string {
  return `reward_rule:${workspaceId}:${employeeId}:${ruleId}:${actionType}:${entityId}`;
}

export async function sumXpForEmployeeMonth(
  workspaceId: number,
  employeeId: number,
  monthKey: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sum(xpLedgerTable.amount) })
    .from(xpLedgerTable)
    .where(
      and(
        eq(xpLedgerTable.workspaceId, workspaceId),
        eq(xpLedgerTable.employeeId, employeeId),
        eq(xpLedgerTable.monthKey, monthKey),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function sumXpByEmployeeForMonth(
  workspaceId: number,
  monthKey: string,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      employeeId: xpLedgerTable.employeeId,
      total: sum(xpLedgerTable.amount),
    })
    .from(xpLedgerTable)
    .where(
      and(eq(xpLedgerTable.workspaceId, workspaceId), eq(xpLedgerTable.monthKey, monthKey)),
    )
    .groupBy(xpLedgerTable.employeeId);

  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(r.employeeId, Number(r.total ?? 0));
  }
  return map;
}

export async function listXpHistoryForEmployeeMonth(
  workspaceId: number,
  employeeId: number,
  monthKey: string,
) {
  const { dateFrom, dateToExclusive } = monthKeyToRange(monthKey);
  return db
    .select()
    .from(xpLedgerTable)
    .where(
      and(
        eq(xpLedgerTable.workspaceId, workspaceId),
        eq(xpLedgerTable.employeeId, employeeId),
        eq(xpLedgerTable.monthKey, monthKey),
        gte(xpLedgerTable.createdAt, dateFrom),
        lt(xpLedgerTable.createdAt, dateToExclusive),
      ),
    )
    .orderBy(xpLedgerTable.createdAt);
}

export function monthKeyToRange(monthKey: string): {
  dateFrom: Date;
  dateToExclusive: Date;
  dateFromIso: string;
  dateToIso: string;
} {
  const [y, m] = monthKey.split("-").map(Number);
  const dateFrom = new Date(Date.UTC(y, m - 1, 1));
  const dateToExclusive = new Date(Date.UTC(y, m, 1));
  return {
    dateFrom,
    dateToExclusive,
    dateFromIso: dateFrom.toISOString().slice(0, 10),
    dateToIso: new Date(dateToExclusive.getTime() - 86400000).toISOString().slice(0, 10),
  };
}

export function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function xpLeaderboard(
  workspaceId: number,
  monthKey: string,
  limit = 10,
): Promise<{ employeeId: number; totalXp: number }[]> {
  const rows = await db
    .select({
      employeeId: xpLedgerTable.employeeId,
      totalXp: sum(xpLedgerTable.amount),
    })
    .from(xpLedgerTable)
    .where(
      and(eq(xpLedgerTable.workspaceId, workspaceId), eq(xpLedgerTable.monthKey, monthKey)),
    )
    .groupBy(xpLedgerTable.employeeId)
    .orderBy(sql`${sum(xpLedgerTable.amount)} desc`)
    .limit(limit);

  return rows.map((r) => ({
    employeeId: r.employeeId,
    totalXp: Number(r.totalXp ?? 0),
  }));
}
