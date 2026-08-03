# SP1: Skeleton and Pipeline — Design

Date: 2026-08-03
Status: Approved, ready for planning
Depends on: ADR 001, ADR 002, ADR 003 (as amended 2026-08-03)

## Purpose

Stand up the complete deployment and integration path for the project with no
domain logic in it. SP1 is finished when a request travels from a browser on
Vercel, through a generated TypeScript client, to a FastAPI process on Fly, to
Neon Postgres, and back — with CI gating every step.

The value is sequencing, not volume. ADR 001 makes three integration bets: Fly
auto-stop behaving, Neon's pooled endpoint cooperating with SQLAlchemy, and a
session cookie working across `app.<domain>` and `api.<domain>`. Each is cheap
to test now and expensive to discover underneath a finished application. SP1
also front-loads the containerization and CI evidence that ADR 001 names as a
goal of the project.

## Project decomposition

SP1 is the first of four sub-projects. Each has its own spec, plan, and
implementation cycle, and each ends deployable.

| | Sub-project | Contents |
|---|---|---|
| **SP1** | Skeleton and pipeline | Repo layout, Docker, Fly, Vercel, Neon, CI, type generation, health endpoint |
| SP2 | Authentication | Google OAuth, sessions, `users` table, API key issuance and verification |
| SP3 | Buckets, crypto, secrets | `KeyProvider`, DEK wrapping, buckets and secrets schema, CRUD API, web UI |
| SP4 | Hardening | Audit log, per-key rate limiting, security headers, threat model in README |

Ordering is dependency-forced: SP3's authorization checks need SP2's identity
model, and SP4 observes everything below it.

## Scope

### In scope

- Repository layout exactly as ADR 001 specifies.
- `api/`: FastAPI application, `pydantic-settings` configuration, SQLAlchemy 2.x
  engine with `poolclass=NullPool`, Alembic initialized with an empty baseline
  revision, and a single endpoint `GET /v1/health`.
- `api/Dockerfile`: multi-stage build.
- `api/fly.toml`: auto-stop configuration and `release_command`.
- `docker-compose.yml`: **Postgres only**. ADR 001 describes it as "api +
  postgres"; running the API in a container locally costs a rebuild or a bind
  mount on every edit for no benefit, since the Dockerfile is already exercised
  by CI and by Fly. `make dev` runs Postgres in Compose and the API on the host
  under `uv run uvicorn --reload`. This amends ADR 001.
- Root `Makefile`: `dev`, `types`, `test`, `lint`.
- `web/`: Vite + React 19 + TypeScript strict + Tailwind + React Router v7 +
  TanStack Query, with a single route rendering health status through the
  generated client.
- `.github/workflows/ci.yml`: three reported checks plus a deploy job.
- Type generation pipeline and drift check.
- Both halves deployed and reachable at their production URLs.
- ADRs committed under `docs/adr/`.

### Explicitly out of scope

- **All domain tables.** The baseline Alembic revision is deliberately empty.
  SP2 owns the first real schema, so SP1 leaves behind no throwaway table.
- **All authentication.** `GET /v1/health` is public.
- **All cryptography.** No `KeyProvider`, no `SECRETS_KEK`.
- **Zustand, Zod, React Hook Form.** SP1 has no client state and no forms.
  Installing them here yields unused dependencies that no test exercises and
  that CI cannot verify are correctly wired. They arrive with their first real
  consumer in SP2 and SP3.
- Styling beyond Tailwind being installed and demonstrably applying.

## Decisions made in this spec

These are not stated in ADRs 001–003 and are recorded here as amendments.

**Sync SQLAlchemy with psycopg3.** Routes are `def`, and FastAPI runs them in a
threadpool. The workload is a small number of indexed queries plus AES
operations; async buys throughput this project has no traffic to need. Because
`NullPool` opens a fresh connection per request regardless, connection setup —
not concurrency — dominates latency either way. Sync also keeps Alembic's
`env.py` stock, keeps testcontainers fixtures ordinary, and avoids
greenlet-boundary errors.

**uv for Python dependency management.** Lockfile-based, fast in CI, and works
with the `pyproject.toml` ADR 001 already assumes.

**testcontainers over GitHub Actions service containers.** ADR 002 names
testcontainers; ADR 001 says service container. Testcontainers wins because
local and CI behavior are then identical, which is worth more than the roughly
20 seconds of Docker startup. This amends ADR 001.

**Filtering happens inside jobs, not in `paths:` triggers.** See CI below.

**SP1 installs only the frontend dependencies its walking skeleton exercises.**

## Repository layout after SP1

```
.
├── api/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI app, CORS, router registration
│   │   ├── config.py            # pydantic-settings Settings
│   │   ├── db.py                # engine (NullPool), session dependency
│   │   ├── envelope.py          # {ok, data} / {ok, error} response models
│   │   └── routers/
│   │       └── health.py
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   │       └── <rev>_baseline.py    # empty upgrade/downgrade
│   ├── scripts/
│   │   └── dump_openapi.py      # imports app, writes app.openapi() to stdout
│   ├── tests/
│   │   ├── conftest.py          # testcontainers Postgres fixture
│   │   └── test_health.py
│   ├── alembic.ini
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── Dockerfile
│   └── fly.toml
├── web/
│   ├── src/
│   │   ├── api/
│   │   │   ├── generated.ts     # generated, committed, never hand-edited
│   │   │   └── client.ts        # typed fetch wrapper, envelope unwrapping
│   │   ├── features/health/
│   │   │   ├── HealthPage.tsx
│   │   │   ├── useHealth.ts
│   │   │   └── HealthPage.test.tsx
│   │   ├── routes/
│   │   │   └── router.tsx
│   │   ├── test/
│   │   │   ├── setup.ts
│   │   │   └── msw.ts
│   │   ├── main.tsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.ts
├── docs/
│   ├── adr/
│   │   ├── 0001-repository-structure-and-deployment.md
│   │   ├── 0002-backend-architecture-cryptography-and-auth.md
│   │   └── 0003-frontend-architecture.md
│   └── superpowers/specs/
│       └── 2026-08-03-sp1-skeleton-and-pipeline-design.md
├── .github/workflows/ci.yml
├── docker-compose.yml
├── Makefile
├── .env.example
├── .gitignore
└── README.md
```

Directories that ADR 003 specifies but that hold nothing in SP1 —
`web/src/stores/`, `web/src/components/`, `web/src/lib/` — are not created until
a file lives in them.

## Backend

### Configuration

`app/config.py` defines a `pydantic-settings` `Settings` model read from the
environment, with a `.env` fallback for local development:

| Variable | Purpose | Required in SP1 |
|---|---|---|
| `DATABASE_URL` | Neon pooled connection string | Yes |
| `CORS_ORIGINS` | Comma-separated allowed origins | Yes |
| `ENVIRONMENT` | `local` / `production` | Yes |

`SECRETS_KEK` is deliberately absent. Introducing it before any code reads it
means an unvalidated secret sitting in Fly that nobody would notice was wrong.
SP3 adds it together with a startup check that fails loudly if it is missing or
does not decode to 32 bytes.

### Database

`app/db.py` builds the engine with `poolclass=NullPool`, as ADR 002 requires —
Neon's pooled endpoint already runs PgBouncer, and pooling on top of a pooler
causes connection accounting problems. A `get_db` dependency yields a session
per request and closes it.

### Response envelope

ADR 002 fixes the response shape:

```json
{ "ok": true,  "data": ... }
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

`app/envelope.py` defines generic Pydantic models for both arms and an exception
handler that renders application errors into the failure arm. Because these
models drive the OpenAPI schema, they are what `openapi-typescript` sees, so the
envelope must be modelled properly rather than constructed ad hoc in routes.

### Health endpoint

`GET /v1/health` executes `SELECT 1` and returns:

```json
{ "ok": true, "data": { "db": "ok" } }
```

If the query raises, it returns the failure arm with code `DB_UNAVAILABLE` and
HTTP 503. This proves connectivity without requiring any table to exist.

### Migrations

Alembic is initialized and its first revision is an empty baseline — `upgrade()`
and `downgrade()` both `pass`. Its purpose is to prove that migrations are
wired, run against Neon, and execute in Fly's release step. SP2 stacks the first
real schema on top of it.

### Container and Fly

Multi-stage `Dockerfile`: a build stage that installs dependencies with uv from
`uv.lock`, and a slim runtime stage that copies the resulting environment and
application, runs as a non-root user, and starts uvicorn.

`fly.toml` carries the auto-stop block from ADR 001 verbatim:

```toml
[http_service]
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
```

plus `release_command = "alembic upgrade head"`, so migrations apply against
Neon before a new machine takes traffic.

## Frontend

### Dependencies installed in SP1

Vite, React 19, TypeScript (strict), Tailwind, React Router v7 (declarative SPA
mode), TanStack Query, Vitest, React Testing Library, MSW, `openapi-typescript`.

### `api/client.ts` — the one interface worth designing now

Every feature in SP2, SP3, and SP4 is built on this module, so changing it later
touches every call site. It:

- Reads the base URL from `VITE_API_URL`.
- Sends `credentials: "include"` on every request, so the `.<domain>` session
  cookie is attached once SP2 introduces it.
- **Unwraps the envelope at this boundary.** The generated types describe both
  arms of `{ok, data} | {ok, error}`. The client narrows that union exactly
  once: it returns `data` typed as `T` on success, and throws a typed `ApiError`
  carrying `code` and `message` on failure.

The consequence is that TanStack Query hooks and components deal in domain types
and thrown errors, never in envelopes. Allowing `ok` checks to spread into
components is the most likely way this codebase degrades, and this boundary is
what prevents it.

### Health slice

One route renders `HealthPage`, which calls `useHealth` — a `useQuery` wrapping
`client.get("/v1/health")` — and renders loading, success, and error states.
Small, but it exercises the entire path: Pydantic model → OpenAPI schema →
generated TypeScript → typed client → Query hook → rendered assertion.

### Security posture carried forward

SP1 handles no secrets, but two rules from ADR 003 are established here so later
work inherits them: no secret values in `localStorage`, `sessionStorage`, or URL
state; and no secret values in error boundaries or client-side error payloads.
ADR 003's amendment adds a third that SP3 must honor — the revealed-secrets
Zustand store never receives `devtools` or `persist` middleware.

## Type generation pipeline

`api/scripts/dump_openapi.py` imports the FastAPI app object and writes
`app.openapi()` to stdout as JSON. It starts no server, binds no port, and needs
no readiness polling.

```
make types  →  uv run python scripts/dump_openapi.py
            |  npx openapi-typescript - -o web/src/api/generated.ts
```

The `types-drift` CI check runs the identical command and then
`git diff --exit-code -- web/src/api/generated.ts`. Because the Makefile target
and the CI check invoke the same script, they cannot diverge — which is the
failure mode that makes generated-code checks tedious in practice.

Effect: changing a response shape in Python breaks `tsc` in the frontend. ADR
003 correctly identifies this as one of the more distinctive properties of the
project, and it is worth describing in the README.

## CI

GitHub Actions, one workflow, four jobs.

| Job | Runs |
|---|---|
| `api` | ruff, mypy, pytest against testcontainers Postgres |
| `web` | eslint, tsc, vitest |
| `types-drift` | regenerate `generated.ts`, fail on non-empty diff |
| `deploy` | `flyctl deploy`, only on `main`, only if the three above pass |

### Path filtering must happen inside jobs

ADR 001 specifies `paths:` filters on the `api` and `web` jobs together with
branch protection requiring all three checks. These interact badly on GitHub: a
job skipped by a `paths:` filter reports no status at all, so a required check
never arrives and the pull request cannot merge. A frontend-only change would
block forever on an `api` check that intentionally did not run.

SP1 therefore triggers all jobs unconditionally and filters *within* each job
using `dorny/paths-filter`, so every job always reports a status and irrelevant
work exits early. This amends ADR 001.

Branch protection requires `api`, `web`, and `types-drift`.

## Deployment

**Backend.** The `deploy` job runs `flyctl deploy` on `main` after the three
checks pass, authenticated with a `FLY_API_TOKEN` repository secret.
`DATABASE_URL` and `CORS_ORIGINS` are set through `fly secrets set`.

**Frontend.** Vercel's own GitHub integration, project root directory `web/`,
framework preset Vite, `VITE_API_URL` pointing at `https://api.<domain>`. No
Actions job.

**CORS.** `api.<domain>` allows exactly `https://app.<domain>` with
`allow_credentials=True` and no wildcard. The shared apex from ADR 001 solves
the *cookie* problem, not the *CORS* problem — requests from `app.<domain>` to
`api.<domain>` remain cross-origin and still preflight.

**Domain.** Not yet chosen. The spec uses `<domain>` throughout. Only three
places actually depend on it: the CORS allowlist, the session cookie's domain
attribute in SP2, and `VITE_API_URL`. All three are configuration, so the choice
does not block implementation, but it does block the final acceptance check.

## Testing

**Backend.** `pytest` with a session-scoped testcontainers Postgres fixture, per
ADR 002 — not SQLite, because database behavior differences matter in this
project. SP1's tests: health returns the success envelope against a live
database; health returns the failure envelope with 503 when the database is
unreachable; the baseline migration applies and reverses cleanly.

**Frontend.** Vitest with React Testing Library, mocking at the fetch layer with
MSW rather than mocking hooks, per ADR 003. SP1's tests: the health page renders
its loading state, its success state, and its error state on a 503.

The substantial test suites — the Hypothesis crypto properties and the
authorization matrix in ADR 002 — belong to SP3. SP1's job is to prove the
harness runs in CI, not to fill it.

## Acceptance criteria

1. `https://api.<domain>/v1/health` returns `{"ok": true, "data": {"db": "ok"}}`
   from Fly, against Neon.
2. `https://app.<domain>` renders that response, fetched through
   `generated.ts`.
3. A pull request turns `api`, `web`, and `types-drift` green.
4. Editing a Pydantic response model without running `make types` makes
   `types-drift` fail.
5. A frontend-only pull request still reports all three checks and is mergeable.
6. `make dev` brings up Postgres, the API with reload, and Vite from a clean
   checkout, with no step not captured in the Makefile.
7. `make test` runs pytest and vitest; `make lint` runs ruff and eslint.
8. `docker build` succeeds and the container runs as a non-root user.
9. The Fly machine stops when idle and cold-starts on request.
10. **Direct navigation to a nested URL on the deployed frontend loads the app
    rather than returning 404.**
11. The README describes the architecture, local setup, and the cross-language
    type pipeline.

## Risks

**Vercel SPA deep-link handling (criterion 10).** React Router in declarative
mode needs a catch-all rewrite to `index.html` or direct navigation to a nested
route 404s. Vercel's Vite preset may supply this automatically; this must be
verified against the deployed site rather than assumed, with a `vercel.json`
rewrite added if it fails. This class of bug appears only in production.

**Neon pooled endpoint plus `NullPool`.** The combination is what ADR 002
prescribes, but the interaction of PgBouncer's transaction pooling with
SQLAlchemy's session lifecycle is worth confirming under the health endpoint
before any real schema depends on it.

**Fly cold start.** ADR 001 justified Fly partly on a long-lived process holding
the KEK in memory, but `min_machines_running = 0` means the machine does stop
and cold-start. The conclusion still holds — a Fly cold start is one process
boot, not a per-request import — but the stated reasoning overclaims, and the
observed cold-start latency should be recorded during SP1 so SP3's crypto
startup work is measured against a real number.

## Deferred

To SP2: Google OAuth, sessions, `users` schema, API key issuance, Zod, React
Hook Form. To SP3: `KeyProvider`, `SECRETS_KEK`, buckets and secrets schema,
envelope encryption, secret reveal UI, Zustand. To SP4: audit log, rate
limiting, security headers, threat model in README. To v2: workspaces with
members and roles, and secret versioning with history — both considered and
deliberately excluded from v1.
