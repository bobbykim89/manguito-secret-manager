# Manguito Secret Manager

A self-hosted secret manager: encrypted key/value storage with a web UI and a
programmatic API for CI pipelines.

> **Status:** SP2, authentication. Google OAuth and server side sessions are
> implemented and tested end to end in the backend. There is no login screen
> yet, so the flow cannot be driven from a browser. Nothing is deployed: the
> deployment configuration is written but has never been applied. No secrets
> are stored: there is no bucket or secret schema, and no encryption, yet. See
> `docs/superpowers/specs/` for the sub-project plan and `docs/adr/` for the
> decision record.

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
schema to stdout: no server, no port, no readiness polling. CI runs the same
script and fails the build if the committed file differs.

The effect: **changing a response shape in Python breaks `tsc` in the
frontend.**

## Local development

Requires Docker, [uv](https://docs.astral.sh/uv/), Node 22+, and
[pnpm](https://pnpm.io/) 10+ (`corepack enable pnpm` if you do not have it).

```bash
cp .env.example .env
cp web/.env.example web/.env.local
make install
make dev
```

Then open <http://localhost:5173>.

| Target | Does |
|---|---|
| `make help` | List the targets |
| `make install` | Install backend and frontend dependencies |
| `make dev` | Postgres, API with reload, Vite dev server. Runs `migrate` first, so a root `.env` has to exist or it exits with a pydantic `ValidationError` |
| `make test` | pytest and vitest |
| `make lint` | ruff, mypy, eslint, tsc |
| `make types` | Regenerate `web/src/api/generated.ts` |
| `make migrate` | Apply migrations locally |
| `make db-up` | Start local Postgres |
| `make db-down` | Stop local Postgres |

## Authentication

Google OAuth with server side sessions. The backend performs the code
exchange; the frontend never sees a Google token.

To run login locally you need a Google OAuth client:

1. In the Google Cloud console, create an OAuth 2.0 Client ID of type **Web
   application**.
2. Add two authorized redirect URIs to the same client:
   - `http://localhost:8000/v1/auth/google/callback`
   - `https://api.<domain>/v1/auth/google/callback`

   Google permits plain `http` for `localhost` specifically, so no tunnel or
   self signed certificate is needed.
3. Copy the client id and secret into `.env`.

The redirect URI is configuration rather than something derived from the
request `Host` header. Deriving it is how open redirect bugs start.

| Endpoint | Purpose |
|---|---|
| `GET /v1/auth/google/start` | Begin login |
| `GET /v1/auth/google/callback` | Complete login |
| `GET /v1/auth/me` | Current user, or 401 |
| `POST /v1/auth/logout` | Destroy the session |

`start` and `callback` redirect rather than returning the response envelope,
because a browser navigates to them directly. Everything else returns the
envelope.

Registration is open: any Google account may sign in and gets an account on
first login. Cross user isolation is therefore load bearing, not theoretical.

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
