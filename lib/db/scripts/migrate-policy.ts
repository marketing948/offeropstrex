import { createHash } from "node:crypto";

export const BASELINE_FILENAME = "0000_baseline.sql";
export const MIGRATIONS_TABLE = "offerops_schema_migrations";
export const LEGACY_MIGRATION_MIN = 1;
export const LEGACY_MIGRATION_MAX = 21;
export const FORWARD_MIGRATION_MIN = 22;

export type MigrationKind = "baseline" | "legacy" | "forward" | "unknown";

export type MigrationFile = {
  name: string;
  fullPath: string;
  kind: MigrationKind;
};

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function migrationNumber(filename: string): number | null {
  const match = filename.match(/^(\d{4})_/);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1]!, 10);
}

export function classifyMigration(filename: string): MigrationKind {
  if (filename === BASELINE_FILENAME) {
    return "baseline";
  }

  const number = migrationNumber(filename);
  if (number === null) {
    return "unknown";
  }
  if (number >= LEGACY_MIGRATION_MIN && number <= LEGACY_MIGRATION_MAX) {
    return "legacy";
  }
  if (number >= FORWARD_MIGRATION_MIN) {
    return "forward";
  }
  return "unknown";
}

export function isActiveMigration(filename: string): boolean {
  const kind = classifyMigration(filename);
  return kind === "baseline" || kind === "forward";
}

export function sortMigrationFiles<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name));
}

export function selectActiveMigrations(files: MigrationFile[]): MigrationFile[] {
  return sortMigrationFiles(files.filter((file) => isActiveMigration(file.name)));
}

export function findLegacyTrackedFilenames(filenames: Iterable<string>): string[] {
  return [...filenames]
    .filter((name) => classifyMigration(name) === "legacy")
    .sort((a, b) => a.localeCompare(b));
}

export const EXPECTED_BATCH_STATUS_LABELS = [
  "NEW_BATCH",
  "WAITING_FOR_TRACKER_CAMPAIGNS",
  "OFFER_READY_FOR_LIVE_TESTING",
  "LIVE_TESTS",
  "TESTED",
  "COMPLETED",
] as const;

export const BASELINE_SCHEMA_MARKERS = [
  "workspaces",
  "employees",
  "testing_batches",
  "campaigns",
  "todo_tasks",
] as const;

export class MigrationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationPolicyError";
  }
}

export function assertNoLegacyTrackedMigrations(trackedFilenames: string[]): void {
  const legacy = findLegacyTrackedFilenames(trackedFilenames);
  if (legacy.length > 0) {
    throw new MigrationPolicyError(
      [
        "Ambiguous database state: legacy migration filenames are recorded in",
        `${MIGRATIONS_TABLE} (${legacy.join(", ")}).`,
        "Legacy migrations 0001–0021 must not run on staging/production.",
        "Restore from backup or reset migration tracking after manual review.",
      ].join(" "),
    );
  }
}

export function assertPushBasedDbAligned(options: {
  hasAppSchema: boolean;
  baselineTracked: boolean;
}): void {
  if (options.hasAppSchema && !options.baselineTracked) {
    throw new MigrationPolicyError(
      [
        "Existing application schema detected without a baseline marker.",
        "This usually means the database was created with drizzle-kit push.",
        "Run `pnpm run db:baseline-align` once to record the baseline checksum",
        "without replaying legacy SQL, then re-run `pnpm run db:migrate`.",
      ].join(" "),
    );
  }
}
