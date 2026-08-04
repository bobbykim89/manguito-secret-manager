# secretbox

A self-hosted secret manager: encrypted key/value storage with a web UI and a
programmatic API for CI pipelines.

> **Status:** SP1, skeleton and pipeline. The application runs end to end
> locally and the deployment configuration is written and verified, but
> nothing is deployed yet. Provisioning the database, backend, frontend, and
> domain is the remaining step. No secrets are stored: there is no schema, no
> authentication, and no cryptography yet. See `docs/superpowers/specs/` for
> the sub-project plan and `docs/adr/` for the decision record.

## Architecture

```
browser → app.<domain>  (Vercel, React 19 + Vite)
                │  fetch, credentials: include
                ▼
          api.<domain>  (Fly.io, FastAPI in a container)
                │  SQLAlchemy, NullPool
                ▼
             Neon Postgres
```

## End-to-end type safety across Python and TypeScript

FastAPI emits an OpenAPI schema from the Pydantic models.
`openapi-typescript` compiles it into `web/src/api/generated.ts`, which is
committed.

```bash
make types
```

`api/scripts/dump_openapi.py` imports the FastAPI app object and writes the
schema to stdout: no server, no port, no readiness polling. CI will run the
same script and fail the build if the committed file differs.

The effect: **changing a response shape in Python breaks `tsc` in the
frontend.**

## Local development

Requires Docker, [uv](https://docs.astral.sh/uv/), and Node 20+.

```bash
cp .env.example .env
cp web/.env.example web/.env.local
make install
make dev
```

Then open <http://localhost:5173>.

| Target | Does |
|---|---|
| `make dev` | Postgres, API with reload, Vite dev server |
| `make test` | pytest and vitest |
| `make lint` | ruff, mypy, eslint, tsc |
| `make types` | Regenerate `web/src/api/generated.ts` |
| `make migrate` | Apply migrations locally |

## Repository layout

```
api/      FastAPI, SQLAlchemy (sync), Alembic, Dockerfile, fly.toml
web/      Vite, React 19, TanStack Query, Tailwind
docs/     ADRs and sub-project specs
```

## Testing

The backend runs against a real Postgres via testcontainers, not SQLite, because
database behaviour differences matter in this project. The frontend mocks at
the fetch layer with MSW rather than mocking hooks.

```bash
make test
```

## Threat model

Will be written up here in SP4, once there is something encrypted to reason
about. The short version, from ADR 002: secret values are encrypted with
AES-256-GCM under a per-bucket data key, itself wrapped by a key-encryption key
held outside the database. This protects against a stolen backup or a database
dump; it does not protect against a fully compromised application server.
