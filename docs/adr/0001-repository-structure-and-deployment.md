# ADR 001: Repository structure and deployment

Status: Accepted (amended 2026-08-03)
Date: 2026-08-03
Project codename: `secretbox` (placeholder, rename before init)

## Context

Personal portfolio project: a self-hosted secret manager with a web UI and a programmatic API. Solo developer. Two goals beyond the product itself:

1. Produce a non-trivial React project (existing React work on the resume is React 16 MERN, which reads as dated).
2. Produce credible evidence of production operations work: containerization, CI, deployment, testing ownership.

Cost is a real constraint. Prior AWS learning projects have produced surprise bills in the ~$30/month range when left running.

## Decision

### Single repository, flat structure, no monorepo tooling

```
secretbox/
├── web/                       # Vite + React 19 + TypeScript
│   ├── src/
│   │   └── api/generated.ts   # generated from OpenAPI, committed
│   ├── package.json
│   └── vite.config.ts
├── api/                       # FastAPI + SQLAlchemy
│   ├── app/
│   │   ├── crypto/            # KeyProvider, envelope encrypt/decrypt
│   │   ├── models/
│   │   ├── routers/
│   │   └── main.py
│   ├── tests/
│   ├── pyproject.toml
│   ├── Dockerfile
│   └── fly.toml
├── docker-compose.yml         # api + postgres for local dev
├── Makefile
├── .github/workflows/ci.yml
└── README.md
```

### Deployment targets

| Component | Platform | Approx. monthly cost |
|---|---|---|
| Frontend | Vercel Hobby, root directory `web/` | $0 |
| Backend | Fly.io container, single machine with auto-stop | $1 to $3 |
| Database | Neon Postgres free tier, pooled endpoint | $0 |
| Domain | Registrar of choice | ~$10/year |

Both services live under one apex domain: `app.<domain>` for the frontend, `api.<domain>` for the backend. This allows the session cookie to be scoped to `.<domain>` and avoids cross-site cookie restrictions entirely.

Fly configuration must include auto-stop so idle cost approaches zero:

```toml
[http_service]
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
```

## Rationale

### Why one repo

- API contract changes touch both halves in a single commit. With one contributor, two-repo coordination is pure overhead.
- Cross-language type generation (FastAPI OpenAPI schema to TypeScript types) is meaningfully easier in one tree.
- A reviewer opening one GitHub link sees the whole system. Two repos halves the apparent scope of the work.
- The usual arguments for splitting (independent deploy cadence, separate access control) do not apply to a solo portfolio project.

### Why no Turborepo

Turborepo orchestrates a JavaScript dependency graph. Half this repo is Python and would sit outside it. A Makefile plus CI path filters achieves the same result without a config file that has to explain its own exclusions.

### Why Fly over AWS

Prior AWS bills in the ~$30/month range are almost certainly a NAT Gateway ($0.045/hour = $32.40/month), which CDK's default `new Vpc()` construct provisions automatically. Lambda itself is in the always-free tier and effectively costs nothing.

The relevant factor is not the sticker price but the failure mode. Forgetting to tear down an AWS stack has an unbounded downside. Forgetting to tear down a Fly machine costs about $2. Optimize for the mistake that actually gets made.

Fly also keeps the Dockerfile in play, which serves the containerization goal directly.

### Why not Vercel Functions for the backend

Genuinely $0 and would eliminate the cross-origin problem, but rejected because:

- `cryptography` ships compiled binaries; native dependency builds on a serverless Python runtime are a time sink with no learning payoff.
- No Dockerfile means losing the containerization evidence, which is a stated goal.
- Ephemeral processes re-import `cryptography`, rebuild the SQLAlchemy engine, and re-decode the KEK on every cold start. A long-lived process holds the KEK in memory once, which is both faster and a cleaner architectural story.

## Tooling

### Makefile

Root-level Makefile is the seam that makes two directories feel like one project:

```make
dev:        ## postgres + api hot reload + vite dev server
types:      ## regenerate TS types from live OpenAPI schema
test:       ## pytest + vitest
lint:       ## ruff + eslint
```

### CI

GitHub Actions, three jobs:

1. `api` — triggered on `paths: ['api/**']`. Runs ruff, mypy, pytest against a Postgres service container.
2. `web` — triggered on `paths: ['web/**']`. Runs eslint, tsc, vitest.
3. `types-drift` — regenerates `web/src/api/generated.ts` from the FastAPI schema and fails if `git diff` is non-empty. Prevents committed types from silently diverging from Pydantic models.

Branch protection requires all three green before merge.

## Rejected alternatives

| Option | Reason rejected |
|---|---|
| Separate frontend and backend repos | Coordination overhead with no benefit at solo scale; halves apparent project scope |
| Turborepo monorepo | Only covers the JS half; config complexity without payoff |
| AWS Lambda + CDK + API Gateway | Unbounded cost failure mode given documented history of leaving stacks running |
| Vercel Functions for backend | Loses Dockerfile; Python native deps are a known time sink |
| Render / Railway | Viable, comparable cost. Fly chosen for Dockerfile-first workflow. Revisit if Fly proves annoying |

## Open questions

- Domain name not yet chosen.
- Whether to add a `docs/` directory with the threat model, or keep it in README. Leaning README for discoverability.

## Follow-up work

- Confirm no NAT Gateway is running in the personal AWS account from a prior project.
- Set a billing alert on any cloud account used.

Commits will be made using commitizen format with description of changes made.

---

## Amendments — 2026-08-03 (SP1 brainstorming)

### A1. Path filters must not sit on job triggers

The CI section above specifies `paths:` filters on the `api` and `web` jobs
together with branch protection requiring all three checks. These interact
badly on GitHub: a job skipped by a `paths:` filter reports **no status at
all**, so a required check never arrives and the pull request cannot merge. A
frontend-only change would block indefinitely on an `api` check that
intentionally did not run.

**Amended:** all jobs trigger unconditionally and filter *within* the job using
`dorny/paths-filter`, so every job always reports a status and irrelevant work
exits early. One workflow, no no-op shim jobs.

### A2. Test database is testcontainers, not a service container

The CI section says the `api` job runs against a Postgres *service container*;
ADR 002 specifies *testcontainers*. These are different mechanisms and the
repository can only have one.

**Amended:** testcontainers, per ADR 002. Local and CI behavior become
identical, which is worth more than the roughly 20 seconds of Docker startup.

### A3. The type pipeline runs offline

The `types` Makefile target above says "from live OpenAPI schema". Fetching
`/openapi.json` from a running server in CI requires starting a process, binding
a port, and polling for readiness — three failure modes for no benefit.

**Amended:** `api/scripts/dump_openapi.py` imports the FastAPI app object and
writes `app.openapi()` to stdout. The Makefile target and the `types-drift`
check invoke the same script, so they cannot diverge.

### A4. A fourth CI job

A `deploy` job runs `flyctl deploy` on `main`, gated on `api`, `web`, and
`types-drift` passing. Branch protection still requires exactly those three.

### A5. The Fly cold-start rationale overclaims

"A long-lived process holds the KEK in memory once" is used above to argue
against serverless, but `min_machines_running = 0` means the Fly machine does
stop when idle and cold-start on the next request. The conclusion still holds —
a Fly cold start is a single process boot rather than a per-request import — but
the stated contrast is weaker than written. Cold-start latency should be
measured during SP1 and recorded.

### A6. Open question resolved: `docs/`

A `docs/` directory now exists, holding ADRs and specs. The **threat model
stays in the README**, per the original leaning and per ADR 002's instruction
that it appear there verbatim.

### A7. Compose runs Postgres only

The layout above comments `docker-compose.yml` as "api + postgres for local
dev". Running the API in a container during development costs an image rebuild
or a bind mount on every edit, and buys nothing: the Dockerfile is already
exercised by CI and by every Fly deploy.

**Amended:** Compose defines Postgres only. `make dev` starts Postgres in
Compose and runs the API on the host under `uv run uvicorn --reload`.

### A8. Codename

`secretbox` collides with NaCl's `crypto_secretbox`. For a project whose
credibility rests on its cryptography, a name a reader may mistake for a
specific primitive the project does not use is worth avoiding. Rename before
init, as already planned.

### A9. The threat model is in the README, as amended rather than verbatim

A6 put the threat model in the README "per ADR 002's instruction that it appear
there verbatim". ADR 002 A19 has since narrowed the claim that instruction
points at, after SP3's implementation review found it true but broader than the
implementation supports.

**Amended:** the location stands, unchanged. The word verbatim does not. The
README carries the threat model as amended by ADR 002 A19, which separates read
access to the database from write access and states plainly that the AAD
binding prevents ciphertext relocation rather than database tampering in
general.

Nothing here conflicts with A6. It was written before A19 existed.
