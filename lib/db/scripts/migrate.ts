import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  BASELINE_FILENAME,
  MIGRATIONS_TABLE,
  MigrationPolicyError,
  assertNoLegacyTrackedMigrations,
  assertPushBasedDbAligned,
  classifyMigration,
  selectActiveMigrations,
  sha256,
  type MigrationFile,
} from "./migrate-policy.ts";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for migrations");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "..", "migrations");

async function listAllMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(migrationsDir, entry.name),
      kind: classifyMigration(entry.name),
    }));
}

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

function logSkippedLegacyMigrations(files: MigrationFile[]): void {
  const legacy = files
    .filter((file) => file.kind === "legacy")
    .map((file) => file.name)
    .sort((a, b) => a.localeCompare(b));
  if (legacy.length > 0) {
    console.log(
      `Skipping ${legacy.length} legacy migration(s): ${legacy.join(", ")}`,
    );
  }
}

async function applyMigration(
  pool: pg.Pool,
  file: MigrationFile,
  sqlText: string,
  checksum: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sqlText);
    await client.query("SET search_path TO public");
    await client.query(
      `INSERT INTO public.${MIGRATIONS_TABLE} (filename, checksum) VALUES ($1, $2)`,
      [file.name, checksum],
    );
    await client.query("COMMIT");
    console.log(`Applied migration: ${file.name}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await ensureTrackingTable(pool);

  const allFiles = await listAllMigrationFiles();
  const activeFiles = selectActiveMigrations(allFiles);

  if (activeFiles.length === 0) {
    throw new MigrationPolicyError(
      `No active migrations found (expected at least ${BASELINE_FILENAME}).`,
    );
  }

  if (!activeFiles.some((file) => file.name === BASELINE_FILENAME)) {
    throw new MigrationPolicyError(
      `Missing required baseline migration: ${BASELINE_FILENAME}`,
    );
  }

  logSkippedLegacyMigrations(allFiles);

  const tracked = await loadTrackedMigrations(pool);
  assertNoLegacyTrackedMigrations([...tracked.keys()]);

  const appSchemaPresent = await hasAppSchema(pool);
  assertPushBasedDbAligned({
    hasAppSchema: appSchemaPresent,
    baselineTracked: tracked.has(BASELINE_FILENAME),
  });

  if (!appSchemaPresent) {
    console.log("Clean database detected; applying baseline then forward migrations.");
  }

  for (const file of activeFiles) {
    const sqlText = await readFile(file.fullPath, "utf8");
    const checksum = sha256(sqlText);
    const appliedChecksum = tracked.get(file.name);

    if (appliedChecksum) {
      if (appliedChecksum !== checksum) {
        throw new MigrationPolicyError(
          `Migration checksum mismatch for ${file.name}. Do not edit applied migrations.`,
        );
      }
      continue;
    }

    await applyMigration(pool, file, sqlText, checksum);
  }

  const [{ count }] = (
    await pool.query<{ count: string }>(
      `SELECT count(*)::text as count FROM public.${MIGRATIONS_TABLE}`,
    )
  ).rows;

  console.log(`Migration run complete. Applied migrations tracked: ${count}`);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
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
