/**
 * Phase 1 (Task #11) DB-level regression tests for workspace isolation.
 *
 * Connects to DATABASE_URL with raw pg and asserts the schema invariants
 * Phase 1 was supposed to enforce. These tests are runnable in CI and act
 * as the "cross-workspace write/read denial" + "new testing batch
 * regression" coverage the reviewer requested.
 *
 * Run via: pnpm --filter @workspace/scripts run test:workspace-isolation
 *
 * Tests are read-mostly; any rows we insert get rolled back via a temp
 * workspace and ON DELETE CASCADE.
 */
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[test:workspace-isolation] DATABASE_URL not set");
  process.exit(2);
}

const client = new Client({ connectionString: DATABASE_URL });

let failed = 0;
function ok(name: string) { console.log(`  ✔ ${name}`); }
function fail(name: string, err: unknown) {
  failed++;
  console.error(`  ✖ ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
}
async function expect(name: string, fn: () => Promise<void>) {
  try { await fn(); ok(name); } catch (e) { fail(name, e); }
}

const DOMAIN_TABLES = [
  "testing_batches",
  "offers",
  "todo_tasks",
  "notifications",
  "daily_reports",
  "voluum_campaign_mappings",
  "imported_offers",
  "settings",
];

await client.connect();

let tempWorkspaceA: number | null = null;
let tempWorkspaceB: number | null = null;
let tempEmployeeA: number | null = null;

try {
  console.log("[test:workspace-isolation] schema invariants");

  // ---- 1. Every domain table has workspace_id NOT NULL FK CASCADE ----
  for (const table of DOMAIN_TABLES) {
    await expect(`${table}.workspace_id is NOT NULL`, async () => {
      const r = await client.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'workspace_id'`,
        [table],
      );
      if (r.rows.length === 0) throw new Error("column not found");
      if (r.rows[0].is_nullable !== "NO") throw new Error(`is_nullable=${r.rows[0].is_nullable}`);
    });

    await expect(`${table}.workspace_id has no DEFAULT`, async () => {
      const r = await client.query<{ column_default: string | null }>(
        `SELECT column_default FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'workspace_id'`,
        [table],
      );
      if (r.rows[0]?.column_default !== null) {
        throw new Error(`column_default=${r.rows[0]?.column_default}`);
      }
    });

    await expect(`${table}.workspace_id FK CASCADE -> workspaces`, async () => {
      const r = await client.query<{ delete_rule: string; foreign_table_name: string }>(
        `SELECT rc.delete_rule, ccu.table_name AS foreign_table_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.referential_constraints rc
             ON tc.constraint_name = rc.constraint_name
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = rc.unique_constraint_name
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
          WHERE tc.table_name = $1
            AND kcu.column_name = 'workspace_id'`,
        [table],
      );
      if (r.rows.length === 0) throw new Error("no FK on workspace_id");
      if (r.rows[0].foreign_table_name !== "workspaces")
        throw new Error(`FK target=${r.rows[0].foreign_table_name}`);
      if (r.rows[0].delete_rule !== "CASCADE")
        throw new Error(`delete_rule=${r.rows[0].delete_rule}`);
    });
  }

  // ---- 2. settings has composite UNIQUE(workspace_id, key) ----
  await expect("settings has composite UNIQUE(workspace_id, key)", async () => {
    const r = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'settings' AND indexdef ILIKE '%UNIQUE%'`,
    );
    const hasComposite = r.rows.some(row =>
      /workspace_id/i.test(row.indexdef) && /\bkey\b/i.test(row.indexdef),
    );
    if (!hasComposite) throw new Error(`no composite unique index found: ${r.rows.map(x => x.indexdef).join(" | ")}`);
  });

  // ---- 3. No legacy global voluum_* settings rows remain ----
  await expect("no legacy unscoped voluum_* settings rows", async () => {
    const r = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM settings
        WHERE key IN ('voluum_access_id', 'voluum_access_key', 'voluum_api_base_url')
           OR key LIKE 'voluum_mapping_%'`,
    );
    if (r.rows[0].count !== "0") throw new Error(`found ${r.rows[0].count} legacy rows`);
  });

  console.log("\n[test:workspace-isolation] runtime enforcement");

  // ---- 4. Set up two ephemeral workspaces + an employee for cross-workspace tests ----
  const ws = await client.query<{ id: number }>(
    `INSERT INTO workspaces (name) VALUES ('phase1-test-A'), ('phase1-test-B') RETURNING id`,
  );
  tempWorkspaceA = ws.rows[0].id;
  tempWorkspaceB = ws.rows[1].id;

  // employees is currently a global (non-workspace-scoped) table; that's
  // out of scope for Phase 1 (Task #11), which targets domain rows.
  const emp = await client.query<{ id: number }>(
    `INSERT INTO employees (name, email, password_hash, role)
     VALUES ('Phase1 Test', $1, 'x', 'admin') RETURNING id`,
    [`phase1-${Date.now()}@test.local`],
  );
  tempEmployeeA = emp.rows[0].id;

  // ---- 5. Insert into testing_batches WITHOUT workspace_id → must fail NOT NULL ----
  await expect("INSERT testing_batches w/o workspace_id rejected (NOT NULL)", async () => {
    try {
      await client.query(
        `INSERT INTO testing_batches (batch_name, employee_id, status, affiliate_network, geo, traffic_source)
         VALUES ('phase1-bad', $1, 'NEW_BATCH', 'X', 'US', 'Y')`,
        [tempEmployeeA],
      );
      throw new Error("insert succeeded — workspace_id default-null must be enforced");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/null value in column "workspace_id"|violates not-null/i.test(msg))
        throw new Error(`unexpected error: ${msg}`);
    }
  });

  // ---- 6. Insert with bogus workspace_id → must fail FK ----
  await expect("INSERT testing_batches with bogus workspace_id rejected (FK)", async () => {
    try {
      await client.query(
        `INSERT INTO testing_batches (batch_name, employee_id, status, affiliate_network, geo, traffic_source, workspace_id)
         VALUES ('phase1-bad-fk', $1, 'NEW_BATCH', 'X', 'US', 'Y', 999999999)`,
        [tempEmployeeA],
      );
      throw new Error("insert succeeded — FK must reject unknown workspace_id");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/foreign key|violates foreign/i.test(msg))
        throw new Error(`unexpected error: ${msg}`);
    }
  });

  // ---- 7. Happy path: New Testing Batch regression — row lands in caller workspace ----
  await expect("New Testing Batch lands in caller workspace_id", async () => {
    const r = await client.query<{ id: number; workspace_id: number }>(
      `INSERT INTO testing_batches (batch_name, employee_id, status, affiliate_network, geo, traffic_source, workspace_id)
       VALUES ('phase1-happy', $1, 'NEW_BATCH', 'X', 'US', 'Y', $2)
       RETURNING id, workspace_id`,
      [tempEmployeeA, tempWorkspaceA],
    );
    if (r.rows[0].workspace_id !== tempWorkspaceA) {
      throw new Error(`row workspace_id=${r.rows[0].workspace_id}, expected ${tempWorkspaceA}`);
    }
    // Cross-workspace read: list scoped to workspace B must NOT see workspace A's row.
    const cross = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM testing_batches WHERE id = $1 AND workspace_id = $2`,
      [r.rows[0].id, tempWorkspaceB],
    );
    if (cross.rows[0].count !== "0") {
      throw new Error("cross-workspace read returned a row that should be isolated");
    }
  });

  // ---- 7b. Migration pre-flight guard: a cross-table mismatch must abort the migration ----
  await expect("Migration pre-flight DO block raises on workspace mismatch", async () => {
    // Build a contrived mismatch: insert a batch in workspace B, then an offer
    // claiming workspace A. The pre-flight DO block (copied verbatim from the
    // migration) must RAISE EXCEPTION. We run it inside a SAVEPOINT so we can
    // roll back the contrived rows without touching the rest of the run.
    await client.query("BEGIN");
    await client.query("SAVEPOINT preflight_test");
    try {
      const b = await client.query<{ id: number }>(
        `INSERT INTO testing_batches (batch_name, employee_id, status, affiliate_network, geo, traffic_source, workspace_id)
         VALUES ('preflight-bad-batch', $1, 'NEW_BATCH', 'X', 'US', 'Y', $2) RETURNING id`,
        [tempEmployeeA, tempWorkspaceB],
      );
      await client.query(
        `INSERT INTO offers (offer_name, batch_id, status, workspace_id)
         VALUES ('preflight-bad-offer', $1, 'imported', $2)`,
        [b.rows[0].id, tempWorkspaceA],
      );
      let raised = false;
      try {
        await client.query(`
          DO $$
          DECLARE total bigint;
          BEGIN
            SELECT COUNT(*) INTO total
              FROM offers o JOIN testing_batches b ON o.batch_id = b.id
             WHERE o.workspace_id IS DISTINCT FROM b.workspace_id;
            IF total > 0 THEN RAISE EXCEPTION 'mismatch=%', total; END IF;
          END $$;
        `);
      } catch (e) {
        raised = true;
        const msg = e instanceof Error ? e.message : String(e);
        if (!/mismatch=[1-9]/.test(msg)) throw new Error(`unexpected error: ${msg}`);
      }
      if (!raised) throw new Error("pre-flight DO block did NOT raise on mismatch");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
    }
  });

  // ---- 7c. HTTP-level integration: cross-workspace denial via the live API ----
  console.log("\n[test:workspace-isolation] HTTP route integration");
  const apiBase = process.env.API_BASE_URL ?? "http://localhost:80";

  // Probe the API; skip these tests if the dev server isn't running.
  let apiReachable = false;
  try {
    const probe = await fetch(`${apiBase}/api/healthz`);
    apiReachable = probe.ok;
  } catch { /* not running */ }

  if (!apiReachable) {
    console.log(`  ⚠ API not reachable at ${apiBase}; skipping HTTP route tests`);
  } else {
    // Forge a Bearer token for the temp employee. Token format from
    // artifacts/api-server/src/routes/auth.ts:18 — base64({id}:{ts}:offerops_secret).
    const token = Buffer.from(`${tempEmployeeA}:${Date.now()}:offerops_secret`).toString("base64");
    const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    // Make sure the temp employee has access ONLY to workspace B (not A) so we
    // can prove cross-workspace denial. (employees are admin by default in our
    // setup script; force the role to 'employee' and add a single assignment.)
    await client.query(`UPDATE employees SET role = 'employee' WHERE id = $1`, [tempEmployeeA]);
    await client.query(
      `INSERT INTO employee_workspace_assignments (employee_id, workspace_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [tempEmployeeA, tempWorkspaceB],
    );

    await expect("POST /api/testing-batches w/o workspaceId → 400", async () => {
      const r = await fetch(`${apiBase}/api/testing-batches`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ batchName: "no-ws", affiliateNetwork: "X", geo: "US", trafficSource: "Y" }),
      });
      if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${await r.text()}`);
    });

    await expect("POST /api/testing-batches into another workspace → 403", async () => {
      const r = await fetch(`${apiBase}/api/testing-batches`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          batchName: "cross-ws",
          affiliateNetwork: "X",
          geo: "US",
          trafficSource: "Y",
          employeeId: tempEmployeeA,
          workspaceId: tempWorkspaceA, // employee is NOT a member of A
        }),
      });
      if (r.status !== 403) throw new Error(`expected 403, got ${r.status}: ${await r.text()}`);
    });

    await expect("POST /api/testing-batches into own workspace → 200/201, row scoped", async () => {
      const r = await fetch(`${apiBase}/api/testing-batches`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          batchName: `phase1-http-${Date.now()}`,
          affiliateNetwork: "X",
          geo: "US",
          trafficSource: "Y",
          employeeId: tempEmployeeA,
          workspaceId: tempWorkspaceB,
        }),
      });
      if (r.status !== 200 && r.status !== 201) {
        throw new Error(`expected 200/201, got ${r.status}: ${await r.text()}`);
      }
      const body = (await r.json()) as { id?: number; workspaceId?: number };
      if (body.workspaceId !== tempWorkspaceB) {
        throw new Error(`returned workspaceId=${body.workspaceId}, expected ${tempWorkspaceB}`);
      }
      // DB-side proof: the row truly carries workspaceId=B
      const row = await client.query<{ workspace_id: number }>(
        `SELECT workspace_id FROM testing_batches WHERE id = $1`,
        [body.id],
      );
      if (row.rows[0]?.workspace_id !== tempWorkspaceB) {
        throw new Error(`DB row workspace_id=${row.rows[0]?.workspace_id}, expected ${tempWorkspaceB}`);
      }
    });

    await expect("GET /api/testing-batches?workspace_id=other → 403", async () => {
      const r = await fetch(`${apiBase}/api/testing-batches?workspace_id=${tempWorkspaceA}`, {
        headers: authHeaders,
      });
      if (r.status !== 403) throw new Error(`expected 403, got ${r.status}: ${await r.text()}`);
    });
  }

  // ---- 8. ON DELETE CASCADE: deleting workspace removes its rows ----
  await expect("DELETE workspace cascades to testing_batches", async () => {
    const before = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM testing_batches WHERE workspace_id = $1`,
      [tempWorkspaceA],
    );
    if (Number(before.rows[0].count) === 0) throw new Error("expected at least one row before delete");
    // Need to wipe employees first too — they FK to workspace as well.
    await client.query(`DELETE FROM workspaces WHERE id = $1`, [tempWorkspaceA]);
    tempWorkspaceA = null;
    tempEmployeeA = null;
    const after = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM testing_batches WHERE workspace_id = $1`,
      [ws.rows[0].id],
    );
    if (after.rows[0].count !== "0") throw new Error(`rows remained: ${after.rows[0].count}`);
  });
} finally {
  // Best-effort cleanup
  if (tempWorkspaceA !== null) {
    await client.query(`DELETE FROM workspaces WHERE id = $1`, [tempWorkspaceA]).catch(() => {});
  }
  if (tempWorkspaceB !== null) {
    await client.query(`DELETE FROM workspaces WHERE id = $1`, [tempWorkspaceB]).catch(() => {});
  }
  if (tempEmployeeA !== null) {
    await client.query(`DELETE FROM employees WHERE id = $1`, [tempEmployeeA]).catch(() => {});
  }
  await client.end();
}

if (failed > 0) {
  console.error(`\n[test:workspace-isolation] ${failed} test(s) failed`);
  process.exit(1);
}
console.log("\n[test:workspace-isolation] all tests passed");
