# Internal Deployment Runbook

This runbook covers a fresh internal host or VPS deployment for OfferOps. It is intentionally limited to existing commands and local/internal environment scaffolding.

For launch-day sequencing, smoke tests, and the go/no-go gate, use the companion [`docs/STAGING_LAUNCH_CHECKLIST.md`](./STAGING_LAUNCH_CHECKLIST.md).

## Database Migration Policy

- **Schema source of truth:** Drizzle schema in `lib/db/src/schema/`.
- **Greenfield bootstrap:** `lib/db/migrations/0000_baseline.sql` (full current schema for clean databases).
- **Legacy history (do not replay on staging/prod):** `0001`–`0021` are incremental dev push-history files; the migration runner skips them automatically.
- **Forward migrations:** add new SQL files as `0022+` after the baseline policy (see `lib/db/migrations/README.md`).
- **Development:** `pnpm --filter @workspace/db run push` is allowed for local iteration.
- **Staging/production command:** `pnpm run db:migrate` only. **Do not use `drizzle-kit push`** unless explicitly approved for an emergency.
- **Migration tracking table:** `offerops_schema_migrations` (SHA-256 checksum per applied file).
- **Rule:** migrations must complete before API traffic is served. **Bootstrap runs only after migrations.**

### Clean database (staging/prod bring-up)

```sh
pnpm run db:migrate
```

Applies `0000_baseline.sql`, then any `0022+` forward migrations. Never replays `0001`–`0021`.

### Existing push-based database (local/dev schema from drizzle-kit push)

If application tables already exist but no baseline marker is recorded:

```sh
pnpm run db:baseline-align
```

This validates key schema markers, records the baseline checksum **without** replaying legacy SQL, then runs forward migrations. `pnpm run db:migrate` alone fails loudly on this state instead of guessing.

## Host Prerequisites

- Docker with Docker Compose v2.
- Node.js 24 with `corepack`, or another Node install that can activate pnpm.
- pnpm activated with Corepack:
  ```sh
  corepack enable
  corepack prepare pnpm@latest --activate
  pnpm -v
  ```
- Required environment variables:
  ```sh
  export DATABASE_URL=postgres://offerops:offerops_local_only@localhost:5432/offeropstrex
  export AUTH_TOKEN_SECRET=replace-with-a-long-random-secret
  export CORS_ORIGIN=http://localhost:5173
  export SECRETS_ENCRYPTION_KEY=replace-with-a-long-random-secret
  export ENABLE_VOLUUM=false
  export VITE_ENABLE_VOLUUM=false
  ```
- Production also requires `AUTH_TOKEN_SECRET` and `CORS_ORIGIN` (comma-separated if multiple frontend origins). Without `CORS_ORIGIN` in production, cross-origin browser requests are rejected. Login rate limiting defaults to 5 failed attempts per 15 minutes per IP+email (`LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MS`; set `LOGIN_RATE_LIMIT_DISABLED=true` only for local debugging).
- Voluum access keys are encrypted at rest with `SECRETS_ENCRYPTION_KEY` (required in production when credentials are saved). API responses never include raw keys — only `hasVoluumCredentials` and an optional masked suffix.
- **Background crons (API process):** In-process schedulers start by default (local dev). For cloud-style deployments with **multiple API replicas**, set **`CRON_DISABLED=true`** on the **web / HTTP tier** so each replica does **not** run the same schedules. Run a **separate worker** instance **without** `CRON_DISABLED` (or with `CRON_ENABLED=true`) so overdue tasks, reconciliation, and related jobs still run. If both `CRON_DISABLED` and `CRON_ENABLED` are set, **`CRON_DISABLED=true` wins.** Server logs emit `Background crons enabled` or `Background crons disabled` with a short reason at startup.
- **Graceful shutdown:** The API handles **SIGTERM** and **SIGINT** by stopping new HTTP connections (`server.close`), stopping background crons, then closing the Postgres pool. If shutdown does not finish in time (default **25s**, override with **`GRACEFUL_SHUTDOWN_TIMEOUT_MS`**, minimum **3000**), the process force-exits.
- **Voluum sync concurrency lock:** Voluum sync is serialized per workspace (one active sync per workspace at a time). A second trigger receives **409 Conflict** (`Voluum sync already running for this workspace`) and does not start duplicate work. Locks are recovered when stale based on **`VOLUUM_SYNC_LOCK_STALE_MS`** (default **900000** ms / 15 minutes, minimum **60000** ms).
- Ports:
  - `5432` for local Postgres from `docker-compose.yml`.
  - API `PORT`, for example `3000`.
  - Frontend `PORT`, for example `5173`.
  - For production-style browser use, serve the frontend and `/api` on the same origin, or put a reverse proxy in front of both. In Vite dev, `/api` is proxied to `API_PROXY_TARGET` or `http://localhost:3000` by default.

## Fresh Clone To Internal Run

Install dependencies:

```sh
pnpm install
```

Start Postgres:

```sh
docker compose up -d postgres
docker compose ps
```

Set runtime environment:

```sh
export DATABASE_URL=postgres://offerops:offerops_local_only@localhost:5432/offeropstrex
export AUTH_TOKEN_SECRET=replace-with-a-long-random-secret
export CORS_ORIGIN=http://localhost:5173
export SECRETS_ENCRYPTION_KEY=replace-with-a-long-random-secret
export ENABLE_VOLUUM=false
export VITE_ENABLE_VOLUUM=false
```

If `tsx`, `drizzle-kit`, or Vite report a missing esbuild platform package, install a matching user-local esbuild binary and point tools at it:

```sh
npm install -g esbuild@0.27.3
export ESBUILD_BINARY_PATH="$(command -v esbuild)"
```

Run DB migrations (safe for repeated runs):

```sh
pnpm run db:migrate
```

Bootstrap the first internal admin and workspace:

```sh
BOOTSTRAP_ADMIN_EMAIL=admin@example.internal \
BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-real-internal-password \
BOOTSTRAP_ADMIN_NAME="Internal Admin" \
BOOTSTRAP_WORKSPACE_NAME="Default Workspace" \
pnpm --filter @workspace/api-server run bootstrap:internal
```

`bootstrap:internal` is idempotent for the same admin email/workspace setup:
- Reuses or marks an existing default workspace.
- Upgrades existing user to admin/active if needed.
- Ensures workspace assignment exists.

Build library declarations before checking the API package:

```sh
pnpm run typecheck:libs
pnpm --filter @workspace/api-server typecheck
```

Run route tests against the local Postgres:

```sh
pnpm --filter @workspace/api-server test:routes
```

Start the API server for an internal live smoke test:

```sh
PORT=3000 pnpm --filter @workspace/api-server run dev
```

For a built API process:

```sh
pnpm --filter @workspace/api-server run build
PORT=3000 node --enable-source-maps ./artifacts/api-server/dist/index.mjs
```

Start the frontend:

```sh
PORT=5173 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3000 pnpm --filter @workspace/offerops run dev
```

For a built frontend preview:

```sh
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/offerops run build
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/offerops run serve
```

## Internal Smoke Checks

Check Postgres is reachable:

```sh
docker compose exec postgres pg_isready -U offerops -d offeropstrex
```

Check the API health route:

```sh
curl -fsS http://localhost:3000/api/healthz
```

Expected response:

```json
{"status":"ok"}
```

Check that the frontend can reach the API:

- Preferred internal shape: expose the frontend and API behind one origin, with `/api/*` routed to the API server and all other paths routed to the frontend.
- Vite dev shape: `PORT=5173 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3000 pnpm --filter @workspace/offerops run dev`, then verify browser network requests to `/api/*` return API responses, not the frontend HTML.

Local URLs with the example ports:

- API: `http://localhost:3000`
- API health: `http://localhost:3000/api/healthz`
- Frontend: `http://localhost:5173`

## Staging / Production Deploy Order

1. Deploy code/artifact for the target environment.
2. Set environment-specific `DATABASE_URL` (staging and production must use separate DBs).
3. Run migrations:
   ```sh
   pnpm run db:migrate
   ```
4. Run bootstrap only when required (first environment bring-up or admin recovery):
   ```sh
   BOOTSTRAP_ADMIN_EMAIL=... \
   BOOTSTRAP_ADMIN_PASSWORD=... \
   pnpm --filter @workspace/api-server run bootstrap:internal
   ```
5. Start/restart API process after migrations complete.

Never start a new API build against an unmigrated database.

## VPS Staging Deployment (app + PostgreSQL on same host)

This section covers a first-phase VPS where the API, static frontend, and PostgreSQL all run on one machine. Templates live under `deploy/` (systemd, nginx, example env). **Do not commit real secrets.**

### 1. Host prerequisites

**Node.js 24 + pnpm (Corepack):**

```sh
# Example: Ubuntu/Debian — install Node 24 from your distro or NodeSource, then:
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v
node -v   # expect v24.x
```

**PostgreSQL 16 (native, same VPS):**

```sh
# Example: Ubuntu/Debian
sudo apt update
sudo apt install -y postgresql-16 postgresql-client-16

sudo systemctl enable --now postgresql
```

**Create database and application user:**

```sh
sudo -u postgres psql <<'SQL'
CREATE USER offerops WITH PASSWORD 'replace-with-a-strong-password';
CREATE DATABASE offeropstrex OWNER offerops;
GRANT ALL PRIVILEGES ON DATABASE offeropstrex TO offerops;
SQL
```

**PostgreSQL must not be exposed publicly:**

- Bind to `127.0.0.1` only (check `listen_addresses` in `postgresql.conf`).
- Do **not** open port `5432` in the host firewall for the public internet.
- Use `DATABASE_URL` with `localhost` or `127.0.0.1`, e.g. `postgres://offerops:...@127.0.0.1:5432/offeropstrex`.

**Application layout (example):**

```sh
sudo useradd -r -m -d /opt/offerops -s /usr/sbin/nologin offerops || true
sudo mkdir -p /etc/offerops
sudo cp deploy/env/offerops.example.env /etc/offerops/offerops.env
sudo chmod 600 /etc/offerops/offerops.env
# Edit /etc/offerops/offerops.env with real secrets (AUTH_TOKEN_SECRET, DATABASE_URL, CORS_ORIGIN, etc.)
```

Clone or deploy application code to `/opt/offerops` (or your chosen path) owned by the deploy user.

### 2. Reverse proxy and network shape

- **nginx** (or Caddy) terminates HTTP/HTTPS on ports 80/443.
- **Frontend:** static files from `artifacts/offerops/dist/public` (after Vite build).
- **API:** proxy `/api/` to `http://127.0.0.1:3000` (localhost only).
- **Readiness:** use `GET /api/readyz` (checks DB + rules registry). Use `/api/healthz` for liveness only.
- **Firewall:** allow 80/443 (and SSH); block public access to API port 3000 and Postgres 5432.

Example nginx config: `deploy/nginx/offerops.conf.example`

```sh
sudo cp deploy/nginx/offerops.conf.example /etc/nginx/sites-available/offerops
sudo ln -sf /etc/nginx/sites-available/offerops /etc/nginx/sites-enabled/
sudo nginx -t
```

Enable HTTPS with Let's Encrypt (`certbot --nginx`) after DNS points at the VPS. See commented HTTPS block in the nginx example.

### 3. Environment variables

Copy and edit templates:

- Repo reference: `.env.example`
- VPS file: `deploy/env/offerops.example.env` → `/etc/offerops/offerops.env`

| Variable | When required | Notes |
|----------|---------------|-------|
| `NODE_ENV` | Always (prod) | Set `production` on VPS |
| `PORT` | Always | `3000` — API listens on this port; nginx proxies to it |
| `DATABASE_URL` | Always | Localhost Postgres only |
| `AUTH_TOKEN_SECRET` | Always (prod) | JWT signing; **not** `SESSION_SECRET` |
| `CORS_ORIGIN` | Always (prod) | Must match public site origin, e.g. `https://staging.example.com` |
| `SECRETS_ENCRYPTION_KEY` | When storing Voluum creds | Required in production for encryption |
| `ENABLE_VOLUUM` | Optional | Default `false` |
| `VITE_ENABLE_VOLUUM` | **Build-time only** | Set when building frontend; requires rebuild to change |
| `BASE_PATH` | **Build-time only** | Usually `/` on VPS |
| `BOOTSTRAP_*` | **One-time / deployment-only** | First admin bring-up after migrate |
| `LOG_LEVEL`, `APP_VERSION`, `DEPLOYMENT_TIMESTAMP` | Optional | Observability |

### 4. Deployment command order

Run from the application root (e.g. `/opt/offerops`) as the deploy user, with `/etc/offerops/offerops.env` loaded for migrate/bootstrap/API:

```sh
# 1. Install dependencies (full install — migrate/bootstrap use tsx)
set -a && source /etc/offerops/offerops.env && set +a
pnpm install

# 2. Build API
pnpm --filter @workspace/api-server run build

# 3. Build frontend (build-time env — VITE_* and BASE_PATH)
VITE_ENABLE_VOLUUM=false BASE_PATH=/ \
  pnpm --filter @workspace/offerops run build

# 4. Database migrations (forward-only; never replay 0001–0021 on fresh VPS)
pnpm run db:migrate

# 5. Bootstrap (first bring-up or admin recovery only)
BOOTSTRAP_ADMIN_EMAIL=admin@example.internal \
BOOTSTRAP_ADMIN_PASSWORD='replace-me' \
BOOTSTRAP_ADMIN_NAME="Staging Admin" \
BOOTSTRAP_WORKSPACE_NAME="Default Workspace" \
pnpm --filter @workspace/api-server run bootstrap:internal

# 6. Start or restart API service
sudo cp deploy/systemd/offerops-api.service.example /etc/systemd/system/offerops-api.service
# Edit WorkingDirectory/ExecStart paths if not /opt/offerops
sudo systemctl daemon-reload
sudo systemctl enable --now offerops-api
sudo systemctl restart offerops-api

# 7. Reload reverse proxy
sudo nginx -t && sudo systemctl reload nginx
```

**Smoke checks:**

```sh
curl -fsS http://127.0.0.1:3000/api/readyz    # via API directly (localhost)
curl -fsS https://staging.offerops.example/api/readyz   # via nginx
curl -fsS https://staging.offerops.example/api/healthz
```

### 5. systemd API service

Template: `deploy/systemd/offerops-api.service.example`

- Uses `EnvironmentFile=/etc/offerops/offerops.env`
- Sets `NODE_ENV=production`
- Runs built artifact: `node --enable-source-maps .../artifacts/api-server/dist/index.mjs`
- Ensure host firewall blocks external access to port 3000; only nginx on localhost should reach the API.

### 6. PostgreSQL backup and restore (VPS)

Run backups **before** migrations or destructive changes. Store dumps **off the VPS** (object storage, another host, or backup provider).

**Daily backup example (cron as root or postgres user):**

```sh
# /etc/cron.d/offerops-pg-backup (example — adjust paths and retention)
0 3 * * * postgres pg_dump -Fc -d offeropstrex -f /var/backups/offerops/offeropstrex-$(date +\%Y\%m\%d).dump && find /var/backups/offerops -name '*.dump' -mtime +14 -delete
```

Create backup directory first:

```sh
sudo mkdir -p /var/backups/offerops
sudo chown postgres:postgres /var/backups/offerops
```

**Restore example (destructive — test on staging first):**

```sh
sudo systemctl stop offerops-api
sudo -u postgres dropdb offeropstrex
sudo -u postgres createdb offeropstrex -O offerops
sudo -u postgres pg_restore -d offeropstrex /var/backups/offerops/offeropstrex-YYYYMMDD.dump
sudo systemctl start offerops-api
```

**Important:** Practice restore on a non-production database before relying on backups for production recovery.

### 7. Rollback notes (VPS)

| Scenario | Action |
|----------|--------|
| **Application rollback** | Deploy previous git tag/build artifacts; `systemctl restart offerops-api`; reload nginx if static assets changed |
| **Database schema** | Forward-only — rolled-back app may still run against newer schema; prefer compatible releases |
| **Failed migration** | Do not edit applied migration history; restore DB from pre-migrate backup |
| **Destructive mistake** | Restore from backup; re-run bootstrap only if admin/workspace data was lost |

## Rollback Caveats

- OfferOps migrations are forward-only SQL files.
- If an application deploy must be rolled back, the DB usually stays at the newer schema version.
- For failed migrations, restore from a pre-deploy DB backup/snapshot rather than manually editing applied migration history.
- Do not edit already-applied SQL migration files; add a new migration for corrective changes.

## Troubleshooting

`DATABASE_URL must be set`:

- Export `DATABASE_URL` in the same shell that runs DB, bootstrap, API, or route-test commands.
- Use `.env.example` as the local placeholder format, but do not commit real secrets.

`Migration command fails`:

- Ensure the target DB user can create tables and run DDL.
- Re-run `pnpm run db:migrate` (it is repeatable and skips already-applied files with checksum validation).
- If a migration file was modified after apply, the runner will fail with a checksum mismatch; restore the original file and add a new corrective migration.
- If the error mentions an existing schema without a baseline marker, run `pnpm run db:baseline-align` once, then `pnpm run db:migrate`.
- Never replay legacy migrations `0001`–`0021` on staging/production; they are dev-history only.

`ECONNREFUSED` to Postgres:

- Start Postgres with `docker compose up -d postgres`.
- Confirm it is healthy with `docker compose ps` and `docker compose exec postgres pg_isready -U offerops -d offeropstrex`.
- Confirm `DATABASE_URL` points to the running host and port.

`TS6305` declaration build errors:

- Build referenced libraries first:
  ```sh
  pnpm run typecheck:libs
  pnpm --filter @workspace/api-server typecheck
  ```
- Do not loosen TypeScript settings to bypass these errors.

Missing `@esbuild/darwin-arm64` or another esbuild platform package:

- Use a matching standalone esbuild binary:
  ```sh
  npm install -g esbuild@0.27.3
  export ESBUILD_BINARY_PATH="$(command -v esbuild)"
  ```

`pnpm`, `corepack`, or `npm` unavailable:

- Install a full Node.js 24 distribution that includes npm and Corepack.
- Then run:
  ```sh
  corepack enable
  corepack prepare pnpm@latest --activate
  pnpm -v
  ```
