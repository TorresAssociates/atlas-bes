# ATLASRain BES

Backend Engine Service for ATLASRain — the consolidated REST API for the flood
early warning and monitoring platform.

## Prerequisites

- **[Bun](https://bun.sh)** ≥ 1.0 — runtime, package manager, test runner
- **[Docker](https://docs.docker.com/get-docker/)** with Compose v2 — local Postgres

No Node, no npm, no local psql needed — psql runs inside the compose container.

## First-time setup

```bash
git clone <repo-url> atlas-bes && cd atlas-bes
bun install                  # install dependencies from bun.lock
cp .env.example .env         # then fill in the blanks (see Environment below)
docker compose up -d         # start local Postgres in the background
bun run db:sync              # apply local scratch schema + seed + regenerate types
bun run dev                  # dev server with watch mode
```

Then check `http://localhost:8000/health` and `http://localhost:8000/docs`.

## Environment

Copy `.env.example` to `.env`. Every variable is validated at boot via
`@fastify/env` — the process refuses to start if a required one is missing.

```bash
cp .env.example .env
openssl rand -base64 32      # generate a value for BETTER_AUTH_SECRET
```

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Postgres connection string. The default points at the compose `db` service. |
| `PORT` | HTTP port (default 8000). |
| `LOG_LEVEL` | Pino level: `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`\|`silent` (default `info`). |
| `AWS_REGION` | Local development only — Fargate injects it in production. |
| `S3_ASSETS_BUCKET` | Bucket holding map assets (PMTiles, rasters, manifests) that BES lists and signs URLs for. |
| `BETTER_AUTH_SECRET` | Session signing secret. Generate with the openssl command above. |
| `BETTER_AUTH_URL` | Publicly reachable origin of this API. `http://localhost:8000` locally; the ALB/CloudFront hostname in production. A wrong value breaks auth in confusing ways. |

Never put AWS credentials in env — the ECS task role provides them, and the SDK picks them up automatically.

## Docker Compose

```bash
docker compose up -d               # start Postgres in the background
docker compose down                # stop everything (data survives in the volume)
docker compose logs -f db          # tail database logs
docker compose exec db psql -U postgres -d atlas   # open a psql shell
docker compose down -v             # stop AND wipe the volume — destroys all local data
docker compose --profile app up --build   # also build & run the API in a container
```

The `app` service is profile-gated so plain `docker compose up -d` starts only
the database. The containerized API reads your `.env` for secrets but overrides
`DATABASE_URL` to reach the `db` service over the compose network.

## Local schema workflow

**`db/local/` is a design scratchpad, NOT the source of truth.** Real schema
DDL lives in a separate migrations repository. See
[db/local/README.md](db/local/README.md) for the lifecycle.

```bash
bun run db:reset    # DROP schema public CASCADE + re-run db/local/schema.sql — destroys local data
bun run db:seed     # apply db/local/seed.sql
bun run db:codegen  # regenerate src/db/types.ts from the live local database
bun run db:sync     # all three, in that order
```

Workflow: edit `db/local/schema.sql`, run `bun run db:sync`, and
`src/db/types.ts` regenerates so every Kysely query typechecks against the
schema you just sketched. If a query stops typechecking after a schema change,
the schema moved — regenerate and fix the query; never cast around it.
`src/db/types.ts` is generated and committed (so CI can typecheck without a
database) — never hand-edit it.

All `db:*` scripts run psql *inside* the compose container with
`ON_ERROR_STOP=1`, so a broken SQL file fails loudly and you don't need psql
installed locally.

## Running the server

```bash
bun run dev     # watch mode — restarts on file change
bun run start   # production mode, no watch
```

- `GET /health` — liveness only, no dependency checks. This is the ALB target.
- `GET /ready` — readiness, backed by an interval database probe. Deployment
  gating and diagnostics only; never wired to the ALB.
- `GET /docs` — Swagger UI generated from the TypeBox route schemas.

The server binds `127.0.0.1` in development and `0.0.0.0` when
`NODE_ENV=production` (so the container port is reachable).

## Testing, linting, typechecking

```bash
bun test              # bun:test; DB-backed tests use @testcontainers/postgresql (needs Docker)
bun run lint          # biome check .
bunx biome check --write .   # lint + format, applying safe fixes
bun run typecheck     # tsc --noEmit
```

## Container image

```bash
docker build --platform linux/arm64 -t atlas-bes .   # arm64 = Fargate Graviton target
docker run --rm -p 8000:8000 --env-file .env \
  -e DATABASE_URL=postgres://postgres:dev@host.docker.internal:5432/atlas \
  atlas-bes
```

Test graceful shutdown (ECS sends SIGTERM on every deploy):

```bash
docker stop <container>   # sends SIGTERM; logs should show drain stages, exit 0 before the timeout
```

You should see "stopping new connections", "closing database pool", and
"shutdown: complete" in order — not a 10-second hang followed by SIGKILL.

## Troubleshooting

- **Port already in use** — something else owns 8000 (or 5432). Find it with
  `lsof -i :8000`, kill it or change `PORT` in `.env`.
- **Database connection refused** — is the container up? `docker compose ps`,
  then `docker compose up -d`. If it's up but unhealthy, check
  `docker compose logs db`. `/ready` returning 503 with an error message tells
  you what the probe saw.
- **Types out of sync with schema** — queries fail to typecheck, or
  `src/db/types.ts` doesn't match reality: run `bun run db:sync`. Do not cast
  around type errors; they mean the schema moved.

## How this repo is organized

```
src/
  modules/        # domain modules (gauges, measurements, sites, auth, assets…)
    <name>/
      routes.ts   # Fastify routes + TypeBox schemas (autoloaded)
      service.ts  # business logic — no Fastify types in signatures
      queries.ts  # Kysely queries, one exported function each
      schemas.ts  # shared TypeBox definitions
  db/             # pool factory + generated types (src/db/types.ts)
  plugins/        # shared Fastify plugins
  config.ts       # @fastify/env config schema + validation
  server.ts       # buildApp(), health/readiness, graceful shutdown
db/local/         # dev-only schema scratchpad — NOT the source of truth
```

Modules stay independently portable (the service is expected to move to Go
eventually).

## TODO: obtaining the real schema from the migrations repo

**Unresolved.** The database schema lives in an external migrations repository,
and BES needs it in two places:

1. **`db:codegen`** — a local database at the *current real schema* to generate
   `src/db/types.ts` from (the `db/local/` scratchpad only covers
   work-in-progress design, not the real schema).
2. **CI / integration tests** — testcontainers needs the same DDL to stand up a
   faithful database.

Candidate mechanisms (none chosen yet): a git submodule pointing at the
migrations repo, a published `schema.sql` artifact pulled at a pinned version,
or a CI checkout step that applies the migrations before tests. Until this is
decided, codegen against the real schema is a manual affair.
