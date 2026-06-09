# SQL migrations

## Policy

| File range | Role | Runs on clean staging/prod? |
|------------|------|-----------------------------|
| `0000_baseline.sql` | Full current Drizzle schema bootstrap | **Yes** (first) |
| `0001`–`0021` | Legacy incremental push-history deltas | **No** (dev history only) |
| `0022+` | Forward migrations after baseline policy | **Yes** (after baseline) |

**Source of truth:** Drizzle schema in `lib/db/src/schema/`.

**Development:** `pnpm --filter @workspace/db run push` is allowed for local iteration.

**Staging/production:** `pnpm run db:migrate` only. Never replay `0001`–`0021` on fresh databases.

## Clean database

`pnpm run db:migrate` detects an empty database (no `workspaces` table) and applies:

1. `0000_baseline.sql`
2. Any forward migrations (`0022+`)

Legacy files are skipped automatically.

## Existing push-based database

If the schema was created with `drizzle-kit push` and `offerops_schema_migrations` has no baseline row:

1. `pnpm run db:baseline-align` — validates schema markers, records the baseline checksum **without** running legacy SQL
2. `pnpm run db:migrate` — applies only new forward migrations

`db:migrate` fails loudly on this state instead of guessing.

## Tracking

Applied migrations are recorded in `offerops_schema_migrations` with SHA-256 checksums. Do not edit files after they have been applied; add a new forward migration instead.

## Adding migrations

1. Update Drizzle schema in `lib/db/src/schema/`.
2. Add `00NN_descriptive_name.sql` with `NN >= 22`.
3. Run `pnpm run db:migrate` on staging before production.

See also: `docs/INTERNAL_RUNBOOK.md`.
