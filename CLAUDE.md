# CLAUDE.md

## What this is

A self-hosted secret manager. Users authenticate with Google, organize secrets into buckets, and read them back either through the web UI or programmatically with an API key. Secrets are encrypted at rest using envelope encryption.

Solo project. Architectural decisions are recorded in `docs/adr/`. Read those before proposing structural changes. Each ADR carries an Amendments section at the end; amendments override the body above them.

- `0001-repository-structure-and-deployment.md`: repo layout, deploy targets, cost constraints
- `0002-backend-architecture-cryptography-and-auth.md`: crypto design, auth model, API surface, test plan
- `0003-frontend-architecture.md`: React stack, security-relevant UI behavior

Sub-project specs live in `docs/superpowers/specs/` and implementation plans in `docs/superpowers/plans/`.

If a task conflicts with an ADR, say so and ask. Do not quietly deviate.

## Layout

```
web/     Vite + React 19 + TypeScript
api/     FastAPI + SQLAlchemy + Postgres
docs/adr/
```

## Commands

```bash
make dev      # postgres + api hot reload + vite
make test     # pytest + vitest
make types    # regenerate web/src/api/generated.ts from the OpenAPI schema
make lint     # ruff + mypy + eslint + tsc
```

Run `make test` and `make lint` before declaring work finished. Do not report a task complete on unverified code.

## Security invariants

These are not style preferences. Violating any of them is a bug regardless of whether tests pass.

1. **Plaintext secrets are never logged.** Not in structured logs, not in stack traces, not in exception payloads, not in `print` during debugging. Logging uses an explicit field allowlist, never a request-body dump.
2. **Credentials never travel in query strings.** `Authorization: Bearer` only. Query params end up in access logs, CDN logs, browser history, and `Referer` headers.
3. **Never reuse an AES-GCM nonce.** Fresh 96 random bits per encryption call, stored alongside the ciphertext.
4. **AAD is always set**, and its encoding must be unambiguous: length-prefix the first component, or use another encoding no two distinct `(bucket_id, key_name)` pairs can collide in. Plain concatenation is not injective, so bucket `ab` with key `c` and bucket `a` with key `bc` produce the same AAD and ciphertext relocates cleanly between the two rows, which is the attack the AAD exists to prevent. See ADR 002 A2.
5. **The KEK never leaves the server** and is never returned by any endpoint, logged, or exposed to the frontend. It is not a user-facing concept.
6. **API keys are stored as SHA-256 hashes only.** Never bcrypt or Argon2 (wrong tool, adds latency on every request), never plaintext.
7. **List endpoints return metadata only.** Secret values require the single-key endpoint. The frontend must not fetch a value until the user clicks reveal.
8. **No secret values in `localStorage`, `sessionStorage`, URL state, or client-side error reporting.**

When touching crypto or auth code, add or update the corresponding test in the same change.

## Backend conventions

- Python 3.12+, type hints everywhere, mypy clean.
- SQLAlchemy 2.x style (`Mapped[...]`, `mapped_column`), not legacy declarative.
- `poolclass=NullPool`. Neon's pooled endpoint already runs PgBouncer; pooling on top of it breaks connection accounting.
- Pydantic v2 for all request and response models. Response models are the source of the OpenAPI schema, so they must be accurate.
- Every schema change gets an Alembic migration in the same commit.
- Tests use a real Postgres via testcontainers, not SQLite.
- Crypto tests use Hypothesis for property-based cases (roundtrip, tamper detection, nonce uniqueness).

## Frontend conventions

- Feature-first directories under `src/features/`, not type-first.
- TanStack Query owns server state. Do not hand-roll fetch plus loading plus error in `useEffect`.
- No client state library. TanStack Query owns server state; `useState` owns everything else. See ADR 003 A11.
- `src/api/generated.ts` is generated. Never hand-edit it. Run `make types` after changing a Pydantic model.
- Zod schemas for form validation, wired through React Hook Form.
- Tests mock at the fetch boundary with MSW. Test behavior, not hooks or class names.
- Tailwind only. No CSS modules, no styled-components.

## Writing style

Applies to code comments, commit messages, docs, and any prose in this repo.

- No em dashes.
- Plain and direct. No marketing tone.
- Comments explain why, not what. Skip comments that restate the line below them.
- Commit messages: conventional commits, imperative mood, scoped (`feat(api): ...`, `fix(web): ...`).

## Working style

- Prefer the smallest change that solves the problem. Do not refactor adjacent code opportunistically.
- When a task is ambiguous, ask one specific question rather than guessing and building the wrong thing.
- When you make a design tradeoff that is not covered by an ADR, state it explicitly in your response so it can be reviewed.
- Do not add dependencies without flagging it first. Every new package is a maintenance and supply-chain cost.
- If something in an ADR turns out to be wrong once implementation starts, say so directly. The ADRs are decisions, not doctrine.

## Out of scope for v1

Secret versioning and history, zero-knowledge buckets, command palette. If a task drifts toward these, flag it rather than building it.

Bulk fetch is in scope, but gated: `?reveal=true` is reachable only by an API key carrying an explicit reveal scope, never by a web session, and is rejected rather than ignored without that scope. See ADR 002 A4.
