/**
 * Phase 2 (Task #12) schema fixture test.
 *
 * Asserts the Automation Bible schema invariants on the live DB:
 *   - 5 replaced enums have exactly the spec value sets (no legacy
 *     members lingering, no spec members missing).
 *   - 2 new enums (notification_severity, tracker_campaign_device) exist
 *     with the spec values.
 *   - 3 new tables (tracker_campaigns, workspace_traffic_sources, events)
 *     exist with NOT NULL workspace_id FK CASCADE → workspaces.
 *   - tracker_campaigns enforces UNIQUE(batch_id, traffic_source_id, device)
 *     AND UNIQUE(workspace_id, voluum_campaign_id) at the DB layer.
 *   - workspace_traffic_sources enforces UNIQUE(workspace_id, position)
 *     and UNIQUE(workspace_id, name).
 *   - testing_batches has the 4 new Phase 2 columns.
 *   - todo_tasks has the 4 new Phase 2 columns.
 *   - traffic_source_device_plans is gone.
 *
 * Run with `pnpm --filter @workspace/scripts run test:phase2-schema`.
 */
import pg from "pg";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(2);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let failed = 0;
async function expect(label: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✔ ${label}`);
  } catch (e) {
    failed++;
    console.error(`  ✘ ${label}\n      ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function enumValues(name: string): Promise<string[]> {
  const r = await client.query<{ v: string }>(
    `SELECT e.enumlabel AS v FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = $1 ORDER BY e.enumsortorder`,
    [name],
  );
  return r.rows.map((r) => r.v);
}

function assertSet(actual: string[], expected: string[], name: string) {
  const a = [...actual].sort().join(",");
  const e = [...expected].sort().join(",");
  if (a !== e) throw new Error(`enum ${name}\n        expected: ${e}\n        actual:   ${a}`);
}

console.log("[test:phase2-schema] enum value sets");
await expect("batch_status = spec 6", async () => {
  assertSet(await enumValues("batch_status"), [
    "NEW_BATCH",
    "WAITING_FOR_TRACKER_CAMPAIGNS",
    "OFFER_READY_FOR_LIVE_TESTING",
    "LIVE_TESTS",
    "TESTED",
    "COMPLETED",
  ], "batch_status");
});
await expect("task_type = spec 4", async () => {
  assertSet(await enumValues("task_type"), [
    "CREATE_IOS_TRACKER_CAMPAIGN",
    "CREATE_ANDROID_TRACKER_CAMPAIGN",
    "FIND_WINNERS",
    "PAUSE_TRAFFIC_SOURCE_CAMPAIGNS",
  ], "task_type");
});
await expect("task_status = spec 4", async () => {
  assertSet(await enumValues("task_status"), ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"], "task_status");
});
await expect("notification_type = spec 7", async () => {
  assertSet(await enumValues("notification_type"), [
    "NEW_BATCH_CREATED",
    "TRACKER_CAMPAIGN_MISSING",
    "INVALID_TAG",
    "DUPLICATE_TRACKER_CAMPAIGN",
    "SUSPICIOUS_BATCH_UPDATE",
    "API_SYNC_FAILURE",
    "TASK_OVERDUE",
  ], "notification_type");
});
await expect("offer_status = spec 4", async () => {
  assertSet(await enumValues("offer_status"), ["imported", "tested", "winner", "loser"], "offer_status");
});
await expect("notification_severity = info,warning,high,critical", async () => {
  assertSet(await enumValues("notification_severity"), ["info", "warning", "high", "critical"], "notification_severity");
});
await expect("tracker_campaign_device = ios,android", async () => {
  assertSet(await enumValues("tracker_campaign_device"), ["ios", "android"], "tracker_campaign_device");
});

console.log("\n[test:phase2-schema] new tables exist with correct constraints");
async function fkCheck(table: string, column: string, refTable: string, expectedAction: "c" | "r" | "n") {
  const r = await client.query<{ confdeltype: string; confrelid: string }>(
    `SELECT con.confdeltype, c2.relname AS confrelid
       FROM pg_constraint con
       JOIN pg_class c1 ON c1.oid = con.conrelid
       JOIN pg_class c2 ON c2.oid = con.confrelid
       JOIN pg_attribute a ON a.attrelid = c1.oid AND a.attnum = ANY(con.conkey)
      WHERE c1.relname = $1 AND a.attname = $2 AND con.contype = 'f'`,
    [table, column],
  );
  if (r.rows.length === 0) throw new Error(`${table}.${column} has no FK`);
  const row = r.rows[0];
  if (row.confrelid !== refTable) throw new Error(`${table}.${column} → ${row.confrelid} (expected ${refTable})`);
  if (row.confdeltype !== expectedAction) throw new Error(`${table}.${column} ON DELETE = ${row.confdeltype} (expected ${expectedAction})`);
}

for (const tbl of ["tracker_campaigns", "workspace_traffic_sources", "events"]) {
  await expect(`${tbl}.workspace_id NOT NULL FK CASCADE → workspaces`, async () => {
    const r = await client.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name=$1 AND column_name='workspace_id'`,
      [tbl],
    );
    if (r.rows[0]?.is_nullable !== "NO") throw new Error(`${tbl}.workspace_id is_nullable=${r.rows[0]?.is_nullable}`);
    await fkCheck(tbl, "workspace_id", "workspaces", "c");
  });
}

await expect("tracker_campaigns UNIQUE(batch_id, traffic_source_id, device)", async () => {
  const r = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM pg_constraint
      WHERE conname='tracker_campaigns_batch_source_device_unique' AND contype='u'`,
  );
  if (r.rows[0].count !== "1") throw new Error(`unique constraint missing`);
});
await expect("tracker_campaigns UNIQUE(workspace_id, voluum_campaign_id)", async () => {
  const r = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM pg_constraint
      WHERE conname='tracker_campaigns_workspace_voluum_campaign_unique' AND contype='u'`,
  );
  if (r.rows[0].count !== "1") throw new Error(`unique constraint missing`);
});
await expect("workspace_traffic_sources UNIQUE(workspace_id, position) and (workspace_id, name)", async () => {
  for (const c of [
    "workspace_traffic_sources_workspace_position_unique",
    "workspace_traffic_sources_workspace_name_unique",
  ]) {
    const r = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_constraint WHERE conname=$1 AND contype='u'`,
      [c],
    );
    if (r.rows[0].count !== "1") throw new Error(`${c} missing`);
  }
});

console.log("\n[test:phase2-schema] new columns on existing tables");
async function colExists(table: string, col: string, expectedType?: string) {
  const r = await client.query<{ data_type: string; udt_name: string; is_nullable: string }>(
    `SELECT data_type, udt_name, is_nullable FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
    [table, col],
  );
  if (r.rows.length === 0) throw new Error(`${table}.${col} missing`);
  if (expectedType && r.rows[0].udt_name !== expectedType && r.rows[0].data_type !== expectedType) {
    throw new Error(`${table}.${col} type=${r.rows[0].udt_name}/${r.rows[0].data_type} (expected ${expectedType})`);
  }
}

await expect("testing_batches.current_traffic_source_id (int)", () => colExists("testing_batches", "current_traffic_source_id", "int4"));
await expect("testing_batches.traffic_source_step (int, default 0)", () => colExists("testing_batches", "traffic_source_step", "int4"));
await expect("testing_batches.traffic_source_order_snapshot (jsonb)", () => colExists("testing_batches", "traffic_source_order_snapshot", "jsonb"));
await expect("testing_batches.affiliate_network_id FK RESTRICT → voluum_affiliate_networks (nullable in Phase 2)", async () => {
  await colExists("testing_batches", "affiliate_network_id", "int4");
  await fkCheck("testing_batches", "affiliate_network_id", "voluum_affiliate_networks", "r");
});
await expect("todo_tasks.flashing (bool)", () => colExists("todo_tasks", "flashing", "bool"));
await expect("todo_tasks.escalated_at (timestamptz)", () => colExists("todo_tasks", "escalated_at", "timestamptz"));
await expect("todo_tasks.tracker_campaign_device (enum)", () => colExists("todo_tasks", "tracker_campaign_device", "tracker_campaign_device"));
await expect("todo_tasks.traffic_source_id FK → voluum_traffic_sources", async () => {
  await colExists("todo_tasks", "traffic_source_id", "int4");
  await fkCheck("todo_tasks", "traffic_source_id", "voluum_traffic_sources", "n");
});
await expect("notifications.severity (enum)", () => colExists("notifications", "severity", "notification_severity"));

await expect("traffic_source_device_plans dropped", async () => {
  const r = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('public.traffic_source_device_plans') IS NOT NULL AS exists`,
  );
  if (r.rows[0].exists) throw new Error("traffic_source_device_plans still exists");
});

console.log("\n[test:phase2-schema] runtime constraint enforcement (fixture inserts)");
// Spin up a temp workspace + temp employee + traffic source so we can prove
// the tracker_campaigns UNIQUE(batch_id, traffic_source_id, device) constraint
// is actually enforced by the DB, not just structurally present.
const ws = await client.query<{ id: number }>(
  `INSERT INTO workspaces (name, is_active, is_default) VALUES ($1, true, false) RETURNING id`,
  [`phase2-test-${Date.now()}`],
);
const wsId = ws.rows[0].id;
let cleanupWsId: number | null = wsId;
let cleanupEmpId: number | null = null;
try {
  const emp = await client.query<{ id: number }>(
    `INSERT INTO employees (name, email, password_hash, role) VALUES ('Phase2 Test', $1, 'x', 'admin') RETURNING id`,
    [`phase2-${Date.now()}@test.local`],
  );
  cleanupEmpId = emp.rows[0].id;
  const ts = await client.query<{ id: number }>(
    `INSERT INTO voluum_traffic_sources (workspace_id, voluum_id, name) VALUES ($1, $2, 'TS-A') RETURNING id`,
    [wsId, `vts-${Date.now()}`],
  );
  const tsId = ts.rows[0].id;
  const batch = await client.query<{ id: number }>(
    `INSERT INTO testing_batches (batch_name, employee_id, status, affiliate_network, geo, traffic_source, workspace_id)
     VALUES ('phase2-batch', $1, 'NEW_BATCH', 'X', 'US', 'TS-A', $2) RETURNING id`,
    [emp.rows[0].id, wsId],
  );
  const batchId = batch.rows[0].id;

  await expect("tracker_campaigns: first insert succeeds", async () => {
    await client.query(
      `INSERT INTO tracker_campaigns (workspace_id, batch_id, traffic_source_id, device, voluum_campaign_id, tag)
       VALUES ($1, $2, $3, 'ios', 'voluum-1', 'SL_DE_BATCH1')`,
      [wsId, batchId, tsId],
    );
  });

  await expect("tracker_campaigns: duplicate (batch, source, device) rejected", async () => {
    try {
      await client.query(
        `INSERT INTO tracker_campaigns (workspace_id, batch_id, traffic_source_id, device, voluum_campaign_id, tag)
         VALUES ($1, $2, $3, 'ios', 'voluum-2', 'SL_DE_BATCH1')`,
        [wsId, batchId, tsId],
      );
      throw new Error("duplicate insert succeeded — UNIQUE(batch, source, device) not enforced");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/duplicate key|unique/i.test(msg)) throw new Error(`unexpected error: ${msg}`);
    }
  });

  await expect("tracker_campaigns: same batch+source different device allowed", async () => {
    await client.query(
      `INSERT INTO tracker_campaigns (workspace_id, batch_id, traffic_source_id, device, voluum_campaign_id, tag)
       VALUES ($1, $2, $3, 'android', 'voluum-3', 'SL_DE_BATCH1')`,
      [wsId, batchId, tsId],
    );
  });

  await expect("tracker_campaigns: duplicate voluum_campaign_id within workspace rejected", async () => {
    try {
      await client.query(
        `INSERT INTO tracker_campaigns (workspace_id, batch_id, traffic_source_id, device, voluum_campaign_id, tag)
         VALUES ($1, $2, $3, 'ios', 'voluum-1', 'SL_DE_BATCH2')`,
        [wsId, batchId, tsId],
      );
      throw new Error("duplicate voluum_campaign_id succeeded");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/duplicate key|unique/i.test(msg)) throw new Error(`unexpected error: ${msg}`);
    }
  });

  await expect("workspace_traffic_sources: duplicate position rejected", async () => {
    await client.query(
      `INSERT INTO workspace_traffic_sources (workspace_id, name, position) VALUES ($1, 'A', 1)`,
      [wsId],
    );
    try {
      await client.query(
        `INSERT INTO workspace_traffic_sources (workspace_id, name, position) VALUES ($1, 'B', 1)`,
        [wsId],
      );
      throw new Error("duplicate position succeeded");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/duplicate key|unique/i.test(msg)) throw new Error(`unexpected error: ${msg}`);
    }
  });

  await expect("events: insert with payload jsonb", async () => {
    await client.query(
      `INSERT INTO events (workspace_id, type, payload) VALUES ($1, 'TEST_EVENT', $2::jsonb)`,
      [wsId, JSON.stringify({ batchId, foo: "bar" })],
    );
  });

  await expect("CASCADE: deleting workspace removes Phase 2 child rows", async () => {
    await client.query(`DELETE FROM workspaces WHERE id=$1`, [wsId]);
    cleanupWsId = null;
    cleanupEmpId = null; // employees FK-cascades on workspace? It doesn't — separate cleanup below
    for (const tbl of ["tracker_campaigns", "workspace_traffic_sources", "events"]) {
      const r = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${tbl} WHERE workspace_id=$1`, [wsId]);
      if (r.rows[0].count !== "0") throw new Error(`${tbl} still has rows after workspace delete`);
    }
  });
} finally {
  if (cleanupWsId !== null) await client.query(`DELETE FROM workspaces WHERE id=$1`, [cleanupWsId]).catch(() => {});
  if (cleanupEmpId !== null) await client.query(`DELETE FROM employees WHERE id=$1`, [cleanupEmpId]).catch(() => {});
  await client.end();
}

if (failed > 0) {
  console.error(`\n[test:phase2-schema] ${failed} test(s) failed`);
  process.exit(1);
}
console.log("\n[test:phase2-schema] all tests passed");
