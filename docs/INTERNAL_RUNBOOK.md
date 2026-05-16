# Internal Deployment Runbook

This runbook covers a fresh internal host or VPS deployment for OfferOps. It is intentionally limited to existing commands and local/internal environment scaffolding.

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
  export ENABLE_VOLUUM=false
  export VITE_ENABLE_VOLUUM=false
  ```
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
export ENABLE_VOLUUM=false
export VITE_ENABLE_VOLUUM=false
```

If `tsx`, `drizzle-kit`, or Vite report a missing esbuild platform package, install a matching user-local esbuild binary and point tools at it:

```sh
npm install -g esbuild@0.27.3
export ESBUILD_BINARY_PATH="$(command -v esbuild)"
```

Push the DB schema:

```sh
pnpm --filter @workspace/db run push
```

Bootstrap the first internal admin and workspace:

```sh
BOOTSTRAP_ADMIN_EMAIL=admin@example.internal \
BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-real-internal-password \
BOOTSTRAP_ADMIN_NAME="Internal Admin" \
BOOTSTRAP_WORKSPACE_NAME="Default Workspace" \
pnpm --filter @workspace/api-server run bootstrap:internal
```

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

## Troubleshooting

`DATABASE_URL must be set`:

- Export `DATABASE_URL` in the same shell that runs DB, bootstrap, API, or route-test commands.
- Use `.env.example` as the local placeholder format, but do not commit real secrets.

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
