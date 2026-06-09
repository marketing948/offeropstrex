import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  BASELINE_FILENAME,
  BASELINE_SCHEMA_MARKERS,
  EXPECTED_BATCH_STATUS_LABELS,
  MIGRATIONS_TABLE,
  MigrationPolicyError,
  assertNoLegacyTrackedMigrations,
  sha256,
} from "./migrate-policy.ts";
import { runMigrations } from "./migrate.ts";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for baseline alignment");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "..", "migrations");

async function ensureTrackingTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.${MIGRATIONS_TABLE} (
      id serial PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function hasAppSchema(pool: pg.Pool): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.workspaces') IS NOT NULL AS exists`,
  );
  return Boolean(result.rows[0]?.exists);
}

async function loadTrackedMigrations(
  pool: pg.Pool,
): Promise<Map<string, string>> {
  const result = await pool.query<{ filename: string; checksum: string }>(
    `SELECT filename, checksum FROM public.${MIGRATIONS_TABLE} ORDER BY filename`,
  );
  return new Map(result.rows.map((row) => [row.filename, row.checksum]));
}

async function validateBaselineSchema(pool: pg.Pool): Promise<void> {
  for (const tableName of BASELINE_SCHEMA_MARKERS) {
    const result = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS exists`,
      [`public.${tableName}`],
    );
    if (!result.rows[0]?.exists) {
      throw new MigrationPolicyError(
        `Baseline alignment refused: missing required table public.${tableName}.`,
      );
    }
  }

  const enumResult = await pool.query<{ label: string }>(
    `
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = 'public' AND t.typname = 'batch_status'
      ORDER BY e.enumsortorder
    `,
  );
  const labels = enumResult.rows.map((row) => row.label);
  const expected = [...EXPECTED_BATCH_STATUS_LABELS];

  if (labels.length !== expected.length || labels.some((label, i) => label !== expected[i])) {
    throw new MigrationPolicyError(
      [
        "Baseline alignment refused: batch_status enum does not match the current Drizzle schema.",
        `Expected: ${expected.join(", ")}`,
        `Found: ${labels.join(", ") || "(none)"}`,
      ].join(" "),
    );
  }
}

async function recordBaselineMarker(pool: pg.Pool, checksum: string): Promise<void> {
  await pool.query(
    `
      INSERT INTO public.${MIGRATIONS_TABLE} (filename, checksum)
      VALUES ($1, $2)
      ON CONFLICT (filename) DO NOTHING
    `,
    [BASELINE_FILENAME, checksum],
  );
}

export async function alignBaseline(pool: pg.Pool): Promise<void> {
  await ensureTrackingTable(pool);

  const tracked = await loadTrackedMigrations(pool);
  assertNoLegacyTrackedMigrations([...tracked.keys()]);

  if (tracked.has(BASELINE_FILENAME)) {
    console.log(`Baseline marker already recorded (${BASELINE_FILENAME}).`);
    return;
  }

  if (!(await hasAppSchema(pool))) {
    throw new MigrationPolicyError(
      "Baseline alignment requires an existing application schema (drizzle-kit push).",
    );
  }

  await validateBaselineSchema(pool);

  const baselinePath = path.join(migrationsDir, BASELINE_FILENAME);
  const sqlText = await readFile(baselinePath, "utf8");
  const checksum = sha256(sqlText);

  await recordBaselineMarker(pool, checksum);
  console.log(
    `Recorded baseline marker for ${BASELINE_FILENAME} without replaying legacy SQL.`,
  );
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await alignBaseline(pool);
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
