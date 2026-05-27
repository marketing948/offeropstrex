# Bootstrap and seeded login (environment)

## When this applies

If **`admin@offerops.com` / `password123` (or other seeded credentials)** fail to sign in **or** the UI shows empty workspace-dependent screens, the cause is often **data**, not application code.

The API **does not seed users automatically** on every deploy. A fresh or reset database may have **no** seeded admin, **no** default workspace row, or **no** `employee_workspace_assignments` row linking the admin to that workspace.

## Fix: run internal bootstrap against the target database

From `artifacts/api-server`, with **`DATABASE_URL`** pointing at the same database your API uses:

```bash
DATABASE_URL="postgres://…" \
BOOTSTRAP_ADMIN_EMAIL="admin@offerops.com" \
BOOTSTRAP_ADMIN_PASSWORD="password123" \
pnpm run bootstrap:internal
```

Optional: `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_WORKSPACE_NAME` (defaults to sensible values).

Script: `src/scripts/bootstrap-internal.ts` — ensures default workspace, admin user, hashed password, and workspace membership.

## Verification checklist

After bootstrap, confirm:

1. **Seeded admin exists** — `employees` row for `admin@offerops.com`, `status = active`, `role = admin`.
2. **Default workspace exists** — `workspaces` row (e.g. name “Default Workspace”) with **`is_default = true`** (and typically `is_active = true`).
3. **Admin is assigned to that workspace** — row in **`employee_workspace_assignments`** linking the admin’s `employee_id` to the workspace id (required for **`GET /api/auth/my-workspaces`**; there is **no** “see all workspaces” fallback for admins).
4. **`GET /api/auth/my-workspaces`** (with Bearer token from login) returns **at least one** workspace **and exactly one with `isActive: true`** (derived from `employee.active_workspace_id` vs assignments and default workspace fallbacks — see `serializeWorkspacesForEmployee` in `src/lib/active-workspace.ts`).

If login returns **401** with “Invalid email or password”, the admin row or password hash is wrong — re-run bootstrap or fix the DB.

Login and `/auth/me` do **not** use cookies in this stack; the client stores **`offerops_session`** (JSON with `token` + `employee`) in **localStorage**.

Bearer tokens are **signed JWTs** (8h expiry). Set **`AUTH_TOKEN_SECRET`** to a long random value in production (required when `NODE_ENV=production`). Local dev may omit it; the API uses a dev-only fallback secret. Legacy base64 tokens are rejected.

Set **`CORS_ORIGIN`** to your frontend origin(s) in production (comma-separated). Repeated failed logins return **429** after the configured limit (default 5 failures per 15 minutes per IP+email).

Voluum **access keys** are encrypted in `workspaces.voluum_access_key` using **`SECRETS_ENCRYPTION_KEY`** (required in production). The API never returns the raw key; use Settings to rotate credentials by submitting a new key.

## Frontend expectations (after successful login)

Workspace state comes from **`GET /api/auth/my-workspaces`**. Without assignments, the list is empty and OfferOps workspace-dependent UI may show loading or **“Workspace configuration unavailable”** rather than seeded defaults — fixing data (bootstrap/membership) resolves that without code changes.

## Related routes

| Route | Purpose |
|-------|---------|
| `POST /api/auth/login` | Credentials → token + employee JSON |
| `GET /api/auth/me` | Current employee by Bearer token |
| `GET /api/auth/my-workspaces` | Assigned workspaces + `isActive` flags |
| `PATCH /api/workspaces/:id/activate` | Persist active workspace on the employee |

---

*Last documented: seeded-login / workspace-empty symptoms traced to bootstrap and DB membership.*
