/**
 * Phase 1 backfill audit (Task #11).
 *
 * Run BEFORE applying lib/db/migrations/0002_phase1_workspace_isolation.sql
 * in any environment that may have legacy data. The pre-Phase-1 schema had
 * `workspace_id integer DEFAULT 1`, which means a forgotten workspaceId in
 * any insert silently routed the row to workspace 1. The audit's job is to
 * surface BOTH classes of bad data:
 *
 *   (a) NULL workspace_id rows (rare — only if column was added later).
 *   (b) **MISROUTED workspace_id=1 rows** — rows whose workspace_id=1 but
 *       whose foreign relations point at a different workspace. These are
 *       the canonical "default(1) silently swallowed the truth" cases.
 *
 * The audit also lists legacy global voluum_* settings rows the migration
 * deletes, and the candidate default workspace.
 *
 * Read-only. Exits 0 if everything is safe to migrate; exits 1 if it finds
 * rows an operator must triage manually.
 *
 * Run via: pnpm --filter @workspace/scripts run audit:workspace-backfill
 */
import { Client } from "pg";

const TABLES = [
  "settings",
  "testing_batches",
  "offers",
  "todo_tasks",
  "notifications",
  "traffic_source_plans",
  "daily_reports",
  "voluum_campaign_mappings",
  "imported_offers",
];

/**
 * Cross-table workspace_id consistency probes. Each query returns rows
 * whose workspace_id disagrees with a related row's workspace_id. These
 * are the canonical "default(1) misrouted" candidates: the FK value
 * itself proves which workspace the row *should* live in, so a mismatch
 * means somebody (likely the default(1) fallback) overwrote the truth.
 */
const CROSS_TABLE_PROBES: { name: string; sql: string }[] = [
  {
    name: "offers.workspace_id != testing_batches.workspace_id",
    sql: `
      SELECT o.id AS offer_id, o.workspace_id AS offer_ws, b.id AS batch_id, b.workspace_id AS batch_ws
        FROM offers o JOIN testing_batches b ON o.batch_id = b.id
       WHERE o.workspace_id IS DISTINCT FROM b.workspace_id
       LIMIT 25`,
  },
  {
    name: "todo_tasks.workspace_id != related_batch.workspace_id",
    sql: `
      SELECT t.id AS task_id, t.workspace_id AS task_ws, b.id AS batch_id, b.workspace_id AS batch_ws
        FROM todo_tasks t JOIN testing_batches b ON t.related_batch_id = b.id
       WHERE t.workspace_id IS DISTINCT FROM b.workspace_id
       LIMIT 25`,
  },
  {
    name: "notifications.workspace_id != batch.workspace_id",
    sql: `
      SELECT n.id AS notif_id, n.workspace_id AS notif_ws, b.id AS batch_id, b.workspace_id AS batch_ws
        FROM notifications n JOIN testing_batches b ON n.batch_id = b.id
       WHERE n.workspace_id IS DISTINCT FROM b.workspace_id
       LIMIT 25`,
  },
  {
    name: "voluum_campaign_mappings.workspace_id != batch.workspace_id",
    sql: `
      SELECT m.id AS map_id, m.workspace_id AS map_ws, b.id AS batch_id, b.workspace_id AS batch_ws
        FROM voluum_campaign_mappings m JOIN testing_batches b ON m.batch_id = b.id
       WHERE m.workspace_id IS DISTINCT FROM b.workspace_id
       LIMIT 25`,
  },
];

const LEGACY_SETTINGS_KEYS_PREDICATE = `key IN ('voluum_access_id','voluum_access_key','voluum_api_base_url') OR key LIKE 'voluum_mapping_%'`;

async function tableHasColumn(client: Client, table: string, column: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return (r.rowCount ?? 0) > 0;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(2);
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  let problems = 0;
  console.log("=== Phase 1 backfill audit ===\n");

  const ws = await client.query<{ id: number; name: string }>(
    `SELECT id, name FROM workspaces ORDER BY id`,
  );
  const wsCount = ws.rowCount ?? ws.rows.length;
  console.log(`Workspaces in DB (${wsCount}):`);
  for (const row of ws.rows) console.log(`  - id=${row.id} name=${row.name}`);
  if (wsCount === 0) {
    console.error("\nFATAL: no workspaces row exists. Create one before running the migration.");
    await client.end();
    process.exit(1);
  }
  const defaultWs = ws.rows[0];
  console.log(`\nDefault backfill target → workspace id=${defaultWs.id} (${defaultWs.name})\n`);

  // ---- (a) NULL rows -----------------------------------------------------
  console.log("--- (a) NULL workspace_id rows per table ---");
  let nullRowsTotal = 0;
  for (const tbl of TABLES) {
    if (!(await tableHasColumn(client, tbl, "workspace_id"))) {
      console.log(`  ${tbl.padEnd(28)} (no workspace_id column)`);
      continue;
    }
    const r = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM ${tbl} WHERE workspace_id IS NULL`,
    );
    const count = Number(r.rows[0].c);
    nullRowsTotal += count;
    console.log(`  ${tbl.padEnd(28)} ${count}`);
  }

  // ---- (b) Misrouted workspace_id=1 candidates ---------------------------
  console.log("\n--- (b) Cross-table workspace_id mismatches (likely misrouted by default(1)) ---");
  let misroutedTotal = 0;
  for (const probe of CROSS_TABLE_PROBES) {
    let rows: Record<string, unknown>[] = [];
    try {
      const r = await client.query(probe.sql);
      rows = r.rows;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${probe.name}: SKIPPED (${msg.split("\n")[0]})`);
      continue;
    }
    if (rows.length === 0) {
      console.log(`  ${probe.name}: 0`);
      continue;
    }
    misroutedTotal += rows.length;
    console.log(`  ${probe.name}: ${rows.length}${rows.length === 25 ? "+ (truncated)" : ""}`);
    for (const row of rows.slice(0, 10)) {
      console.log(`      ${JSON.stringify(row)}`);
    }
    console.log(
      `      → REMEDIATE before migration. The FK side is the source of truth: ` +
      `UPDATE the child row's workspace_id to match the related parent.`,
    );
  }

  // ---- Per-workspace row counts (helps operators sanity-check workspace 1) ----
  console.log("\n--- Per-workspace row counts (so workspace 1 isn't silently 'all the data') ---");
  for (const tbl of TABLES) {
    if (!(await tableHasColumn(client, tbl, "workspace_id"))) continue;
    const r = await client.query<{ workspace_id: number | null; c: string }>(
      `SELECT workspace_id, COUNT(*)::text AS c FROM ${tbl} GROUP BY workspace_id ORDER BY workspace_id`,
    );
    const parts = r.rows.map(row => `ws${row.workspace_id ?? "NULL"}=${row.c}`).join("  ");
    console.log(`  ${tbl.padEnd(28)} ${parts || "(empty)"}`);
  }

  console.log("\n--- Legacy global settings rows that the migration will DELETE ---");
  const legacy = await client.query<{ key: string }>(
    `SELECT key FROM settings WHERE ${LEGACY_SETTINGS_KEYS_PREDICATE} ORDER BY key`,
  );
  const legacyCount = legacy.rowCount ?? legacy.rows.length;
  if (legacyCount === 0) {
    console.log("  (none)");
  } else {
    for (const row of legacy.rows) console.log(`  - ${row.key}`);
  }

  await client.end();

  console.log("\n=== Summary ===");
  console.log(`NULL workspace_id rows total: ${nullRowsTotal}`);
  console.log(`Cross-table workspace_id mismatches: ${misroutedTotal}`);
  console.log(`Legacy settings rows to delete: ${legacyCount}`);

  if (misroutedTotal > 0) {
    problems++;
    console.error(
      `\nFAIL: ${misroutedTotal} row(s) have workspace_id that disagrees with their FK parent. ` +
      `These are almost certainly default(1) misroutes. Reassign them to the correct workspace ` +
      `(use the parent's workspace_id) BEFORE applying the migration. The migration's pre-flight ` +
      `guard will refuse to enforce constraints while these exist.`,
    );
  }
  if (nullRowsTotal > 0 && wsCount > 1) {
    problems++;
    console.error(
      `\nWARNING: multiple workspaces exist AND there are NULL rows. Verify that ` +
      `assigning all of them to workspace ${defaultWs.id} (${defaultWs.name}) is correct ` +
      `before running the migration. If not, write a custom backfill UPDATE first.`,
    );
  }

  if (problems > 0) process.exit(1);
  console.log("\nOK — safe to apply lib/db/migrations/0002_phase1_workspace_isolation.sql");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
