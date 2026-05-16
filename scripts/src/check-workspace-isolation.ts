/**
 * CI guardrail for Phase 1 (workspace isolation).
 *
 * Greps every domain table insert in the api-server for an explicit
 * `workspaceId:` field. Fails (exit 1) if any insert site appears to
 * skip workspace scoping. Run via `pnpm run check:workspace-isolation`.
 *
 * The legacy `default(1)` fallback was removed in this phase; any
 * insert that omits workspaceId will now fail at runtime with a NOT
 * NULL violation. This check surfaces the regression at build time
 * instead of in production.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// This script is invoked from the @workspace/scripts package, so the cwd
// is `scripts/`. Resolve roots from this file's location so paths work
// regardless of where the script is executed from.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

const DOMAIN_TABLES = [
  "testingBatchesTable",
  "offersTable",
  "todoTasksTable",
  "notificationsTable",
  "trafficSourcePlansTable",
  "dailyReportsTable",
  "voluumCampaignMappingsTable",
  "importedOffersTable",
  "settingsTable",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const ROOTS = [
  resolve(REPO_ROOT, "artifacts/api-server/src"),
];

const files = Array.from(new Set(ROOTS.flatMap(r => {
  try { return walk(r); } catch { return []; }
}))).filter(f => !f.endsWith(".test.ts"));

if (files.length === 0) {
  console.error(`[check-workspace-isolation] FATAL: scanned 0 files (REPO_ROOT=${REPO_ROOT})`);
  process.exit(2);
}
console.error(`[check-workspace-isolation] scanning ${files.length} files under ${REPO_ROOT}`);

/**
 * Extract a balanced `(...)` slice starting at position `start` (which
 * must point at the opening paren). Tracks string and template-literal
 * context so embedded `(` / `)` inside `"..."`, `'...'`, or `` `...` ``
 * do NOT prematurely close the slice. Returns the inner content (not
 * including the outer parens) plus the position just past the closing `)`.
 *
 * This replaces a previous lazy-regex approach that produced false
 * positives whenever an insert's values object embedded a string with
 * literal parens (e.g. notification messages: `"...threshold reached!"`).
 */
function readBalancedParens(src: string, start: number): { inner: string; end: number } | null {
  if (src[start] !== "(") return null;
  let depth = 0;
  let i = start;
  let inSingle = false, inDouble = false, inTemplate = false, templateExprDepth = 0;
  let inLineComment = false, inBlockComment = false;
  for (; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (inLineComment) { if (c === "\n") inLineComment = false; continue; }
    if (inBlockComment) { if (c === "*" && n === "/") { inBlockComment = false; i++; } continue; }
    if (inSingle) { if (c === "\\") { i++; continue; } if (c === "'") inSingle = false; continue; }
    if (inDouble) { if (c === "\\") { i++; continue; } if (c === '"') inDouble = false; continue; }
    if (inTemplate) {
      if (c === "\\") { i++; continue; }
      if (c === "$" && n === "{") { templateExprDepth++; i++; continue; }
      if (c === "`" && templateExprDepth === 0) { inTemplate = false; continue; }
      if (c === "}" && templateExprDepth > 0) { templateExprDepth--; continue; }
      // inside template: still need to track parens of the embedded ${} expression
      if (templateExprDepth > 0) {
        if (c === "(") depth++;
        else if (c === ")") depth--;
      }
      continue;
    }
    if (c === "/" && n === "/") { inLineComment = true; i++; continue; }
    if (c === "/" && n === "*") { inBlockComment = true; i++; continue; }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === "`") { inTemplate = true; continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        return { inner: src.slice(start + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

let problems = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const tbl of DOMAIN_TABLES) {
    // Match the *header* `db.insert(<table>).values(`. We then read a
    // properly balanced argument list (string/template-literal aware) so
    // notification messages with literal parens don't truncate the scan.
    const headerRe = new RegExp(`(?:db|tx|trx|t)\\.insert\\(\\s*${tbl}\\s*\\)\\s*\\.values\\(`, "g");
    let h: RegExpExecArray | null;
    while ((h = headerRe.exec(text)) !== null) {
      const openParen = h.index + h[0].length - 1;
      const slice = readBalancedParens(text, openParen);
      if (!slice) continue;
      const block = slice.inner;
      // We require an explicit `workspaceId` key inside the values block.
      // A bare `...parsed.data` spread is NOT enough: zod-validated bodies
      // can have workspaceId as optional, so the spread alone could let a
      // null/undefined slip through. Every insert must add an explicit
      // `workspaceId` key (typically sourced from requireWorkspaceAccess).
      const hasField = /\bworkspaceId\b\s*[:,}]/.test(block);
      if (!hasField) {
        const lineNo = text.slice(0, h.index).split("\n").length;
        console.error(`MISSING workspaceId: ${file}:${lineNo}  insert into ${tbl}`);
        problems++;
      }
    }
  }
}

if (problems > 0) {
  console.error(`\n[check-workspace-isolation] ${problems} insert site(s) without workspaceId. Phase 1 forbids this.`);
  process.exit(1);
}
console.log("[check-workspace-isolation] OK — every domain insert carries workspaceId.");
