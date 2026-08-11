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

---

## Amendments, 2026-08-07 (SP3 brainstorming)

### A15. The key version belongs on the bucket, not the secret

The encryption design says to store `key_version` alongside each secret. It also
says the point of the DEK tier is that rotating the KEK becomes "rewrapping N
bucket DEKs rather than re-encrypting every secret row". Both cannot be true of
the same column. If KEK rotation never touches secret rows, a version stamped on
a secret cannot be tracking the KEK, and it could only track a DEK generation,
which this ADR never specifies.

**Amended:** `kek_version` lives on `buckets`, beside the wrapped DEK it
describes. Secret rows carry no version. If DEK rotation is ever introduced, it
gets its own amendment and its own column.

### A16. Buckets are addressed by name, unique per user

`{bucket}` in every path is the bucket's name, matching this ADR's own threat
model example, `GET /v1/buckets/prod/secrets/DATABASE_URL`. A CI config
carrying a readable path beats one carrying a UUID.

Names match `^[a-z0-9][a-z0-9_-]{0,62}$` and are unique per `(user_id, name)`,
so two users may each own a bucket called `prod`. The charset restriction makes
a name containing `/`, a space, or `..` impossible rather than something every
endpoint has to escape correctly.

The AAD continues to bind on the immutable bucket id, so name and identity stay
separate concerns.

### A17. The audit log starts in SP3 and records buckets by name

The API surface lists an audit table without assigning it to a sub-project. It
is built in SP3, so SP4 and SP5 call an existing helper rather than retrofitting
one across shipped endpoints, and so the logging boundary is proven while the
system holds no secret values at all to leak.

The bucket is stored as a name in a text column, **not a foreign key**. An FK
would cascade on bucket deletion and destroy the record of that deletion, which
is the event most worth keeping. An audit log has to outlive its subjects.

`record_audit` takes explicit named parameters, never a dict or `**kwargs`. That
signature is the field allowlist expressed in code: no argument exists through
which a plaintext value could arrive.

`api_key_id` is present and nullable from the start, gaining its foreign key in
SP5 when the table exists.

### A18. Bucket deletion is hard, and refused while the bucket is non-empty

Deleting a bucket destroys its wrapped DEK, which is what makes any ciphertext
surviving in an old database backup permanently unreadable. That is the
cryptographic shredding property this ADR describes, and it is why deletion is
hard rather than soft: a soft delete retaining the wrapped DEK gives up the
guarantee.

A non-empty bucket returns `BUCKET_NOT_EMPTY` at 409. The caller deletes its
secrets first. SP3 reserves the code and SP4 implements the guard, because SP3
has no secrets table to count.

### A19. What the AAD binding does and does not guarantee

The threat model says an attacker with database write access "cannot relocate a
ciphertext from a low-value row to a high-value one". SP3's implementation
review established that this is true but narrower than the phrasing suggests,
and the difference is worth stating rather than leaving to inference.

**Cannot**, because the AAD binds a wrapped DEK to its bucket's id and a secret
to its `(bucket_id, key_name)` pair: move a `wrapped_dek` between bucket rows,
edit a bucket's `id`, forge a `kek_version`, or truncate or corrupt a wrapped
value. All of these fail closed as `InvalidTag`, or as `UnknownKekVersion` when
the row names a KEK the deployment does not hold.

**Can**: change a bucket's `user_id` and so reassign its ownership. Nothing
binds a bucket to its owner, only to its own id.

That is deliberate rather than an oversight. The same attacker can insert a
`sessions` row for any `user_id` and read everything through the front door, so
binding the owner into the AAD would buy nothing against this adversary while
making ownership permanently immutable, since changing it would make every
secret in the bucket undecryptable.

The honest summary for the README's threat model: the AAD prevents ciphertext
relocation, not database tampering in general. An attacker with write access to
Postgres can deny service and can reassign ownership; they cannot read a secret
value, because the KEK is not in the database.

---

## Amendments, 2026-08-08 (SP4 brainstorming)

### A20. A secret row stores one authenticated blob

The encryption design says to store nonce, ciphertext, auth tag and key version
alongside each secret. A15 already removed the key version. The remaining three
are not stored separately either.

`encrypt` returns them as a single `nonce || ciphertext || tag` value and
`decrypt` expects exactly that layout, so storing them in three columns would
mean disassembling the cipher's own output on write and reassembling it on
read, with a chance of getting the offsets wrong at both ends.

**Amended:** a single `ciphertext` column holds all three, documented as such.

### A21. Reads are audited, and an unauditable read fails

The audit table is listed under the API surface without saying which operations
produce entries.

**Amended:** reads produce entries alongside writes and deletes. "Who read this
secret and when" is the question the log most exists to answer, and a leaked
credential's activity leaving no record is the first gap felt after an incident.

The entry shares the read's transaction, following the rule A17 established, so
a read that cannot be audited is refused rather than silently served. This
couples read availability to the audit table, which nothing else in the system
does. That is deliberate: a manager that silently serves unlogged reads has lost
what the log is for, and a refusal is visible where a missing row is not.

The consequence for callers is that `GET` on a secret is not safe in the HTTP
sense. It must never sit behind a cache or a retry that assumes otherwise.

### A22. Key names deliberately do not follow A16

A16 fixed bucket names as lowercase only, so a name can never need URL escaping
and can never look like a path segment.

Key names do not inherit that rule. They are
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` and case-sensitive, because the use case is
environment variables and this ADR's own worked example is `DATABASE_URL`, which
A16's pattern rejects outright.

Case sensitivity mirrors how environment variables behave. It costs the
possibility of `DATABASE_URL` and `database_url` coexisting in one bucket, so a
typo creates a silent second secret rather than an error. Folding case was
rejected because it would make the stored name differ from the lookup key and
turn a case-only rename into a silent overwrite.

The asymmetry with A16 is intentional. Someone reading A16 should not assume it
generalises to every name in the system.

### A23. SP4 outcomes, and what ciphertext adds to A19's "can" column

SP4 is the first sub-project where a secret value exists, so A19's account of what
database write access buys needs one addition.

**Also can: roll a secret back.** An attacker with write access can restore an
earlier ciphertext blob for the same `(bucket_id, key_name)` and it will decrypt
cleanly, because nothing binds a blob to a point in time. A15 removed the per-row
version deliberately, and `updated_at` uses SQLAlchemy's `onupdate`, which fires
only for writes issued through the ORM, so a direct `UPDATE` leaves the timestamp
untouched. A retired credential can therefore be reinstated with no metadata
trace.

That is inherent to the no-versioning decision A5 made for v1 rather than a
defect introduced here. Secret versioning is already in the v2 backlog, and it is
the feature that would close this.

**Fixed by implementation:** the single-key read sets `Cache-Control: no-store`.
A21 says that response must never sit behind a cache, and until SP4's final
review nothing on the wire said so.

**Fixed by implementation:** deleting a bucket locks its row with `FOR UPDATE`
before checking that it is empty. Without the lock the check and the delete are
two statements a concurrent secret write can slip between: the check sees
nothing, the insert commits, and `ON DELETE CASCADE` removes the secret that was
just written, with both requests reporting success. A18 makes bucket deletion
hard precisely because it is cryptographic shredding with no undo, so that was
the one path where its guard could be stepped over.

---

## Amendments, 2026-08-10 (SP5 brainstorming)

### A24. The prefix is `msm_`, and the format is fixed

A6 rejected `sk_live_` because it collides with Stripe's convention and implies
an `sk_test_` variant that will never exist, and A8 moved the replacement to
SP5. The prefix is `msm_`, matching the `msm_session` and `msm_oauth` cookies
this project already sets.

**Amended:** a key is `msm_<8 char lookup id>_<43 char base64url secret>`. The
lookup id is unique and indexed so verification is one query rather than a scan
that hashes every candidate; it is not secret and carries no entropy claim. The
secret is 32 random bytes.

The stored hash is SHA-256 of the **whole token**, not of the secret segment
alone. This is defence in depth rather than the load bearing control: what
actually refuses a token pairing one key's lookup id with another key's
secret is verification resolving exactly the row that id names and comparing
only against it. Covering the whole token keeps the stored digest from being
a function of the secret alone, which is what would matter if that lookup
ever changed shape.

Comparison uses `compare_digest` on encoded bytes, because `compare_digest`
raises `TypeError` on a `str` containing non-ASCII, which in SP2 escaped a
failure path entirely and produced a 500 with a live credential still set.

### A25. API keys reach the secret endpoints only

Buckets and key management require a session.

Deleting a bucket destroys its data key, which is shredding with no undo and
no versioning to fall back on. Issuing a key creates a credential that
outlives the one that made it. A leaked key can reach neither.

It can, with `can_write`, permanently destroy the secrets inside its scope,
because A5 rules out versioning and nothing binds a stored blob to a point in
time. `can_write` is create, overwrite and delete, not merely create, and it
should be withheld from a pipeline that only reads.

**Amended:** the four secret endpoints accept a session or a key. Everything
else accepts a session only.

This is enforced structurally rather than by a check. The bucket and key
endpoints depend on a session-only resolver that never reads the
`Authorization` header, so a key presented to them is not rejected by a rule
someone could forget to write into a future endpoint: it is never read at all.

### A26. A bucket outside a key's scope returns 404

The same answer an unowned bucket gives, so a leaked key probing bucket names
learns nothing, which is the entire point of scoping it.

A denied **write** is 403 rather than 404, because by that point the caller has
already proved it may see the bucket, so refusing tells it nothing new.

**Amended:** out of scope is 404 `BUCKET_NOT_FOUND`; denied write is 403
`WRITE_NOT_PERMITTED`; denied reveal is 403 `REVEAL_NOT_PERMITTED`.

The debugging cost is accepted and known: a mis-scoped key looks like a missing
bucket. The message is identical to the unowned case so there is nothing to
infer from the difference, and the dashboard that issued the key shows its
scopes.

### A27. Two accepted gaps in the credential trail

Recorded rather than fixed, so neither is discovered as a surprise.

**A revoked or expired key leaves no trace when presented.** Verification
resolves the row, sees `revoked_at` or `expires_at`, and returns without
touching `last_used_at` or writing an audit entry. So the log cannot answer
whether an attacker kept using a credential after it was revoked, which is
among the first questions asked after a leak. Closing it means writing on a
path that has just refused a credential, which is a small unauthenticated
write surface, so it belongs with the rate limiting A7 defers rather than
ahead of it.

**A refused bulk reveal is audited before ownership is checked.** A4 requires
the refusal to precede any bucket lookup, so a key without the reveal scope
can append one `reveal.denied` row per request naming any well formed bucket
string it invents. That is the correct trade for keeping the refusal
independent of a resource the caller was never entitled to ask about, and the
resulting log growth is bounded by the same rate limiting A7 defers.
