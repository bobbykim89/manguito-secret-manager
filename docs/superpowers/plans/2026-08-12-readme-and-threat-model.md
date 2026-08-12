# The README and the threat model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace a README that still describes the project as it stood at SP2 with one that describes what actually shipped, and write the threat model it has been promising since SP4.

**Architecture:** One file changes, `README.md`, section by section, plus one amendment appended to two ADRs. No code, no tests, no dependencies. Because prose has no test suite, each task ends by verifying its factual claims against the source files that own them, and a final task re-verifies the whole document.

**Tech Stack:** Markdown. The facts come from `api/app/routers/`, `api/app/config.py`, `api/app/api_keys.py`, `.env.example`, `Makefile`, and `docs/adr/`.

## Global Constraints

- **Documentation only.** No file under `api/` or `web/` changes. `make types` must produce no diff and both suites must pass unchanged, because nothing they cover is touched.
- **Every factual claim is verified against source, not memory.** This is the spec's stated acceptance criterion. A README that confidently states something the code does not do is worse than the stale one it replaces, because staleness is obvious and inaccuracy is not.
- **The threat model is carried as amended by ADR 002 A19, not verbatim.** ADR 002's body and ADR 001 A6 both say verbatim; A19 later narrowed the central claim, and CLAUDE.md establishes that amendments override the body above them.
- No em dashes, anywhere, including in the README prose.
- Plain and direct. No marketing tone. This is the constraint most at risk in a README, which is the one file that invites it.
- Comments explain why, not what. In prose, prefer the reason over the restatement.
- Commit messages: conventional commits, imperative mood, scoped (`docs(readme): ...`, `docs(adr): ...`).
- Do not add a "Features" bullet list that repeats what the sections below already say. YAGNI applies to prose.

---

## File Structure

```
README.md                 rewritten section by section, in place
docs/adr/0001-repository-structure-and-deployment.md   append A9
docs/adr/0002-backend-architecture-cryptography-and-auth.md   append A28
```

The README is one file and stays one file. Splitting it into `docs/` pages
would work against ADR 001 A6, which put the threat model in the README
specifically for discoverability.

Tasks are drawn along section boundaries. A reviewer can reject the threat
model without rejecting the environment table, which is what makes these
separate tasks rather than one large edit.

**Read `README.md` before each task.** Earlier tasks have already changed it,
and the line numbers in these task briefs refer to the file as it stood before
Task 1.

---

### Task 1: The status block and what the project does

**Files:**
- Modify: `README.md:1-13` (the title and the status blockquote), and insert a new section after the status block

**Interfaces:**
- Consumes: nothing.
- Produces: the `## What it does` section that Task 2's walkthrough follows.

The current status block is the single most misleading thing in the
repository. It says SP2, and it claims there is no login screen, no bucket or
secret schema, and no encryption. All eight numbered sub-projects have shipped.

The replacement names the gaps as well as the achievements. For a secret
manager, claiming completeness while per-key rate limiting does not exist
would be an overclaim of exactly the kind this project's reviews keep
catching, and a reader who finds an unnamed gap trusts everything else less.

- [ ] **Step 1: Read the current file**

Run: `sed -n '1,20p' README.md`
Expected: the title, then a blockquote beginning `> **Status:** SP2,
authentication.`

- [ ] **Step 2: Replace the status block**

Replace lines 1 through 13 (the title, the description, and the whole status
blockquote) with:

```markdown
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
```

- [ ] **Step 3: Add the What it does section**

Insert immediately after the status block, before `## Architecture`:

```markdown
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
```

- [ ] **Step 4: Verify the claims you just made**

Run: `grep -rn "record_audit" api/app/routers/secrets.py | head`
Expected: calls in the read, write and delete paths, confirming "every read,
write and deletion is recorded".

Run: `grep -n "hash_token\|sha256" api/app/api_keys.py | head -3`
Expected: SHA-256 of the whole token, confirming the storage claim.

If either check disagrees with the prose, the prose is wrong. Fix the prose.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): correct the status and say what the project does

The status block still claimed SP2, with no login screen, no schema and no
encryption. It now states what shipped, that nothing is deployed, and which
hardening is deliberately outstanding."
```

---

### Task 2: The worked example

**Files:**
- Modify: `README.md`, inserting a new section after `## Architecture`

**Interfaces:**
- Consumes: the `## What it does` section from Task 1.
- Produces: the worked example that the Encryption section in Task 3 follows.

This is the evidence the README carries in place of screenshots. It shows the
product working, and more importantly it shows a guarantee being *enforced*:
the second request is refused because the key lacks the scope for it.

The refusal is the half that matters. Prose claiming "bulk reveal is gated"
asks to be believed; a transcript showing the 403 does not.

**Both response bodies below are the real shapes**, taken from
`app/envelope.py`'s `Ok` and `Err` models and `app/routers/secrets.py`'s
`SecretValueData`. The error message is copied exactly from
`api/app/routers/secrets.py:67`. Do not paraphrase it.

- [ ] **Step 1: Confirm the error message is still exact**

Run: `sed -n '64,69p' api/app/routers/secrets.py`
Expected: `"REVEAL_NOT_PERMITTED",` followed by `"Bulk reveal requires an API
key with the reveal scope.",`

If the message differs, use what the source says.

- [ ] **Step 2: Add the section**

Insert after the `## Architecture` section, before `## End-to-end type safety
across Python and TypeScript`:

````markdown
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
````

- [ ] **Step 3: Verify the endpoint paths exist as written**

Run: `grep -n 'router = APIRouter' api/app/routers/secrets.py`
Expected: `prefix="/v1/buckets/{bucket}/secrets"`, so
`/v1/buckets/prod/secrets/DATABASE_URL` and `/v1/buckets/prod/secrets` are both
real paths.

Run: `grep -n "reveal: bool" api/app/routers/secrets.py`
Expected: `reveal` is a query parameter on the list endpoint.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): show the API working, and a scope being enforced

A transcript rather than a screenshot: it needs no binaries, and the refused
bulk reveal demonstrates the scope model better than prose asserting it."
```

---

### Task 3: Encryption, and the environment table that has bitten

**Files:**
- Modify: `README.md`, inserting `## Encryption` and correcting the environment variable table inside the authentication section

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the `## Encryption` section the threat model in Task 5 refers back to.

Two independent corrections, grouped because both are about the backend's
configuration and neither is large.

The environment table is a **documented papercut, not a hypothetical**. It
lists only the five OAuth variables. A reader who copies `.env.example` gets
all ten, but a reader who follows the table gets a `ValidationError` naming
`secrets_keks` on the first `make migrate`. That failure happened during this
project.

- [ ] **Step 1: Confirm the full settings list**

Run: `sed -n '45,54p' api/app/config.py`
Expected: exactly ten fields: `database_url`, `cors_origins`, `environment`,
`google_client_id`, `google_client_secret`, `google_redirect_uri`, `app_url`,
`session_cookie_domain`, `secrets_keks`, `secrets_kek_version`.

Use what this prints. If it lists more or fewer, the table follows the source.

- [ ] **Step 2: Add the Encryption section**

Insert after the worked example from Task 2, before `## End-to-end type safety
across Python and TypeScript`:

````markdown
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
````

- [ ] **Step 3: Replace the environment variable table**

Find the `### Environment variables` heading inside the authentication section
and replace its table with the following, keeping the paragraph about
`Settings` being built at import time that follows it:

```markdown
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
```

- [ ] **Step 4: Verify the KEK generation command is the one the project uses**

Run: `grep -n -A2 "Generate one with" .env.example`
Expected: the same `python -c "import base64,os; ..."` line. If `.env.example`
differs, `.env.example` wins and the README copies it, so the two cannot drift.

- [ ] **Step 5: Verify the CORS claim**

Run: `grep -n "cors_origin_list" -A12 api/app/config.py | head -20`
Expected: a wildcard is rejected. If the code merely warns rather than refuses,
soften the table's wording to match.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs(readme): document encryption and every required setting

The environment table listed only the five OAuth variables, so a reader
following it hit a ValidationError naming secrets_keks on first migrate. It now
carries all ten, and the command that generates a KEK."
```

---

### Task 4: Trimming authentication, and extending testing

**Files:**
- Modify: `README.md`, the `## Authentication` section and the `## Testing` section

**Interfaces:**
- Consumes: the environment table Task 3 rewrote, which lives inside the
  authentication section and must survive this trim intact.
- Produces: nothing later tasks depend on.

Authentication runs about forty lines because it was written when
authentication was the only feature. The secret manager the project is named
after currently gets less space than its login flow.

**Do not delete the environment variable table Task 3 just rewrote.** It sits
inside this section. Trim the prose around it.

- [ ] **Step 1: Trim the authentication prose**

Keep the endpoint table and the open-registration paragraph. Replace the
surrounding prose so the section reads:

```markdown
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
```

- [ ] **Step 2: Verify the endpoint paths**

Run: `grep -n '@router\.' api/app/routers/auth.py`
Expected: `/me`, `/google/start`, `/google/callback`, `/logout`, under the
`/v1/auth` prefix. The table must match exactly what this prints.

- [ ] **Step 3: Get the real test counts**

Run: `make test 2>&1 | grep -E "passed|Tests "`
Expected: a pytest total and a vitest total. Note both numbers. Use what this
prints, not what the plan guesses.

- [ ] **Step 4: Extend the testing section**

Replace the `## Testing` section with:

```markdown
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
```

- [ ] **Step 5: Add the verified counts**

Insert the two numbers from Step 3 into the testing section as a final line,
in this shape, substituting the real values:

```markdown
Currently <backend> backend tests and <frontend> frontend tests.
```

If you did not run the suite, do not write the sentence. A number nobody
verified is worse than no number.

- [ ] **Step 6: Verify the invariant tests described actually exist**

Run: `ls web/src/features/secrets/invariants.test.tsx web/src/features/api-keys/*.test.tsx`
Expected: both paths exist. If the api-keys invariant tests live under a
different name, correct the prose to describe what is there.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs(readme): trim authentication and describe the invariant tests

Authentication ran forty lines because it was once the only feature. The
tests that pin security properties are worth more space than the login flow."
```

---

### Task 5: The threat model

**Files:**
- Modify: `README.md`, replacing the `## Threat model` section entirely

**Interfaces:**
- Consumes: the `## Encryption` section from Task 3, which this refers back to
  rather than repeating.
- Produces: nothing later tasks depend on.

This is the section ADR 002 calls "the part that distinguishes deliberate
design from decoration". It has been a placeholder saying "will be written up
here in SP4" since before SP4 merged.

**Do not copy ADR 002's threat model section verbatim, despite its own
instruction to.** ADR 002 A19 was written after SP3's implementation review
found the base text's central claim "true but narrower than the phrasing
suggests". CLAUDE.md establishes amendments override the body above them, so
verbatim would ship the overclaim the review caught.

The substantive difference: **read access and write access to the database are
different adversaries**, and the base text collapses them into one.

- [ ] **Step 1: Read A19 before writing anything**

Run: `sed -n '/^### A19\./,/^---$/p' docs/adr/0002-backend-architecture-cryptography-and-auth.md`
Expected: the amendment, ending with its own stated summary for the README:
"the AAD prevents ciphertext relocation, not database tampering in general."

- [ ] **Step 2: Replace the threat model section**

```markdown
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
that only reads. Every read it performs is recorded against it in the audit
log.

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
```

- [ ] **Step 3: Verify the structural claim about key-management endpoints**

Run: `grep -n "CurrentUser rather than CurrentCaller" -A5 api/app/routers/api_keys.py`
Expected: the comment recording that the dependency never reads the
`Authorization` header. This is what makes "it is never read" true rather than
merely "it is refused". If that changed, the paragraph is wrong.

- [ ] **Step 4: Verify reads are audited**

Run: `grep -n "SECRET_READ" api/app/routers/secrets.py`
Expected: recorded on the single-key read and on each key of a bulk reveal.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): write the threat model, as amended

Carried as amended by ADR 002 A19 rather than verbatim. A19 split the database
attacker into read access and write access after SP3's review found the
original claim broader than the implementation supports."
```

---

### Task 6: The ADR amendments

**Files:**
- Modify: `docs/adr/0001-repository-structure-and-deployment.md`, appending A9
- Modify: `docs/adr/0002-backend-architecture-cryptography-and-auth.md`, appending A28

**Interfaces:**
- Consumes: the threat model Task 5 wrote, which these amendments describe.
- Produces: nothing.

Two ADRs instruct that the threat model appear in the README verbatim. Task 5
deliberately did not, and that decision belongs in the record rather than only
in a commit message.

- [ ] **Step 1: Confirm the amendment numbers are still free**

Run: `grep -o "^### A[0-9]*\." docs/adr/0001-repository-structure-and-deployment.md | tail -2`
Expected: ends at `### A8.`, so A9 is next.

Run: `grep -o "^### A[0-9]*\." docs/adr/0002-backend-architecture-cryptography-and-auth.md | tail -2`
Expected: ends at `### A27.`, so A28 is next.

If either differs, use the next free number and adjust the cross-references
below to match.

- [ ] **Step 2: Append A9 to ADR 001**

```markdown
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
```

- [ ] **Step 3: Append A28 to ADR 002**

```markdown
### A28. The README's threat model follows A19, not the body above it

The threat model section opens "This belongs verbatim in the README." A19 then
narrowed its central claim, and this document's own convention is that
amendments override the body above them, so copying the body verbatim would
publish an overclaim that SP3's review already caught.

**Amended:** the body's instruction is superseded by A19's own summary. The
README distinguishes an attacker with read access to Postgres, who obtains
nothing usable, from one with write access, who can deny service and reassign
bucket ownership but still cannot read a value.

The README also covers a leaked API key, which the body omits entirely and
which A25 settled: the secret endpoints only, inside its scope, with permanent
destruction available under the write scope and no route to bucket deletion or
key issuance.
```

- [ ] **Step 4: Verify no em dashes entered either ADR**

Run: `grep -n "—" docs/adr/0001-repository-structure-and-deployment.md docs/adr/0002-backend-architecture-cryptography-and-auth.md`
Expected: no output from the lines you added. Pre-existing hits elsewhere in
those files are not yours to fix in this task.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/
git commit -m "docs(adr): record that the threat model is carried as amended

Two ADRs said verbatim. A19 narrowed the content they point at, so verbatim now
names a text that overclaims."
```

---

### Task 7: The accuracy pass

**Files:**
- Modify: `README.md`, only where a check below finds it wrong

**Interfaces:**
- Consumes: everything the previous six tasks wrote.
- Produces: the finished document.

Prose has no test suite. This task is the substitute: every factual claim in
the README, checked against the file that owns the truth. The spec makes this
the acceptance criterion, so run every check even where you are confident.

Record the result of each check in the report, including the ones that passed.
A check performed but not recorded is indistinguishable from one skipped, and
this project has already shipped one verification whose green result turned out
to be luck.

- [ ] **Step 1: Every endpoint named in the README exists**

Run:
```bash
grep -oE '/v1/[a-zA-Z0-9{}/_-]+' README.md | sort -u
grep -rn 'APIRouter(prefix\|@router\.' api/app/routers/*.py
```
Compare by hand. Every path in the first list must be constructible from the
second. Note in the report which README paths you checked and against which
router.

- [ ] **Step 2: Every error code named in the README is raised somewhere**

Run:
```bash
grep -oE '"[A-Z_]{4,}"' README.md | sort -u
grep -rn 'ApiError(' api/app/ | head -30
```
Expected: every code the README quotes appears in a real `ApiError` call.

- [ ] **Step 3: Every environment variable named in the README is a real setting**

Run:
```bash
grep -oE '`[A-Z_]{4,}`' README.md | tr -d '`' | sort -u
sed -n '45,54p' api/app/config.py
```
Expected: the README's list is exactly the ten settings, upper-cased. A README
variable with no matching setting is a bug; a setting missing from the README
is a gap.

- [ ] **Step 4: Every make target named in the README exists**

Run:
```bash
grep -oE 'make [a-z-]+' README.md | sort -u
grep -oE '^[a-z-]+:' Makefile | tr -d ':'
```
Expected: every target the README names appears in the Makefile.

- [ ] **Step 5: The token format matches**

Run: `grep -n 'PREFIX = \|_LOOKUP_ID_BYTES\|_SECRET_BYTES' api/app/api_keys.py`
Expected: prefix `msm_`, an 8 character hex lookup id, and a 43 character
url-safe secret. The example token in the worked example must have that shape,
even though its characters are invented.

- [ ] **Step 6: No em dashes, anywhere**

Run: `grep -n "—" README.md`
Expected: no output.

- [ ] **Step 7: Nothing outside the three documentation files changed**

Run: `git diff --stat main...HEAD`
Expected: `README.md`, the two ADRs, the spec, and this plan. Nothing under
`api/` or `web/`.

- [ ] **Step 8: The suites are untouched**

Run: `make lint && make test && make types && git status --short`
Expected: lint clean, both suites passing, and `git status` empty afterwards,
proving `make types` produced no diff.

- [ ] **Step 9: Read the whole file once, as a reader**

Run: `cat README.md`

Check for what the greps cannot: a section that contradicts another, a claim
that is true but misleading, marketing tone, and whether a stranger could clone
this and run it. Fix what you find.

- [ ] **Step 10: Commit any corrections**

```bash
git add README.md
git commit -m "docs(readme): correct what the verification pass found"
```

If the pass found nothing, say so in the report and skip the commit. Do not
manufacture a change to have something to commit.

---

## What this deliberately leaves undone

- **Screenshots.** They need a browser this environment does not have, they
  commit binaries, and nothing fails when the UI changes underneath them. The
  worked example carries the evidence instead.
- **A documentation test harness.** The worked example is not executed by CI,
  so it can go stale silently. Accepted: a README does not earn that machinery,
  and the endpoints it uses are v1 and settled.
- **The other three hardening pieces**: security headers, per-key rate
  limiting, and the KEK rotation CLI. Each gets its own spec.
- **The em dash at `web/src/features/secrets/useSecrets.ts:77`.** It violates
  CLAUDE.md and arrived in SP7's final review fix wave. This plan touches no
  frontend file, and fixing an unrelated file is what the smallest-change rule
  exists to prevent. Recorded so the next person to open that file knows it is
  known.

## Notes for the executing agent

- **Read `README.md` at the start of every task.** Line numbers in these briefs
  describe the file before Task 1 ran.
- The threat model in Task 5 is the one place where following an instruction
  in the ADRs literally would be wrong. The reasoning is in the task; do not
  shorten it back to the body's version.
- `make types` producing a diff means something regenerated against a stale
  schema. Nothing here touches Python, so investigate rather than commit it.
- The status block will go stale the moment the deploy lands. That is a
  one-line edit and a much smaller failure than the six-sub-project staleness
  it replaces.
