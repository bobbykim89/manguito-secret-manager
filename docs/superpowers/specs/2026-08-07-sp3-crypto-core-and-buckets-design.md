# SP3: Crypto core and buckets, design

Date: 2026-08-07
Status: Approved, ready for planning
Depends on: SP2 (merged), SP2b (merged), ADR 002 as amended

## Purpose

Build the encryption layer the product exists for, and the buckets that hold
its keys. Everything shipped so far is scaffolding and a door: a deploy
pipeline, Google login, and a shell with a placeholder body. SP3 is the first
sub-project that touches the thing being protected.

Backend only. No frontend code, though the generated OpenAPI types change.

## Scope

### In scope

- `app/crypto/`: the `KeyProvider` protocol, `EnvKeyProvider`, and AES-256-GCM
  encrypt and decrypt with the length-prefixed AAD from ADR 002 A2
- `SECRETS_KEKS` configuration, validated at startup, supporting more than one
  KEK version
- The `buckets` table, each row carrying a DEK wrapped under a named KEK
  version
- `GET`, `POST`, and `DELETE` on `/v1/buckets`
- The `audit_log` table and a `record_audit` helper, wired to bucket creation
  and deletion

### Explicitly out of scope

- **Secrets.** The `secrets` table, the four secret endpoints, and the
  emptiness guard on bucket deletion all belong to SP4. `encrypt` and `decrypt`
  are built here anyway; see "Why the cipher ships without a caller".
- **API keys**, the `sk_` prefix replacement, and A4's reveal scope. SP5, where
  scopes can be validated against real bucket ids, per A8.
- **A rotation CLI.** The provider and the schema are rotation-ready and the
  rewrap path is tested, but the operator-facing script waits until there is a
  deployment with data to rotate.
- **Any frontend.** `web/src/api/generated.ts` is regenerated and committed
  because the schema changed, but nothing consumes the new types until SP6.
- Rate limiting, security headers, and the README threat model. Later.
- Workspaces and secret versioning, ruled out for v1 by A5.

## Why the cipher ships without a caller

`encrypt` and `decrypt` have no HTTP consumer in SP3, because secrets arrive in
SP4. They are built here regardless.

This is not speculative work in the sense YAGNI targets. The cipher is the
single highest-risk component in the project, it is fully specified by ADR 002,
and every property that makes it correct is testable without a database row or
an endpoint. Building it beside bucket CRUD would mean reviewing it through the
noise of request plumbing, in the same sub-project as the authorization
boundary. Here it gets a review cycle of its own.

The DEK tier is not in this position: `wrap` and `unwrap` have a caller from
the first commit, because creating a bucket wraps a DEK.

## Module structure

`app/envelope.py` already holds the response envelope, so the crypto package
cannot use that name.

```
api/app/
├── crypto/
│   ├── __init__.py       package docstring only
│   ├── keys.py           KeyProvider, EnvKeyProvider, get_key_provider
│   └── aead.py           build_aad, encrypt, decrypt
├── models/
│   ├── bucket.py
│   └── audit.py
├── routers/
│   └── buckets.py
└── audit.py              record_audit
```

`aead.py` rather than `secrets.py`, to avoid a module that shadows the standard
library's `secrets` in a package that will import it.

## The key tier

### The provider

ADR 002's `KeyProvider` sketch takes no version. It widens here, because a
provider that cannot say which KEK wrapped a given DEK cannot support rotation:

```python
class KeyProvider(Protocol):
    @property
    def current_version(self) -> int: ...
    def wrap(self, dek: bytes, aad: bytes) -> bytes: ...
    def unwrap(self, wrapped: bytes, version: int, aad: bytes) -> bytes: ...
```

`EnvKeyProvider` wraps only with `current_version` and unwraps with whichever
version the row names. `KmsKeyProvider` stays deferred, as ADR 001 decided on
cost grounds.

The provider is a FastAPI dependency, cached the way `get_settings` is.

### Configuration

```
SECRETS_KEKS=1:<base64 32 bytes>,2:<base64 32 bytes>
SECRETS_KEK_VERSION=2
```

One variable to rotate, explicit versions, and it reads sensibly in
`fly secrets list`.

`Settings` validates at startup and fails hard: at least one key, the current
version present in the map, every value decoding to exactly 32 bytes, and every
value valid base64. A 31-byte KEK is a configuration error worth crashing on,
not degrading through. This follows the fail-closed reasoning already applied
to `is_production`.

`tests/conftest.py` and `scripts/dump_openapi.py` each gain `os.environ.setdefault`
lines, matching the pattern already there for the Google settings. The stub
value must be a real base64-encoded 32-byte key, not a placeholder string like
`"test-kek"`, because the validator rejects anything else.

### The DEK wrap is itself authenticated, bound to its bucket

Wrapping uses AES-256-GCM with the bucket's id as AAD, so a wrapped DEK cannot
be relocated between bucket rows. This is A2's binding applied one tier up.

One consequence: bucket ids are generated in Python with `default=uuid.uuid4`
rather than by `gen_random_uuid()` the way `User` does, because the id must
exist before the DEK can be wrapped with it. A deliberate deviation from the
existing model, recorded here so it is not read as an oversight.

## The secret tier

```python
def build_aad(bucket_id: uuid.UUID, key_name: str) -> bytes:
    raw = bucket_id.bytes
    return len(raw).to_bytes(4, "big") + raw + key_name.encode("utf-8")
```

The length prefix is what makes the construction injective, per A2. Plain
concatenation is not: bucket `ab` with key `c` and bucket `a` with key `bc`
produce the same AAD, and ciphertext then relocates cleanly between the two
rows, which is the attack the AAD exists to prevent.

`encrypt` generates a fresh 96-bit nonce per call and returns the nonce
alongside ciphertext-with-tag. `decrypt` reverses it and lets `InvalidTag`
propagate rather than catching it, so tampering fails loudly.

## Data model

### `buckets`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | primary key, `default=uuid.uuid4` |
| `user_id` | UUID | FK `users.id`, `ON DELETE CASCADE` |
| `name` | Text | `^[a-z0-9][a-z0-9_-]{0,62}$` |
| `wrapped_dek` | LargeBinary | nonce plus ciphertext and tag |
| `kek_version` | Integer | names the KEK that wrapped it |
| `created_at` | timestamptz | matching the existing models |
| `updated_at` | timestamptz | matching the existing models |

Unique on `(user_id, name)`. That constraint's index leads with `user_id`, so
listing a user's buckets needs no second index.

`Bucket` defines an explicit `__repr__` that omits `wrapped_dek`. SP2 produced
a test asserting `token not in repr(row)` that passed tautologically, because
no `__repr__` existed for anything to leak through. Defining one here makes the
equivalent test mean something.

Deleting a bucket destroys its wrapped DEK, so any ciphertext that survives in
an old database backup becomes permanently unreadable. That is the cryptographic
shredding property ADR 002 describes, and it is why deletion is hard rather than
soft: a soft delete retaining the wrapped DEK gives up the guarantee.

### `audit_log`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | primary key |
| `user_id` | UUID | FK `users.id`, the actor |
| `api_key_id` | UUID, nullable | no FK until SP5 creates the table |
| `action` | Text | `bucket.created`, `bucket.deleted` |
| `bucket_name` | Text, nullable | a name, deliberately not an FK |
| `key_name` | Text, nullable | unused until SP4 |
| `created_at` | timestamptz | |

**The bucket is recorded as a name, not a foreign key.** An FK would cascade on
bucket deletion and erase the record of the deletion itself, which is precisely
the event most worth keeping. An audit log must outlive its subjects.

`record_audit` takes explicit named parameters and never a dict or `**kwargs`.
That signature is invariant 1's field allowlist expressed in code: there is no
argument through which a plaintext value could arrive.

The audit write shares the request's transaction and commits with it. An action
that succeeded without its audit row is worse than an action that failed.

## Endpoints

All three require `CurrentUser`, which SP2 already provides.

```
GET    /v1/buckets           list: id, name, created_at
POST   /v1/buckets           create from {"name": "..."}
DELETE /v1/buckets/{name}    delete
```

`{bucket}` is the **name**, not the id. ADR 002's own threat model writes the
example call as `GET /v1/buckets/prod/secrets/DATABASE_URL`, and a CI config
carrying a readable path beats one carrying a UUID. The AAD still binds on the
immutable id, so the two choices do not conflict.

Creating a bucket generates 32 random bytes, wraps them with the current KEK
using the new bucket's id as AAD, and inserts. Concurrent creates with the same
name are resolved by catching the unique-constraint violation, because
check-then-insert has a race the constraint does not.

A secret count on the list response would serve the UI and is deferred to SP4,
when there is a table to count.

### Errors

| Code | Status | Cause |
|---|---|---|
| `BUCKET_EXISTS` | 409 | that name already exists for this user |
| `BUCKET_NOT_FOUND` | 404 | no such bucket, **or it belongs to someone else** |
| `BUCKET_NOT_EMPTY` | 409 | reserved; SP4 implements it |
| validation error | 422 | name fails the charset rule |
| `UNAUTHENTICATED` | 401 | existing behaviour from SP2 |

Another user's bucket returns 404 and never 403, as ADR 002's test plan
requires, so the API never confirms that a name exists.

`DELETE` returns 200 with `{"ok": true, "data": {"deleted": true}}` rather than
204. A 204 carries no body, and `web/src/api/client.ts` narrows every response
through the envelope exactly once. `POST /v1/auth/logout` set this precedent by
returning `{"ok": true, "data": {"signed_out": true}}`.

### The emptiness guard cannot be built here

`BUCKET_NOT_EMPTY` is decided but not implementable in SP3: there is no secrets
table to count. `DELETE` always succeeds here. SP4 adds the guard in the same
commit that creates the table, so no window exists in which the endpoint is
shipped with an untested branch.

## Failure handling

A decryption or unwrap failure means database tampering or a KEK mismatch, not
a user error. It surfaces through the existing handler as a 500 carrying
`INTERNAL_ERROR_MESSAGE`.

As implemented, no module in SP3 logs anything at all, so there is no line
recording the bucket id. That is deferred to SP4 rather than built here,
because `unwrap_dek` has no production caller until the secret endpoints
arrive, so a failure log would have nothing to record. SP4 adds it with the
first caller that can actually fail.

Bound parameters are kept out of SQLAlchemy's exception strings by
`hide_parameters=True` on the engine. Without it a failed insert renders every
bound value into `str(exc)`, binary included and untruncated, and the unhandled
exception handler logs that at ERROR. In SP3 the value at risk is a wrapped
DEK; in SP4 it is secret ciphertext.

Configuration failures crash at startup rather than at first use.

## Testing

Real Postgres via testcontainers, per the existing `conftest.py`. Hypothesis
for the crypto properties, per CLAUDE.md.

### Crypto

- Roundtrip across generated strings, including empty, unicode, and long values
- Flipping any byte of nonce, ciphertext, or tag raises `InvalidTag` and never
  returns plaintext
- The same plaintext encrypted twice yields different ciphertext, which is what
  proves the nonce is fresh
- Decrypting under a different AAD fails, proving row binding
- **AAD injectivity:** no two distinct `(bucket_id, key_name)` pairs produce the
  same AAD. This is the property that would have caught the original
  plain-concatenation bug
- **Wrap binding:** a DEK wrapped under bucket A's id fails to unwrap under
  bucket B's
- Rotation: wrap under version 1, make version 2 current, confirm the version 1
  wrapping still unwraps, rewrap, confirm it unwraps under version 2

### Configuration

Absent `SECRETS_KEKS`, a current version missing from the map, a key decoding to
other than 32 bytes, and malformed base64 each fail at startup.

### Endpoints

- Create returns the bucket, and the stored `wrapped_dek` unwraps to 32 bytes
- A duplicate name returns 409
- **The same name created by two different users both succeed**, proving the
  uniqueness scope
- Listing returns only the caller's buckets
- Delete removes the row
- **Another user's bucket returns 404**, not 403
- A nonexistent bucket returns 404
- Name validation parametrized over uppercase, a space, a slash, a leading
  hyphen, empty, and 64 characters
- Every endpoint returns 401 without a session

### Audit

- Creating a bucket writes one entry with the right action and name
- Deleting a bucket writes an entry, and **that entry still exists after the
  bucket it names is gone**
- A `caplog` assertion that no DEK material appears in log output across a full
  create-and-delete cycle, which exercises invariant 1 against the only secret
  material SP3 holds

## Acceptance criteria

1. `EnvKeyProvider` wraps with the current KEK version and unwraps with any
   configured version.
2. A DEK wrapped under one bucket's id fails to unwrap under another's.
3. `build_aad` is injective over distinct `(bucket_id, key_name)` pairs, proven
   by a Hypothesis property.
4. `decrypt(encrypt(x)) == x`, tampering raises `InvalidTag`, and the same
   plaintext twice yields different ciphertext.
5. A rewrap after a KEK version change leaves the DEK recoverable.
6. An invalid `SECRETS_KEKS` crashes at startup rather than at first use.
7. `POST /v1/buckets` stores a wrapped DEK that unwraps to 32 bytes.
8. Two users can each own a bucket named `prod`.
9. Another user's bucket returns 404, not 403.
10. Bucket names outside `^[a-z0-9][a-z0-9_-]{0,62}$` are rejected.
11. Deleting a bucket leaves its audit entry intact.
12. No DEK material appears in logs or in `repr(Bucket)`.
13. `make lint` and `make test` pass, and the regenerated
    `web/src/api/generated.ts` is committed so `types-drift` is clean.
14. `cryptography` is the only new dependency.

## ADR 002 amendments this spec requires

Recorded alongside the spec.

**A15. The key version belongs on the bucket, not the secret.** The encryption
design says to store `key_version` alongside each secret and also says the point
of the DEK tier is that rotating the KEK rewraps N bucket DEKs "rather than
re-encrypting every secret row". Both cannot be true of one column. If KEK
rotation never touches secret rows, a version stamped on a secret cannot be
tracking the KEK, and DEK rotation is never specified. Amended: `kek_version`
lives on `buckets`, next to the wrapped DEK it describes. Secret rows carry no
version.

**A16. Buckets are addressed by name, unique per user.** `{bucket}` in every
path is the name, matching the ADR's own `GET /v1/buckets/prod/...` example.
Names match `^[a-z0-9][a-z0-9_-]{0,62}$` and are unique per `(user_id, name)`,
so two users may each own `prod`. The charset restriction makes a name
containing `/`, a space, or `..` impossible rather than something every endpoint
must escape. The AAD continues to bind on the immutable id.

**A17. The audit log starts in SP3 and records buckets by name.** ADR 002 lists
the audit table under the API surface without assigning it to a sub-project. It
is built here so that SP4 and SP5 call an existing helper rather than
retrofitting one across shipped endpoints, and so invariant 1's boundary is
proven while the system holds no secret values at all. The bucket is stored as a
name in a text column, not a foreign key, because an FK would cascade on bucket
deletion and destroy the record of that deletion. `api_key_id` is present and
nullable, gaining its foreign key in SP5.

**A18. Bucket deletion is hard, and refused while the bucket is non-empty.**
Deleting destroys the wrapped DEK, which is what makes surviving ciphertext in
an old backup permanently unreadable. A non-empty bucket returns
`BUCKET_NOT_EMPTY` at 409; the caller deletes its secrets first. SP3 reserves
the code and SP4 implements the guard, since SP3 has no secrets table to count.

## Risks

**The cipher has no consumer until SP4**, so its tests are the only thing
holding it correct. If a property is missing, nothing else will catch it. This
is the argument for the Hypothesis suite being thorough rather than
representative.

**`SECRETS_KEKS` is a new required setting.** Anything that imports `app.main`
without it fails, which is by design, but it means `conftest.py`,
`dump_openapi.py`, `.env.example`, and the Fly deployment each need it before
they work again.

**Rotation is built but never exercised end to end.** The rewrap path is unit
tested, and no deployment has data to rotate. The first real rotation will be
the first time the whole path runs together.

## Deferred

To SP4: the `secrets` table, the four secret endpoints, the emptiness guard,
`key_name` on audit entries, and secret counts on the bucket list.

To SP5: API keys, the prefix replacing `sk_live_`, the `api_key_id` foreign key,
and A4's reveal scope.

To SP6: the bucket and secret UI, where Zustand, Zod, and React Hook Form
finally arrive with real consumers.

Later: rate limiting, security headers, the README threat model, and the
rotation CLI with its runbook.

To v2: workspaces and secret versioning, as A5 ruled.
