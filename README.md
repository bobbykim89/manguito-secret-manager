# Manguito Secret Manager

A self-hosted secret manager: encrypted key/value storage with a web UI and a
programmatic API for CI pipelines.

> **Status:** feature complete and tested end to end. Buckets, secrets with
> envelope encryption, scoped API keys, a web UI covering all three, and an
> audit trail with no viewer of its own yet.
>
> **Deployed nowhere.** The Fly configuration is written and has never been
> applied, pending a domain. Vercel is not configured at all yet.
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

Every read of a value, write and deletion is recorded against the credential
that performed it. A read that cannot be audited is refused rather than served
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

## Encryption

Two tiers, so that a stolen database yields nothing and rotating the master key
does not require rewriting every secret.

```
KEK          in the environment, versioned, never in the database
 │ wraps
 ▼
per-bucket DEK    stored wrapped, on the bucket row
 │ encrypts
 ▼
each secret value    AES-256-GCM, fresh 96-bit nonce per write
```

Each value is sealed with additional authenticated data binding it to its
`(bucket_id, key_name)` pair, so a ciphertext moved to another row fails to
decrypt rather than silently returning another secret's value.

The AAD is length-prefixed rather than concatenated, because concatenation is
not injective: bucket `ab` with key `c` and bucket `a` with key `bc` would
otherwise produce identical AAD, and a ciphertext could be relocated between
them undetected. That is the exact attack the binding exists to prevent, so
the encoding has to rule it out rather than make it unlikely.

Deleting a bucket destroys its wrapped DEK, which makes every value it held
permanently unreadable. Deletion is therefore hard rather than soft, and a
non-empty bucket is refused: a soft delete that retained the wrapped DEK would
give up the property.

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
```

`.env` ships with `SECRETS_KEKS` empty; generate a KEK and set it along with
`SECRETS_KEK_VERSION` before continuing (see the environment variable table
under Authentication, below), then run:

```bash
make dev
```

Then open <http://localhost:5173>.

| Target | Does |
|---|---|
| `make help` | List the targets |
| `make install` | Install backend and frontend dependencies |
| `make dev` | Postgres, API with reload, Vite dev server. Runs `migrate` first, so a missing or incomplete root `.env` exits with a `ConfigurationError` |
| `make test` | pytest and vitest |
| `make lint` | ruff, mypy, eslint, tsc |
| `make types` | Regenerate `web/src/api/generated.ts` |
| `make migrate` | Apply migrations locally |
| `make db-up` | Start local Postgres |
| `make db-down` | Stop local Postgres |

## Authentication

Google OAuth with server-side sessions. The backend performs the code
exchange, so the frontend never sees a Google token, and the session cookie is
opaque: it names a row rather than carrying claims.

The redirect URI is configuration rather than something derived from the
request `Host` header, because deriving it is how open redirect bugs start.

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
first login. Cross-user isolation is therefore load bearing rather than
theoretical, and is tested as such.

Setting up a Google OAuth client is free.
[docs/google-oauth-setup.md](docs/google-oauth-setup.md) walks through it,
including the consent screen setting that silently rejects every account but
your own, and what each callback error code means.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string, `postgresql+psycopg://` |
| `SECRETS_KEKS` | yes | Key-encryption keys, as `version:base64` pairs separated by commas. Keeping a retired key listed is what lets rows that still name it be unwrapped |
| `SECRETS_KEK_VERSION` | yes | Which KEK version new buckets are wrapped under |
| `GOOGLE_CLIENT_ID` | yes | OAuth client id from the Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret. Never sent to the frontend |
| `GOOGLE_REDIRECT_URI` | yes | Must exactly match one of the client's authorized redirect URIs |
| `APP_URL` | yes | Where the frontend lives; the callback redirects here after login |
| `CORS_ORIGINS` | no | Comma separated. A wildcard is refused rather than reflected, because credentialed requests would make it every origin |
| `ENVIRONMENT` | no | `local` by default |
| `SESSION_COOKIE_DOMAIN` | no | `.<domain>` in production, so the session cookie is shared between `app.<domain>` and `api.<domain>`. Empty locally |

Generate a KEK with:

```bash
python -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"
```

and set it as `SECRETS_KEKS=1:<that value>` with `SECRETS_KEK_VERSION=1`.
Missing either one fails at import, during the release command, rather than as
a 500 on the first secret written.

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

The backend runs against a real Postgres via testcontainers rather than
SQLite, because this project depends on behaviour the two do not share.
Crypto is tested with Hypothesis: roundtrip, tamper detection, nonce
uniqueness, and that a ciphertext moved between rows fails to decrypt.

The frontend mocks at the fetch boundary with MSW rather than mocking hooks,
so the tests exercise the real router and the real query client.

Some tests exist to pin a security property rather than a feature, and are
written so that removing the thing they guard makes them fail:

- Rendering a list of secrets sends zero requests for any value.
- No request the frontend makes contains `reveal`, asserted across every
  request a test made rather than one URL.
- A hidden secret's mask is identical whatever the value's length, so the
  mask cannot leak it.
- `localStorage` and `sessionStorage` are empty after a secret is revealed and
  after an API key token is shown.

```bash
make test
```

Currently 346 backend tests and 242 frontend tests.

## Threat model

**A stolen database.** A backup, a SQL injection dump, a leaked snapshot, or an
insider with read access to Postgres. All of them obtain ciphertext and wrapped
data keys and nothing usable, because the key that unwraps them is in the
environment rather than the database. This is the case the whole design exists
for.

**Write access to the database.** Still cannot read a value, and cannot
relocate a ciphertext: moving a wrapped DEK to another bucket, editing a
bucket's id, forging a key version, or truncating a wrapped value all fail
closed rather than decrypting to something.

It can deny service, and it can reassign a bucket's ownership, because nothing
binds a bucket to its owner. That is deliberate: the same attacker can insert a
session row for any user and read through the front door, so binding the owner
into the encryption would buy nothing against them while making ownership
permanently immutable, since changing it would make every secret in the bucket
undecryptable. The binding prevents ciphertext relocation, not database
tampering in general.

**A leaked API key**, which is the credential most likely to leak, because it
lives in CI. It reaches the secret endpoints only, and only inside the buckets
it was scoped to. It cannot delete a bucket and it cannot issue another key:
those endpoints resolve a session and never read the `Authorization` header at
all, so a key presented to them is not refused by a check that a future
endpoint might forget, it is never read.

With the write scope it can permanently destroy the secrets in its scope, since
there is no versioning to fall back on. Withhold that scope from a pipeline
that only reads. Every read of a value it performs is recorded against it in
the audit log.

**A compromised application server.** RCE on the API process means the KEK, and
therefore everything. This is equally true of AWS Secrets Manager, Doppler and
Infisical, and no amount of encryption at rest changes it.

### Why not zero-knowledge

Client-side encryption under a passphrase-derived key would take the operator
out of the trust boundary, and is structurally incompatible with unattended
programmatic access. A CI pipeline calling
`GET /v1/buckets/prod/secrets/DATABASE_URL` presents an API key and nothing
else; there is no passphrase in that request for the server to derive a key
from. Doppler, Infisical and AWS Secrets Manager all made the same trade for
the same reason. 1Password is zero-knowledge and correspondingly has no
equivalent endpoint.
