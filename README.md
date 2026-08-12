# Manguito Secret Manager

A self-hosted secret manager: encrypted key/value storage with a web UI and a
programmatic API for CI pipelines.

> **Status:** feature complete and tested end to end. Buckets, secrets with
> envelope encryption, scoped API keys, an audit trail, and a web UI covering
> all of it.
>
> **Deployed nowhere.** The Fly and Vercel configuration is written and has
> never been applied, pending a domain.
>
> **Deliberately not built yet:** per-key rate limiting, security headers, and
> a KEK rotation CLI. Rate limiting is deferred in ADR 002 A7, which rules out
> an in-process counter because Fly stops the machine and resets it. Each
> remaining piece gets a spec before it gets code, in
> [`docs/superpowers/specs/`](docs/superpowers/specs/).

## What it does

Secrets live in **buckets**. A bucket holds key/value pairs whose values are
encrypted at rest: a per-bucket data key encrypts each value, and that data key
is itself wrapped by a key-encryption key held outside the database.

Two ways in. A **web UI** to create buckets, add and replace secrets, reveal
one value at a time, and issue or revoke API keys. A **scoped API key** for
everything unattended: a key names the buckets it may reach and whether it may
write or bulk-read, and only its SHA-256 hash is stored, so a leaked database
does not yield a working credential.

Every read, write and deletion is recorded against the credential that
performed it. A read that cannot be audited is refused rather than served
silently, because a secret manager that quietly serves unlogged reads has lost
the point of the log.

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

## A worked example

Create a bucket, add a secret to it, and issue an API key in the web UI. The
token is shown once, at creation, and is never recoverable afterwards: only its
SHA-256 hash is stored.

Then, from a pipeline:

```bash
export API=http://localhost:8000
export KEY=msm_a3f9c2e1_XmQ7...   # shown once, when the key was created

curl -s -H "Authorization: Bearer $KEY" \
  "$API/v1/buckets/prod/secrets/DATABASE_URL"
```

```json
{"ok":true,"data":{"key_name":"DATABASE_URL","created_at":"2026-08-12T09:14:02Z","updated_at":"2026-08-12T09:14:02Z","value":"postgres://user:pw@host/db"}}
```

Credentials travel in `Authorization: Bearer`, never in a query string, because
query strings reach access logs, CDN logs, browser history and `Referer`
headers.

Pulling a whole bucket in one request is a separate capability, and a key only
has it if it was issued with the bulk reveal scope:

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "$API/v1/buckets/prod/secrets?reveal=true"
```

```json
{"ok":false,"error":{"code":"REVEAL_NOT_PERMITTED","message":"Bulk reveal requires an API key with the reveal scope."}}
```

A browser session is refused there too, whatever the signed-in user owns. Bulk
reveal is a property of the credential rather than of the endpoint, so the web
UI cannot reach it at all.

Every response follows the same envelope: `{"ok": true, "data": ...}` or
`{"ok": false, "error": {"code": ..., "message": ...}}`. The frontend narrows
that union in exactly one place.

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

Running login locally needs a Google OAuth client, which is free to create.
[docs/google-oauth-setup.md](docs/google-oauth-setup.md) walks through it end to
end, including the consent screen setting that silently rejects every account
but your own, and what each callback error code means when something fails.

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

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | yes | OAuth client id from the Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret. Never sent to the frontend |
| `GOOGLE_REDIRECT_URI` | yes | Must exactly match one of the client's authorized redirect URIs |
| `APP_URL` | yes | Where the frontend lives; the callback redirects here after login |
| `SESSION_COOKIE_DOMAIN` | no | `.<domain>` in production, so the session cookie is shared between `app.<domain>` and `api.<domain>`. Empty locally |

`Settings` is a Pydantic model built at import time, so a deployment missing
any of the required variables fails during the release command, before
migrations run, rather than surfacing as a 500 on first login.

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
