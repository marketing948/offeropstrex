# Staging Launch Checklist (VPS)

Operator-ready checklist for the first OfferOps VPS staging launch (app/API + PostgreSQL on the same VPS). Companion to [`docs/INTERNAL_RUNBOOK.md`](./INTERNAL_RUNBOOK.md) — the runbook holds full command detail; this file is the launch-day sequence and sign-off record.

Templates: `deploy/systemd/offerops-api.service.example`, `deploy/nginx/offerops.conf.example`, `deploy/env/offerops.example.env`.

---

## 1. Environment Variables Audit

Source of truth for placeholders: `.env.example` (repo) and `deploy/env/offerops.example.env` (VPS copy at `/etc/offerops/offerops.env`).

### Required at API runtime (staging)

| Variable | Value for staging | Verified |
|----------|-------------------|:--------:|
| `NODE_ENV` | `production` | ☐ |
| `PORT` | `3000` (API exits without it) | ☐ |
| `DATABASE_URL` | `postgres://offerops:...@127.0.0.1:5432/offeropstrex` — localhost only | ☐ |
| `AUTH_TOKEN_SECRET` | Long random value (JWT signing; API throws in production without it) | ☐ |
| `CORS_ORIGIN` | Exact public origin, e.g. `https://staging.offerops.example` (empty = browser requests rejected) | ☐ |
| `SECRETS_ENCRYPTION_KEY` | Long random value (required in production when saving Voluum credentials) | ☐ |

### Build-time only (frontend — set in shell when building, not in API env file)

| Variable | Value for staging | Verified |
|----------|-------------------|:--------:|
| `VITE_ENABLE_VOLUUM` | `false` (changing requires frontend rebuild) | ☐ |
| `BASE_PATH` | `/` | ☐ |

### One-time / deployment-only (bootstrap)

| Variable | Notes | Verified |
|----------|-------|:--------:|
| `BOOTSTRAP_ADMIN_EMAIL` | First admin login email | ☐ |
| `BOOTSTRAP_ADMIN_PASSWORD` | Strong password; do not store in API env file long-term | ☐ |
| `BOOTSTRAP_ADMIN_NAME` | Optional (default `Internal Admin`) | ☐ |
| `BOOTSTRAP_WORKSPACE_NAME` | Optional (default `Default Workspace`) | ☐ |

### Optional (defaults are safe for single-VPS staging)

| Variable | Default | Staging guidance |
|----------|---------|------------------|
| `ENABLE_VOLUUM` | `false` | Keep `false` |
| `LOG_LEVEL` | `info` | `info` |
| `APP_VERSION` | `dev` | Set to git tag/sha for traceability |
| `DEPLOYMENT_TIMESTAMP` | `null` | Set at deploy time |
| `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_MS` | 5 / 15 min | Defaults fine |
| `LOGIN_RATE_LIMIT_DISABLED` | unset | **Never set on staging/prod** |
| `CRON_DISABLED` / `CRON_ENABLED` | crons on | Omit both on single VPS |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | 25000 | Default fine |
| `VOLUUM_SYNC_LOCK_STALE_MS` | 900000 | Default fine |

### Dev/test-only (must NOT be set on staging)

| Variable | Used by | Notes |
|----------|---------|-------|
| `API_PROXY_TARGET` | Vite dev proxy | Dev server only |
| `ENABLE_VOLUUM_DRY_RUN` | Voluum discovery preview tests | Test/diagnostic only |
| `API_BASE_URL` | `scripts/src/test-workspace-isolation.ts` | Test script only |
| `REPL_ID` | Replit Vite plugins | Replit only |
| `ESBUILD_BINARY_PATH` | esbuild platform workaround | Local troubleshooting |

**Audit result:** `.env.example` and `deploy/env/offerops.example.env` cover every required and optional runtime variable. No additions required.

---

## 2. VPS Staging Deployment Checklist

Full commands: runbook → "VPS Staging Deployment".

### Host preparation

- ☐ VPS provisioned (Ubuntu/Debian or equivalent), SSH key access, non-root deploy user
- ☐ Firewall: allow 22 (SSH), 80, 443 only; **block public 3000 and 5432**
- ☐ DNS A record for staging domain points at the VPS
- ☐ Node.js 24 installed; `node -v` shows v24.x
- ☐ `corepack enable && corepack prepare pnpm@latest --activate`; `pnpm -v` works
- ☐ PostgreSQL 16 installed and running (`systemctl status postgresql`)
- ☐ Postgres binds to `127.0.0.1` only (`listen_addresses` in `postgresql.conf`)
- ☐ App database + user created (`offeropstrex` owned by `offerops`)
- ☐ `/etc/offerops/offerops.env` created from `deploy/env/offerops.example.env`, mode `600`, all real values filled
- ☐ Application code deployed to `/opt/offerops` (or chosen path), owned by deploy user

### Build and database

- ☐ `pnpm install` (full install — migrate/bootstrap need `tsx`)
- ☐ `pnpm --filter @workspace/api-server run build`
- ☐ `VITE_ENABLE_VOLUUM=false BASE_PATH=/ pnpm --filter @workspace/offerops run build`
- ☐ Pre-migration backup taken if DB is not empty (see section 4)
- ☐ `pnpm run db:migrate` — expect `Applied migration: 0000_baseline.sql` on clean DB; legacy `0001`–`0021` skipped
- ☐ `pnpm --filter @workspace/api-server run bootstrap:internal` with `BOOTSTRAP_*` vars — expect JSON `{ ok: true, ... }`
- ☐ Bootstrap credentials recorded in the team password manager

### Services

- ☐ systemd unit installed from `deploy/systemd/offerops-api.service.example`; paths adjusted
- ☐ `systemctl daemon-reload && systemctl enable --now offerops-api`
- ☐ `journalctl -u offerops-api` shows `Server listening` and `Background crons enabled`
- ☐ nginx config installed from `deploy/nginx/offerops.conf.example`; domain + static root adjusted
- ☐ `nginx -t` passes; nginx reloaded
- ☐ HTTPS via `certbot --nginx` (or CA of choice); HTTP→HTTPS redirect enabled
- ☐ `CORS_ORIGIN` matches the final HTTPS origin exactly

---

## 3. Post-Deploy Smoke Tests

Run after every staging deploy. All must pass.

| # | Check | Command / action | Expected | Pass |
|---|-------|------------------|----------|:----:|
| 1 | API liveness (local) | `curl -fsS http://127.0.0.1:3000/api/healthz` | `{"status":"ok",...}` | ☐ |
| 2 | API readiness (local) | `curl -fsS http://127.0.0.1:3000/api/readyz` | `status:"ready"`, `db:"ok"`, `rulesRegistry:"ok"` | ☐ |
| 3 | Readiness via nginx | `curl -fsS https://<staging-domain>/api/readyz` | Same as above | ☐ |
| 4 | Frontend served | `curl -fsS https://<staging-domain>/` | HTML with asset links (not API JSON) | ☐ |
| 5 | SPA fallback | `curl -fsS https://<staging-domain>/ops` | Same `index.html` (200, not 404) | ☐ |
| 6 | Login works | Browser: log in with bootstrap admin | Redirect to `/ops` Operations Hub | ☐ |
| 7 | Bad login rejected | Wrong password | 401, friendly error | ☐ |
| 8 | Rate limit active | 6 consecutive bad logins | 6th returns 429 | ☐ |
| 9 | Workspace data loads | Browser: dashboards/batches render without console errors | No 4xx/5xx in network tab | ☐ |
| 10 | Create + delete a test batch | UI flow | Batch appears, tasks seeded, cleanup OK | ☐ |
| 11 | Postgres not public | `nc -zv <staging-ip> 5432` from outside | Connection refused/filtered | ☐ |
| 12 | API port not public | `nc -zv <staging-ip> 3000` from outside | Connection refused/filtered | ☐ |
| 13 | Graceful restart | `systemctl restart offerops-api` | Clean shutdown logs; `readyz` green within seconds | ☐ |
| 14 | Voluum dormant | `curl https://<staging-domain>/api/sync/voluum/status` (auth'd) | 410 Gone (flag off) | ☐ |

---

## 4. Backup / Restore Procedure

Full commands: runbook → "PostgreSQL backup and restore (VPS)".

### Setup (once)

- ☐ `/var/backups/offerops` created, owned by `postgres`
- ☐ Daily cron installed: `pg_dump -Fc -d offeropstrex` at 03:00 with 14-day retention
- ☐ Off-VPS copy configured (object storage / second host / backup provider) — **a backup on the same VPS is not a backup**

### Before every migration or risky change

- ☐ Manual dump: `sudo -u postgres pg_dump -Fc -d offeropstrex -f /var/backups/offerops/pre-deploy-$(date +%Y%m%d%H%M).dump`
- ☐ Dump file size is non-trivial (`ls -lh`) and recent

### Restore drill (must be completed before production go-live)

- ☐ Restore latest dump into a scratch database: `createdb offerops_restore_test && pg_restore -d offerops_restore_test <dump>`
- ☐ Row counts spot-checked against source (`workspaces`, `employees`, `testing_batches`, `campaigns`)
- ☐ Scratch database dropped after verification
- ☐ Full restore procedure (stop API → drop/create → restore → start API) executed at least once on staging
- ☐ Time-to-restore recorded: ______ minutes

**Rule:** an untested restore is an unverified backup. The drill above is a go/no-go item.

---

## 5. Go / No-Go Checklist

All items must be ✅ before declaring staging launched (and again before any production go-live).

| # | Gate | Evidence | Go |
|---|------|----------|:--:|
| 1 | Root build gates green | `pnpm run typecheck` + `pnpm run build` pass at the deployed commit | ☐ |
| 2 | API unit tests green | `pnpm --filter @workspace/api-server test` (59/59 at time of writing) | ☐ |
| 3 | Clean-DB migration verified | `db:migrate` applied baseline only; `offerops_schema_migrations` has `0000_baseline.sql` | ☐ |
| 4 | No legacy migrations replayed | Runner log shows `Skipping 21 legacy migration(s)` | ☐ |
| 5 | Bootstrap admin works | Login + `/ops` loads | ☐ |
| 6 | All required env vars set | Section 1 tables all checked | ☐ |
| 7 | HTTPS active | Valid certificate, HTTP redirects | ☐ |
| 8 | Postgres + API not publicly reachable | Smoke tests #11–#12 | ☐ |
| 9 | Daily backups running | First cron dump exists; off-VPS copy verified | ☐ |
| 10 | Restore drill completed | Section 4 drill checklist done | ☐ |
| 11 | Smoke tests all pass | Section 3 table complete | ☐ |
| 12 | Rollback path understood | Operator can name the previous deployable commit/tag and the restore steps | ☐ |
| 13 | Deferred risks acknowledged | Section 6 reviewed and accepted by owner | ☐ |

**Decision:** GO ☐ / NO-GO ☐  Date: ________ Operator: ________

---

## 6. Known Deferred Risks (accepted for staging)

Carried from the production readiness audit. Each is deliberately deferred — staging launch does not require them, production hardening will.

| # | Risk | Severity | Why deferred | Revisit before |
|---|------|----------|--------------|----------------|
| 1 | Password hashing is SHA-256 + static salt (not bcrypt/argon2) | P1 | Auth rework slice planned separately; internal-only user base | Production |
| 2 | JWT stored in `localStorage` (XSS-stealable), not HttpOnly cookie | P1 | Cookie migration is a larger frontend+API change | Production |
| 3 | Login rate limiting is in-memory (resets on restart; per-process) | P1 | Acceptable on single VPS, single process | Multi-instance scaling |
| 4 | No CI/CD pipeline — deploys are manual runbook steps | P2 | Checklist discipline covers staging | Production |
| 5 | API binds to all interfaces on `PORT`; isolation relies on firewall + nginx | P2 | Documented in runbook; firewall rules are a launch gate | Production hardening |
| 6 | Bootstrap does not reset password for an existing admin email | P2 | Recovery = manual DB update or new email | When admin recovery matters |
| 7 | Frontend bundle ~1.5 MB (no code splitting) | P2 | Staging performance acceptable | UX polish phase |
| 8 | No APM/metrics; observability = pino logs + health endpoints | P2 | journalctl + healthz/readyz sufficient for staging | Production |

---

## Document history

- 2026-06-11: Initial version for first VPS staging launch.
