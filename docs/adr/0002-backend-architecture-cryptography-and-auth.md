# ADR 002: Backend architecture, cryptography, and auth

Status: Accepted (amended 2026-08-03)
Date: 2026-08-03

## Context

The backend stores user secrets encrypted at rest and serves them over two paths: an authenticated web session for the UI, and a long-lived API key for programmatic access from CI pipelines and scripts.

## Stack

| Concern | Choice |
|---|---|
| Framework | FastAPI |
| ORM | SQLAlchemy 2.x |
| Database | Postgres (Neon, pooled endpoint) |
| Migrations | Alembic |
| Crypto | `cryptography` (`AESGCM` from `hazmat.primitives.ciphers.aead`) |
| Validation | Pydantic v2 |
| Testing | pytest, Hypothesis, testcontainers |
| Lint / types | ruff, mypy |

SQLAlchemy must use `poolclass=NullPool` because Neon's pooled endpoint already runs PgBouncer. Pooling on top of a pooler causes connection accounting problems.

## Encryption design

### Algorithm

**AES-256-GCM.** Authenticated encryption, so tampered ciphertext fails loudly rather than decrypting to garbage.

Explicitly rejected: Argon2 and bcrypt. Both are one-way password hashing functions, not encryption. They cannot return the plaintext, which is the core requirement. Argon2id retains a role only if a passphrase-derived key is ever introduced (see Open questions).

Per-secret storage requirements:

- Fresh random 96-bit nonce per encryption operation. Never reused with the same key.
- AAD (additional authenticated data) set to `bucket_id || key_name`. This binds ciphertext to its row, so an attacker with database write access cannot relocate a ciphertext from a low-value row to a high-value one. **See amendment A2 — plain concatenation is not safe.**
- Store nonce, ciphertext, auth tag, and `key_version` alongside each secret.

### Envelope encryption, two tiers

```
KEK (master key)          held outside the database, in environment config
 └── unwraps DEK          one per bucket, stored wrapped in the buckets table
      └── decrypts secret AES-256-GCM ciphertext in the secrets table
```

**KEK**: one per deployment, owned by the operator, never exposed to end users, never displayed in any UI. Same category of object as the Postgres password or the Google OAuth client secret. Generated once at deploy time:

```bash
python -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"
```

Stored as `SECRETS_KEK` via `fly secrets set`, and in a gitignored `.env` for local development.

**DEK**: 32 random bytes per bucket, wrapped with the KEK, stored in the `buckets` table. Rationale: rotating the KEK becomes rewrapping N bucket DEKs rather than re-encrypting every secret row. Deleting a bucket's DEK cryptographically shreds its contents.

### KeyProvider interface

The KEK source is behind an interface so the deployment target stays swappable:

```python
class KeyProvider(Protocol):
    def wrap(self, dek: bytes) -> bytes: ...
    def unwrap(self, wrapped: bytes) -> bytes: ...
```

- `EnvKeyProvider` — reads `SECRETS_KEK`. This is the v1 implementation and the default.
- `KmsKeyProvider` — calls AWS KMS. Deferred, not part of v1. See ADR 001 for cost reasoning.

`EnvKeyProvider` also means anyone cloning the repo can run the project without a cloud account, which matters for a portfolio piece.

## Threat model

This belongs verbatim in the README. It is the part that distinguishes deliberate design from decoration.

**Protects against:** stolen database backup, SQL injection dump, leaked snapshot from a misconfigured bucket, insider with read access to Postgres. In every case the attacker obtains ciphertext and wrapped DEKs and nothing usable, because the KEK is not in the database.

**Does not protect against:** a fully compromised application server. RCE on the API process means access to the KEK and therefore to everything. This is equally true of AWS Secrets Manager, Doppler, and Infisical.

**Why not zero-knowledge:** client-side encryption with a passphrase-derived key would remove the operator from the trust boundary, but is structurally incompatible with unattended programmatic access. A CI pipeline calling `GET /v1/buckets/prod/secrets/DATABASE_URL` presents only an API key; no passphrase exists in that request for the server to derive a key from. Doppler, Infisical, and AWS Secrets Manager all made the same trade for the same reason. 1Password is zero-knowledge and correspondingly has no equivalent endpoint.

## Authentication

Two credential systems sharing one transport header. The server branches on token prefix.

| Credential | Issued by | Lifetime | Consumer | Storage |
|---|---|---|---|---|
| Session token | Google OAuth exchange | Minutes, with refresh | React app | Not stored; signed |
| API key | User, from dashboard | Until revoked | Scripts, CI | SHA-256 hash only |

**See amendment A3 — the session row is superseded.**

### API key format and handling

Format: `sk_live_<8-char-id>_<base64url(32 random bytes)>`

- The id segment is indexed, so lookup is a single indexed query rather than a table scan on every request.
- Stored as **SHA-256, not Argon2 or bcrypt.** Slow hashing exists to defend low-entropy human passwords. A 256-bit random token has no brute-force surface, and the hash runs on every API request, so a deliberately slow KDF is pure added latency.
- Shown to the user exactly once at creation, with a copy button and a save-this-now warning. Never retrievable afterward.
- Fields: `expires_at` (nullable, user-set), `scopes` (list of bucket ids plus read/write), `last_used_at`, `revoked_at`.

Expiry is optional by design. Forcing rotation on a CI pipeline that only needs a database URL is hostile to the actual use case.

### Transport

```
Authorization: Bearer sk_live_a3f9c2d1_9tHkPq...
```

Note: `Bearer` is an RFC 6750 transport format and implies nothing about lifetime. Short expiry is an OAuth2 access-token convention that does not apply here, because these keys are individually revocable with a single database update.

**Credentials must never appear in query strings.** Query parameters land in nginx access logs, CDN logs, browser history, and `Referer` headers on outbound links. This rules out the originally sketched `/api?API_KEY=...&BUCKET=...&KEY=...` shape.

## API surface

```
GET    /v1/buckets
POST   /v1/buckets
DELETE /v1/buckets/{bucket}
GET    /v1/buckets/{bucket}/secrets
GET    /v1/buckets/{bucket}/secrets/{key}
PUT    /v1/buckets/{bucket}/secrets/{key}
DELETE /v1/buckets/{bucket}/secrets/{key}
GET    /v1/keys
POST   /v1/keys
DELETE /v1/keys/{id}
```

Response envelope, unchanged from the original sketch:

```json
{ "ok": true, "data": "SECRET_VALUE" }
{ "ok": false, "error": { "code": "BUCKET_NOT_FOUND", "message": "..." } }
```

Additional requirements:

- Per-key rate limiting.
- Audit log table: actor, action, bucket, key name, timestamp, source API key id. Never the secret value.
- `GET /v1/buckets/{bucket}/secrets` returns key names and metadata only, never values. Values require the single-key endpoint. **See amendment A4.**

## Logging and error handling

- Decrypted values must never be logged.
- The error handler must not be able to serialize a secret into a stack trace or an exception payload. Add an explicit test for this.
- Structured logging with an explicit allowlist of fields rather than dumping request bodies.

## Test plan

Testing and CI ownership is a stated gap this project is meant to close. Depth here matters more than a coverage percentage.

Crypto tests (Hypothesis where property-based fits):

- Roundtrip: `decrypt(encrypt(x)) == x` across generated inputs.
- Flipping any byte of ciphertext or tag raises `InvalidTag`, never returns plaintext.
- Encrypting identical plaintext twice yields different ciphertext (proves nonce is not reused).
- Decrypting with mismatched AAD fails, proving row binding.
- KEK rotation: secrets remain readable after KEK change and DEK rewrap.

Authorization tests:

- Revoked API key returns 401.
- API key scoped to bucket A returns 403 on bucket B.
- Expired API key returns 401.
- Cross-user bucket access returns 404, not 403 (avoids existence disclosure).

Infrastructure:

- Real Postgres via testcontainers or a session-scoped fixture. Not SQLite; database behavior differences matter here.

## Open questions

- Secret versioning and history. Useful, adds schema complexity. Probably v2. **Resolved — see A5.**
- Whether to add an optional per-bucket passphrase for a zero-knowledge tier alongside the server-side default. Would need a clear UI story about which buckets are API-accessible. Deferred.
- Bulk fetch endpoint for CI (`GET /v1/buckets/{bucket}/secrets?reveal=true`) versus N single-key calls. Convenient but widens blast radius of a leaked key. Leaning toward supporting it with a scope flag. **Resolved — see A4.**

---

## Amendments — 2026-08-03 (SP1 brainstorming)

### A1. SQLAlchemy is synchronous, driver is psycopg3

Not stated above. Routes are `def` and FastAPI runs them in a threadpool.

The workload is a small number of indexed queries plus AES operations; async
buys throughput this project has no traffic to need. Because `NullPool` opens a
fresh connection per request regardless, connection setup rather than
concurrency dominates latency either way. Sync also keeps Alembic's `env.py`
stock, keeps testcontainers fixtures ordinary, and avoids greenlet-boundary
errors between sync and async code.

### A2. The AAD construction must be unambiguous

`bucket_id || key_name` as plain concatenation is **not injective**, and this is
a real vulnerability rather than a style point. Bucket `ab` with key `c` and
bucket `a` with key `bc` produce identical AAD, so ciphertext relocates cleanly
between them — precisely the attack the AAD exists to prevent.

**Amended:** length-prefix the first component.

```python
aad = len(bucket_id).to_bytes(4, "big") + bucket_id + key_name.encode()
```

Add a Hypothesis property asserting that no two distinct `(bucket_id, key_name)`
pairs produce the same AAD.

### A3. Sessions are opaque and server-stored

The authentication table above says the session token is "not stored; signed"
with a lifetime of "minutes, with refresh". This is self-contradictory: a
refresh token that cannot be revoked is no better than a long-lived session, and
making it revocable requires storage, which contradicts "not stored". ADR 001
separately specifies a cookie scoped to `.<domain>`.

**Amended:** an opaque session identifier in an `HttpOnly`, `Secure`,
`SameSite=Lax` cookie scoped to `.<domain>`, with a session row in Postgres. No
refresh mechanism. Revocation is deleting the row. Every request already
reaches Postgres, so the lookup costs nothing extra.

### A4. Bulk reveal is a property of the credential, not the endpoint

ADR 003 requires that the list endpoint never return values, so an unrevealed
secret's plaintext never enters the browser. The CI use case needs the
opposite — a service pulling twenty variables at boot should not make
twenty-one requests.

These are not in conflict, because they are different callers.

**Amended:** `GET /v1/buckets/{bucket}/secrets?reveal=true` is supported, and is
reachable **only** by an API key carrying an explicit reveal scope. A web
session can never set `reveal=true`, regardless of the requesting user's rights.
Without that scope the parameter is rejected, not silently ignored.

### A5. v1 scope: no workspaces, no versioning

Both were considered during SP1 brainstorming and deliberately excluded.

- **Tenancy stays flat.** Buckets belong to a single user; cross-user access
  returns 404, as the test plan above already requires. No workspaces, members,
  or roles in v1. Consequence: the DEK boundary and the access-control boundary
  are the same object, which is cleaner than nesting them.
- **Secret versioning is v2**, confirming the leaning in Open questions.

Both are recorded in a v2 backlog rather than discarded.

### A6. API key prefix

`sk_live_` collides with Stripe's convention and implies an `sk_test_` variant
that will not exist. Choose a project-specific prefix during SP2.

### A7. Rate limiting needs shared storage

Per-key rate limiting is listed above without a mechanism. With Fly's
`min_machines_running = 0`, an in-process counter resets every time the machine
stops, making the limit unenforceable. SP4 must back it with Postgres or an
external store.

---

## Amendments, 2026-08-04 (SP2 brainstorming)

### A8. API keys move to SP3, and A6's prefix decision moves with them

A6 says to choose the replacement prefix "during SP2". It cannot usefully be
chosen there, because API keys themselves cannot usefully be built there: a
key's `scopes` are defined above as a list of bucket ids, and buckets do not
exist until SP3. A key issued in SP2 would scope to nothing and authorize
nothing, since the only endpoint is a public health check.

**Amended:** API key issuance and verification, and the prefix choice, both
belong to SP3, beside the buckets they scope to, where `scopes` can be
validated against real ids.

### A9. Sessions and API keys no longer share a transport

The Authentication section opens with "Two credential systems sharing one
transport header. The server branches on token prefix." A3 obsoleted this
without saying so: sessions now travel in a cookie and API keys in the
`Authorization` header. Different transports, no shared header.

**Amended:** there is no prefix branching. Session tokens need no prefix at
all, because nothing else occupies the cookie they arrive in. Only API keys
need one, which is what A6 and A8 are about. Do not implement a branch that
cannot fire.

### A10. The OAuth flow requires `state` and PKCE

No ADR mentions CSRF protection on the OAuth flow. Without a `state` parameter
the callback accepts any authorization code an attacker can cause a victim's
browser to submit. That is login CSRF: the victim is silently authenticated as
the attacker and stores secrets in the attacker's account.

**Amended:** `/v1/auth/google/start` generates a random `state` and a PKCE
verifier and stores both in a short-lived `HttpOnly` cookie; the callback
rejects any request whose `state` does not match, and clears that cookie on
every exit path including failures.

The cookie is deliberately not signed. The protection is a double submit
comparison, which binds the callback to the browser that began the flow.
Tampering gains an attacker nothing, since they would still need a Google
authorization matching the value they chose.

Process memory is not an option for this state: `min_machines_running = 0`
means the machine can stop between the redirect and the callback, which would
fail logins intermittently and confusingly.

### A11. Registration is open, and identity is Google's `sub`

Nothing above states who may create an account. Deployed with Google OAuth,
the default is anyone on the internet, and that default was chosen
deliberately so a reviewer can try the running system.

**Amended, three parts:**

- **Registration is open.** Any Google account may sign in and gets a user row
  on first login. The consequence: cross-user isolation is load bearing rather
  than theoretical, so the rule above that cross-user access returns 404 rather
  than 403 becomes the most important behavior in SP3.
- **`google_sub` is the identity**, not email. `sub` is stable and unique
  forever; email addresses change and can be reassigned. Email is a mutable
  attribute refreshed on each login.
- **`email_verified` is checked.** With open registration, accepting an
  unverified address would let someone claim an email they do not control.

If the instance ever attracts unwanted signups, the mitigation is an email
allowlist in configuration, which is a config change rather than a schema one.

### A12. Session lifetime and storage

A3 settled the mechanism but not the lifetime or the storage form.

**Amended:** sessions expire absolutely seven days after login, with no
sliding renewal, so a stolen session cannot renew itself indefinitely and no
write is needed on every authenticated request. The token is stored as a
SHA-256 hash, for the same reason API keys are: a 256 bit random token has no
brute force surface, so a slow KDF is pure per-request latency, and hashing
means a stolen database dump does not hand over live sessions.

### A13. SP2 outcomes

Session lifetime, the cookie names, and the error codes are now fixed by
implementation: `msm_session` and `msm_oauth`, seven day absolute expiry, and
four callback error codes: `CONSENT_DENIED`, `INVALID_STATE` for a missing
oauth cookie, a missing `state` query parameter, or a mismatch between them,
`EXCHANGE_FAILED` for a missing code, a rejection or an unreachable Google, a
missing `id_token`, a failed signature, or claims that fail validation, and
`EMAIL_NOT_VERIFIED`. Distinct conditions deliberately share a code, because a
browser can do nothing different with the distinction.
The Google interaction sits behind a `GoogleOAuthClient` protocol so the test
suite performs no network I/O.

### A14. The Google boundary uses `joserfc`, not Authlib

The SP2 spec named Authlib for the OAuth and JWT work. Implementation used
`joserfc` instead.

`authlib.jose` emits a deprecation warning on import and is removed outright
in Authlib 2.0; Authlib's own documentation points integrators at `joserfc`
for JOSE work going forward. `joserfc` still performs the part worth not
hand writing, the JWT signature verification against Google's JWKS, so the
security-relevant code is still a maintained library rather than a bespoke
verifier.

The consequence: the authorization code POST to Google's token endpoint and
the JWKS response cache in `GoogleClient` are both hand written, since
`joserfc` is a JOSE library, not an OAuth client. Neither is complex enough on
its own to justify Authlib's larger surface just to avoid writing them.

This supersedes the SP2 spec's Authlib decision.
