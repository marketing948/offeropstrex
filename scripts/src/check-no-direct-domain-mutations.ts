// Phase 3: lint check that bans direct Drizzle mutations on engine-owned
// domain tables outside the executor. Routes and handlers MUST emit an
// event or return an Action; only `engine/executor.ts` may call
// `db.update`/`db.insert`/`db.delete` on these tables.
//
// Run via: `pnpm --filter @workspace/scripts run check:no-direct-domain-mutations`
// Wire it into CI alongside `typecheck`.

import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Tables the engine owns. Direct mutation outside the executor is
// forbidden so the event log remains the single source of truth.
const FORBIDDEN_TABLES = [
  "testingBatchesTable",
  "todoTasksTable",
  "trackerCampaignsTable",
  "notificationsTable",
] as const;

// The single allowlist: only the executor may mutate the above tables.
// Paths are matched as suffixes against the repo-relative path so this
// works regardless of where the script is invoked from.
const ALLOWLIST_SUFFIXES = [
  join("artifacts", "api-server", "src", "engine", "executor.ts"),
];

// Pre-Phase-5 carve-out: legacy procedural automation in these files
// still mutates domain tables directly. Phase 5 deletes them; until
// then they are exempt so the check can land without breaking the
// build. Remove entries here as each file is migrated.
const PHASE5_LEGACY_EXEMPTIONS = [
  // sync.ts removed in Phase 5g — all engine-owned mutations now go
  // through engine/executor.ts via emit() / executeCreateBatch().
  // testing-batches.ts removed in Phase 11 — PATCH/DELETE use
  // executeUpdateBatchFields / executeDeleteBatch; go-live emits events.
  join("artifacts", "api-server", "src", "routes", "todo-tasks.ts"),
  // CampaignOps redesign — find_winners scheduler emits via the bus
  // (FindWinnersDue → CreateTask) which is enforced by the executor.
  // The file itself only reads campaigns + emits; lint scan still
  // sees the import surface so we exempt explicitly.
  join("artifacts", "api-server", "src", "cron", "find-winners-scheduler.ts"),
  join("artifacts", "api-server", "src", "routes", "queues.ts"),
  join("artifacts", "api-server", "src", "routes", "offers.ts"),
  join("artifacts", "api-server", "src", "routes", "notifications.ts"),
  join("artifacts", "api-server", "src", "routes", "tracker-campaigns.ts"),
  join("artifacts", "api-server", "src", "routes", "dashboard.ts"),
];

// Build a single regex that matches `tx.update(<table>` /
// `db.insert(<table>` etc. for any forbidden table.
const PATTERN = new RegExp(
  String.raw`\b(?:db|tx)\.(?:update|insert|delete)\(\s*(${FORBIDDEN_TABLES.join("|")})\b`,
);

interface Violation {
  file: string;
  line: number;
  text: string;
  table: string;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      // Test files legitimately seed and tear down domain rows
      // (insert workspaces, batches, etc.) so they may bypass the
      // engine. Production code paths must still go through
      // engine/executor.ts.
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
      out.push(full);
    }
  }
}

function isAllowlisted(repoRelative: string, suffixes: readonly string[]): boolean {
  return suffixes.some((s) => repoRelative.endsWith(s));
}

async function main(): Promise<void> {
  const repoRoot = resolve(__dirname, "..", "..");
  const scanRoot = join(repoRoot, "artifacts", "api-server", "src");
  try { statSync(scanRoot); } catch {
    console.error(`[lint] scan root missing: ${scanRoot}`);
    process.exit(2);
  }

  const files: string[] = [];
  await walk(scanRoot, files);

  const violations: Violation[] = [];
  for (const abs of files) {
    const relPath = relative(repoRoot, abs);
    if (isAllowlisted(relPath, ALLOWLIST_SUFFIXES)) continue;
    if (isAllowlisted(relPath, PHASE5_LEGACY_EXEMPTIONS)) continue;

    const text = readFileSync(abs, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(PATTERN);
      if (!m) continue;
      // Skip commented lines.
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      violations.push({
        file: relPath.split(sep).join("/"),
        line: i + 1,
        text: line.trim(),
        table: m[1],
      });
    }
  }

  if (violations.length === 0) {
    console.log(
      `[lint] OK — no direct mutations of engine-owned tables outside ` +
        `engine/executor.ts (scanned ${files.length} files).`,
    );
    return;
  }

  console.error("[lint] direct domain-mutation violations found:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  (${v.table})`);
    console.error(`    ${v.text}`);
  }
  console.error(
    `\n[lint] ${violations.length} violation(s). Route handlers must ` +
      `emit() an event or return an Action — see ` +
      `artifacts/api-server/src/engine/executor.ts.`,
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("[lint] crashed:", err);
  process.exit(2);
});
