# The README and the threat model, design

Date: 2026-08-12
Status: Approved, ready for planning
Depends on: SP8 (merged), ADR 001 and ADR 002 as amended

## Purpose

The README describes a project that no longer exists. Its status block says
SP2 and claims there is no login screen, no bucket or secret schema, and no
encryption. All eight numbered sub-projects have shipped since.

Its threat model section says it "will be written up here in SP4". SP4 merged
four sub-projects ago.

For a repository whose stated purpose is producing credible evidence of
engineering judgment, this is the most visible defect in it: the first thing a
reader sees, understating the work by six sub-projects.

Documentation only. No code changes, no dependency changes, no schema changes.

## Where this sits

SP8's spec closed the numbered sequence: "Nothing to a further numbered
sub-project. This is the last one." That promise stands. The remaining
hardening work is named by topic rather than continuing to SP9.

Four independent pieces were identified. This spec covers the first:

| Piece | Touches | Status |
|---|---|---|
| **The README and the threat model** | docs only | this spec |
| Security headers | one middleware in `main.py` | not started |
| Per-key rate limiting | middleware, storage, config | not started, needs design |
| KEK rotation CLI | `api/scripts/`, crypto | not started, needs design |

They are independent. This one is first because it is cheapest, has no
dependencies, and is the only one a reader encounters before the deploy lands.

## Scope

### In scope

- Rewriting the status block, including the gaps
- Adding what the product does
- A worked API walkthrough
- A short encryption section
- The threat model, as amended
- Completing the environment variable table
- Trimming the authentication section to proportional depth

### Explicitly out of scope

- **Any code change.** Nothing under `api/` or `web/` is touched, so `make
  types` produces no diff and the test suites are unaffected.
- **Screenshots.** Considered and rejected for now: they need a browser this
  environment does not have, they commit binaries, and they go stale
  invisibly, since nothing fails when the UI changes underneath them. The
  walkthrough carries the evidence instead.
- **The other three hardening pieces.** Each gets its own spec.
- **The em dash at `web/src/features/secrets/useSecrets.ts:77`**, which
  CLAUDE.md forbids and which arrived in SP7's final review fix wave. This
  spec touches no frontend file, and fixing an unrelated file is what the
  smallest-change rule exists to prevent. It is recorded here so the next
  person to open that file knows it is known.

## The shape of the rewritten README

Ten sections, ordered so a reader learns what it is, sees it work, then sees
why the interesting parts are built the way they are.

| Section | Fate |
|---|---|
| Status | rewritten |
| What it does | new |
| Architecture | kept unchanged |
| A worked walkthrough | new |
| Encryption | new |
| End-to-end type safety | kept unchanged |
| Local development | kept, environment table completed |
| Authentication | trimmed from about 40 lines to about 15 |
| Repository layout | kept, updated |
| Testing | kept, extended |
| Threat model | written |

### The status block names its own gaps

For a secret manager, claiming v1 complete while per-key rate limiting does
not exist would be an overclaim of exactly the kind this project's reviews
keep catching. A reader who finds an unnamed gap trusts everything else less.

The block states three things: the feature set is complete and tested end to
end; it is deployed nowhere, because the Fly and Vercel configuration is
written but has never been applied pending a domain; and per-key rate
limiting, security headers and the KEK rotation CLI are deliberately not built
yet, each pointing at the ADR that deferred it.

### The walkthrough is the evidence

A fenced transcript, browser steps compressed to a comment, then real `curl`
against the API: read a secret with a key, then the same key refused on
`?reveal=true` because it lacks the reveal scope.

The refusal is the half that matters. It teaches the scope model better than
prose can, and it demonstrates that the guarantee is enforced rather than
merely claimed. This is a CI-oriented tool, so its API is the product surface
a reader most needs to see working.

### The environment table is currently incomplete, and that has bitten

The table documents only the five OAuth variables. `DATABASE_URL`,
`CORS_ORIGINS`, `SECRETS_KEKS` and `SECRETS_KEK_VERSION` are missing from it,
though `.env.example` carries them.

That omission produced a real failure during this project: `make migrate` and
`make dev` aborted with `secrets_keks: Field required` against a `.env` copied
before those lines existed. The table gains all four, and `SECRETS_KEKS` gains
the command that generates a key, because a reader who cannot produce a valid
KEK cannot run the project at all.

### Authentication shrinks because it stopped being the whole product

It currently runs about forty lines, with an endpoint table and a full
environment variable table, because it was written when authentication was the
only feature. The secret manager the project is named after gets nothing.

The endpoint table and the open-registration note stay, since cross-user
isolation being load bearing is worth saying. The OAuth setup detail defers to
`docs/google-oauth-setup.md`, which already covers it more thoroughly than a
README section should.

## The threat model

### Verbatim is no longer correct, and the spec records why

ADR 002's threat model section opens "This belongs verbatim in the README."
ADR 001 A6 repeats it: the threat model "stays in the README, per the original
leaning and per ADR 002's instruction that it appear there verbatim."

**Both are superseded by ADR 002 A19**, and CLAUDE.md establishes that
amendments override the body above them. A19 was written after SP3's
implementation review found the base text's central claim "true but narrower
than the phrasing suggests".

Copying verbatim would therefore ship the overclaim the review caught. The
README carries the threat model **as amended**, and A19's own words for what
that means are treated as the source: "the AAD prevents ciphertext relocation,
not database tampering in general."

### Four adversaries, not two

The base text distinguishes a database attacker from a compromised server.
A19's correction is that **read access and write access to Postgres are
different adversaries**, and the base text collapses them.

**Read access to the database.** Stolen backup, SQL injection dump, leaked
snapshot from a misconfigured bucket, insider with read privileges. Obtains
ciphertext and wrapped DEKs and nothing usable, because the KEK is not in the
database. This is the case the whole design exists for.

**Write access to the database.** Cannot read a value. Cannot relocate a
ciphertext: moving a `wrapped_dek` between bucket rows, editing a bucket's
`id`, forging a `kek_version`, or truncating a wrapped value all fail closed
as `InvalidTag`, or as `UnknownKekVersion` when the row names a KEK the
deployment does not hold.

Can deny service. Can reassign a bucket's ownership by changing `user_id`,
because nothing binds a bucket to its owner, only to its own id. That is
deliberate rather than an oversight: the same attacker can insert a `sessions`
row for any `user_id` and read everything through the front door, so binding
the owner into the AAD would buy nothing against this adversary while making
ownership permanently immutable, since changing it would make every secret in
the bucket undecryptable.

**A leaked API key.** The credential most likely to leak, because it lives in
CI. Reaches the four secret endpoints only, inside the bucket scope it was
issued for. With `can_write` it can permanently destroy the secrets in that
scope, because ADR 002 A5 rules out versioning and nothing binds a stored blob
to a point in time; `can_write` is create, overwrite and delete, and should be
withheld from a pipeline that only reads. It can never delete a bucket or mint
another key. That is structural rather than a check: those endpoints depend on
a session-only resolver that never reads the `Authorization` header, so a key
presented to them is not refused, it is never read.

Reads are audited, so a leaked key's activity leaves a record. ADR 002 A21
makes an unauditable read fail rather than serve silently.

**A compromised application server.** RCE on the API process means access to
the KEK and therefore to everything. Equally true of AWS Secrets Manager,
Doppler, and Infisical.

### Why not zero-knowledge

Unchanged from ADR 002, because the reasoning has not moved: client-side
encryption with a passphrase-derived key would remove the operator from the
trust boundary, but is structurally incompatible with unattended programmatic
access. A CI pipeline calling `GET /v1/buckets/prod/secrets/DATABASE_URL`
presents only an API key; no passphrase exists in that request for the server
to derive a key from. Doppler, Infisical and AWS Secrets Manager all made the
same trade for the same reason. 1Password is zero-knowledge and
correspondingly has no equivalent endpoint.

## Accuracy is the acceptance criterion

This document has no tests, which makes every factual claim in it a liability.
The plan verifies each against the code rather than against memory:

- Endpoint paths and methods against `api/app/routers/`.
- The error codes quoted in the walkthrough against the routers that raise
  them, in particular `REVEAL_NOT_PERMITTED` at
  `api/app/routers/secrets.py:66`.
- The environment variable names against `api/app/config.py` and
  `.env.example`, not against the existing README table, which is the thing
  being corrected.
- The token format against `api/app/api_keys.py`.
- Every `make` target named against the `Makefile`.
- The claim that reads are audited against `record_audit` call sites.

A README that confidently states something the code does not do is worse than
the stale one it replaces, because staleness is obvious and inaccuracy is not.

## Acceptance criteria

1. The status block states the feature set is complete and tested.
2. The status block states nothing is deployed, and why.
3. The status block names rate limiting, security headers and the KEK rotation
   CLI as deliberately not built, each pointing at where it was deferred.
4. A reader learns what the product does before any implementation detail.
5. The walkthrough shows a successful key-authenticated read.
6. The walkthrough shows the same key refused on `?reveal=true`, with the real
   error code.
7. The environment table documents `DATABASE_URL`, `CORS_ORIGINS`,
   `SECRETS_KEKS` and `SECRETS_KEK_VERSION` alongside the OAuth variables.
8. The table shows how to generate a value for `SECRETS_KEKS`.
9. The threat model separates read access from write access to the database.
10. The threat model states that write access can reassign bucket ownership,
    and why that is deliberate.
11. The threat model covers a leaked API key, including that `can_write`
    permits permanent destruction.
12. The threat model states RCE on the API server defeats the design, and
    names the peers for which that is equally true.
13. The authentication section is materially shorter and defers setup detail
    to `docs/google-oauth-setup.md`.
14. No file outside `README.md` changes, except this spec and the plan.
15. `make lint` and `make test` pass unchanged, and `make types` produces no
    diff, since no code is touched.
16. Every endpoint, error code, environment variable and `make` target named
    in the README is verified against the source, not written from memory.

## ADR amendments this spec requires

**ADR 001 A9 and ADR 002 A28, one correction stated once.** Both ADRs instruct
that the threat model appear in the README verbatim. A19 already narrowed the
content those instructions point at, so "verbatim" now names a text that
overclaims.

The numbers are the next free ones as of this writing: ADR 001 ends at A8, ADR
002 at A27, ADR 003 at A12. Confirm before appending, since another branch
could land an amendment first.

The amendment records that the README carries the threat model **as amended by
A19**, and that the instruction was written before A19 existed rather than in
conflict with it. Nothing about the location changes: ADR 001 A6's decision
that it stays in the README stands.

Whether this lands as one amendment in ADR 002 or one in each is a plan
decision, not a design one. It is the same correction either way.

## Risks

**A documentation change has no failing test.** Nothing catches a wrong
endpoint path or an invented error code. The mitigation is the verification
list above, performed against source files, and it is the single most
important part of the plan.

**The walkthrough will go stale if the API changes.** It is not executed by
CI, so nothing fails when a path moves. Accepted: the alternative is a
documentation test harness, which is more machinery than a README earns. The
endpoints it uses are v1 and settled.

**The status block will go stale the moment the deploy lands**, which is the
one change most likely to happen soon. That is a one-line edit, and a status
block that is briefly stale about being deployed is a far smaller failure than
one that is six sub-projects stale about what exists.

## Deferred

To the remaining hardening pieces, each with its own spec: security headers,
per-key rate limiting, and the KEK rotation CLI.

Not code, and outstanding: branch protection on `main`, the domain purchase
that unblocks SP1 Task 12, the GitGuardian false positive on
`POSTGRES_PASSWORD: manguito`, and setting `SECRETS_KEKS` and
`SECRETS_KEK_VERSION` as Fly secrets before the first real deploy.
