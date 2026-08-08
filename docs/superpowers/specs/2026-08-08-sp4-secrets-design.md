# SP4: Secrets, design

Date: 2026-08-08
Status: Approved, ready for planning
Depends on: SP3 (merged), ADR 002 as amended

## Purpose

Store and retrieve secret values. SP3 built the cipher, the key tier, and the
buckets that hold a wrapped data key, but nothing is encrypted with it: the DEK
has no consumer and `unwrap_dek` has no production caller. SP4 gives it both.

Backend only, though the generated OpenAPI types change.

## Scope

### In scope

- The `secrets` table, one row per key, holding an authenticated ciphertext
- `GET`, `PUT` and `DELETE` on a single key, and the metadata-only list
- The `?reveal=true` gate, refused on the credential
- The `BUCKET_NOT_EMPTY` guard SP3 reserved but could not build
- `key_name` on audit entries, and four new audit actions including reads
- `secret_count` on the bucket list
- The decrypt-failure log line SP3 deferred here

### Explicitly out of scope

- **API keys** and granting the reveal scope. SP5, per A8. In SP4 the gate
  always refuses, because a session is the only credential and a session can
  never carry the scope.
- **Bulk fetch actually returning values.** The gate is built here; what it
  guards arrives with the credential that can pass it.
- **Any frontend.** `web/src/api/generated.ts` is regenerated and committed
  because the schema changed, but nothing consumes the new types until SP6.
- Rate limiting, security headers, the README threat model, the rotation CLI.
- Secret versioning and workspaces, ruled out for v1 by A5.

## Key names are not bucket names

Bucket names are lowercase only, fixed by A16. Key names cannot inherit that
rule: the use case is environment variables and ADR 002's own worked example is
`DATABASE_URL`.

```
^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$
```

Case-sensitive, mirroring how environment variables actually behave. The honest
cost is that `DATABASE_URL` and `database_url` are two different secrets in one
bucket, so a typo creates a silent second entry rather than an error. The
alternative, folding case, would make the stored name and the lookup key differ
and would turn a case-only rename into a silent overwrite.

## Secret values

UTF-8 strings, at most 64 KiB **after encoding**. The limit is checked on the
encoded bytes, not on the character count: Pydantic's `max_length` counts
characters, so a limit expressed that way would let a string of four-byte
characters weigh four times what the number says.

64 KiB matches AWS Secrets Manager's per-secret limit and covers every stated
use case: environment variable values, PEM private keys and certificate chains,
and service-account JSON. Binary is not accepted; a caller with a keystore
base64-encodes it themselves, which keeps the API single-typed and the crypto
boundary free of a branch.

An empty string is valid. An empty environment variable is a real thing.

The limit is enforced twice on purpose: in the request model, which is what
produces the 422 and what the OpenAPI schema advertises, and again in the
service that encrypts. A limit living only in one request model does not follow
the value if a later endpoint writes a secret by another route.

## Data model

```
secrets
  id           UUID primary key, server default
  bucket_id    UUID FK buckets.id ON DELETE CASCADE
  key_name     Text
  ciphertext   LargeBinary
  created_at   timestamptz
  updated_at   timestamptz
```

Unique on `(bucket_id, key_name)`. No key version column, per A15.

`id` uses a server default rather than being minted in Python. Unlike `Bucket`,
nothing here is wrapped under the row's own id, so the ordering constraint that
forced `default=uuid.uuid4` on buckets does not apply.

### One blob, not three columns

ADR 002 says to store nonce, ciphertext and tag alongside each secret.
`encrypt` already returns them as a single `nonce || ciphertext || tag` value
and `decrypt` expects exactly that layout, so splitting them would mean taking
apart what the cipher hands over and reassembling it on every read, with a
chance of getting the offsets wrong. One column, named `ciphertext`, documented
as holding all three. Recorded as A20 so the difference from the ADR's wording
is deliberate rather than discovered.

### The cascade never fires in normal operation

Deleting a non-empty bucket is refused, so no ordinary delete reaches the
cascade. It exists because `buckets.user_id` already cascades, so deleting a
user must not leave orphaned secret rows behind.

## The crypto path

**Write:** resolve the bucket scoped to the caller, unwrap its DEK, build the
AAD from `(bucket.id, key_name)`, encrypt the UTF-8 bytes, store the blob.

**Read:** the reverse.

The AAD binds `(bucket_id, key_name)`, so a ciphertext moved to another key in
the same bucket fails, and one moved to another bucket fails twice over: wrong
AAD and wrong DEK.

**The DEK is unwrapped per request and never cached.** A cached plaintext DEK
is a plaintext key resident in process memory for the lifetime of the process,
which is a materially worse thing to hold than the cost of an unwrap per
request, and there is no measured performance problem to trade it against.

## Endpoints

```
GET    /v1/buckets/{bucket}/secrets           key names and timestamps only
GET    /v1/buckets/{bucket}/secrets/{key}     the value
PUT    /v1/buckets/{bucket}/secrets/{key}     create or replace
DELETE /v1/buckets/{bucket}/secrets/{key}     remove
```

All require `CurrentUser`. Every one resolves the bucket through the existing
`get_bucket`, which filters on `user_id`, so another user's bucket returns 404
on all four without four repetitions of the check.

`PUT` returns 201 when it creates and 200 when it replaces. You own the bucket,
so learning whether the key existed discloses nothing you were not entitled to.

`DELETE` on an absent key returns 404, matching the bucket endpoint rather than
being silently idempotent.

The list returns key name, `created_at` and `updated_at`, and **not the value's
length**. Length is not nothing: for a password or a token it narrows the search
space. Invariant 7 says metadata only.

`GET` on a single key is the only endpoint that returns a value, which is
invariant 7's shape: the list cannot be made to reveal anything by any parameter
a browser can send.

### The reveal gate

`?reveal=true` is refused on the credential **before the bucket is looked up**,
so the refusal cannot depend on a resource the caller was never entitled to ask
about. A4 makes reveal a property of the credential, and this is that property
expressed in the request pipeline.

In SP4 it always refuses. In SP5 an API key without the scope receives the
identical response and one with it proceeds.

`?reveal=false` is accepted and does nothing, since it is the default written
out. The parameter is declared as a typed boolean rather than read loosely from
the query string, so an unparseable value like `?reveal=maybe` is a 422 rather
than a quiet falsy.

Note that Pydantic accepts `yes`, `y`, `on` and `1` as true, so `?reveal=yes`
refuses at 403 rather than validating. That is the correct outcome: the
property that matters is that no spelling of the parameter is silently
ignored.

The gate lives on the **list** endpoint only. A4 scopes reveal to bulk fetch,
and on the single-key endpoint the parameter would be meaningless, since that
endpoint's whole purpose is returning one value to a caller already entitled to
it.

### Errors

| Code | Status | Cause |
|---|---|---|
| `BUCKET_NOT_FOUND` | 404 | no such bucket, or it belongs to someone else |
| `SECRET_NOT_FOUND` | 404 | no such key in a bucket you own |
| `BUCKET_NOT_EMPTY` | 409 | delete refused; the code SP3 reserved |
| `REVEAL_NOT_PERMITTED` | 403 | `?reveal=true` without a credential carrying the scope |
| validation error | 422 | key name fails the charset rule, or the value exceeds 64 KiB encoded |

## Changes to what SP3 shipped

**`delete_endpoint` gains the emptiness guard**, replacing the comment marking
its place. The check is `SELECT EXISTS` rather than a count, since only whether
it is zero matters.

**`BucketData` gains `secret_count`**, computed in the list query as an outer
join with a grouped count rather than a query per bucket. `POST` returns zero.

This breaks one SP3 test deliberately.
`test_create_never_returns_key_material` asserts the response's key set is
exactly `{"id", "name", "created_at"}`, and that assertion is what stops a field
reaching a bucket response by accident. It must be updated to the new exact set
rather than loosened, or it stops doing its job.

## Auditing

Four actions, and `key_name` on `audit_log` finally carries something:
`secret.created`, `secret.updated`, `secret.read`, `secret.deleted`.

### Auditing reads makes GET a write

Three consequences, stated rather than discovered:

- The endpoint is no longer safe in the HTTP sense. It must never sit behind a
  cache or a retry that assumes otherwise.
- Every read costs a row.
- Following SP3's rule that an action commits with its audit entry, **a read
  whose audit write fails is refused.** A broken audit table becomes a read
  outage.

That last one is the uncomfortable trade and it is deliberate. A secret manager
that silently serves unlogged reads has lost the thing the log exists for. A
refusal is visible; a missing row is not.

### A refused reveal is not audited in SP4

It is architecturally impossible to succeed, so an entry would record only that
the gate works. It becomes worth auditing in SP5, when the same refusal starts
discriminating between credentials.

## Failure handling

The decrypt-failure path is where SP3's deferred log line lands. This is the
application's first logger outside the error handler.

Two distinct causes reach it. The caller cannot tell them apart and should not;
the operator must:

- `UnknownKekVersion` means the deployment dropped a KEK that rows still name.
  Recoverable by restoring it to `SECRETS_KEKS`, and the log says so.
- `InvalidTag` means the row does not authenticate: tampering, or the wrong
  DEK. Not recoverable, and it is an incident.

Both return 500 with `INTERNAL_ERROR_MESSAGE`. The distinction exists only in
the log, which carries the bucket id, the key name, and which failure it was.
Never the ciphertext, never the DEK, never a value. Per invariant 1 the fields
are named explicitly rather than dumped.

## Testing

Real Postgres via testcontainers. Hypothesis for the round trip.

- Round trip through HTTP returns exactly what was sent, including unicode, the
  empty string, and exactly 64 KiB
- 64 KiB plus one byte is rejected, and **the check is on encoded bytes**: a
  multi-byte string under 64K characters but over 64 KiB is still refused
- **Relocation within a bucket**: swap two secrets' `ciphertext` columns in the
  database, and both reads fail
- **Relocation across buckets**: same, and it fails for two reasons at once
- Another user's bucket returns 404 on all four endpoints
- The list's exact key set, proving no value and no length reach it
- `?reveal=true` is refused **even for a bucket that does not exist**, which is
  what proves the ordering
- `?reveal=maybe` is a 422, and `?reveal=yes` is a 403 rather than a quiet
  falsy, since Pydantic parses it as true
- The emptiness guard refuses; deleting the secrets then the bucket succeeds
- Each of the four audit actions is written with the right `key_name`
- A failed audit write denies the read
- A corrupted row produces a 500 whose body carries no detail, while the log
  carries the bucket id and key name and not the value

## Acceptance criteria

1. A value written through `PUT` and read through `GET` returns byte-identical,
   including unicode and the empty string.
2. A value of exactly 64 KiB encoded is accepted; 64 KiB plus one byte is
   rejected at 422, measured on encoded bytes.
3. Key names outside `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` are rejected.
4. A ciphertext moved to another key in the same bucket fails to decrypt.
5. A ciphertext moved to another bucket fails to decrypt.
6. The list returns key names and timestamps and never a value or its length.
7. `?reveal=true` returns 403 `REVEAL_NOT_PERMITTED`, including for a bucket
   that does not exist.
8. `?reveal=maybe` returns 422, and `?reveal=yes` returns 403, since Pydantic
   parses it as true. No spelling of the parameter is silently ignored.
9. Deleting a non-empty bucket returns 409 `BUCKET_NOT_EMPTY`; deleting its
   secrets first then succeeds.
10. Another user's bucket returns 404 on all four secret endpoints.
11. Reading, creating, updating and deleting each write one audit entry with
    the right action and `key_name`.
12. A read whose audit write fails returns an error and no value.
13. A corrupted ciphertext returns 500 with no detail in the body, and the log
    line names the bucket and key but no value.
14. The bucket list carries `secret_count`.
15. `make lint` and `make test` pass, and the regenerated
    `web/src/api/generated.ts` is committed so `types-drift` is clean.
16. No new dependency.

## ADR 002 amendments this spec requires

**A20. A secret row stores one authenticated blob.** The encryption design says
to store nonce, ciphertext and tag alongside each secret. `encrypt` returns them
as one `nonce || ciphertext || tag` value and `decrypt` expects that layout, so
storing them separately would mean disassembling and reassembling the cipher's
own output on every operation. Amended: a single `ciphertext` column holds all
three, documented as such.

**A21. Reads are audited, and an unauditable read fails.** The audit table is
listed under the API surface without saying which operations produce entries.
Amended: reads produce entries alongside writes and deletes, because "who read
this secret and when" is the question the log most exists to answer, and a
leaked credential's activity leaving no record is the first gap felt after an
incident. The entry shares the read's transaction, so a read that cannot be
audited is refused rather than silently served.

**A22. Key names deliberately do not follow A16.** A16 fixed bucket names as
lowercase only. Key names are `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` and
case-sensitive, because the use case is environment variables and this ADR's own
example is `DATABASE_URL`. The asymmetry is intentional; someone reading A16
should not assume it generalises.

## Risks

**Auditing reads couples read availability to the audit table.** Nothing else
in the system has that property. It is the deliberate trade above, but if reads
ever start failing for no visible reason, this is the first place to look.

**The 64 KiB limit is enforced in one place.** If a future endpoint writes a
secret without going through the same request model, the limit does not follow
it. The check belongs in the service rather than only in the Pydantic model for
that reason.

**Nothing exercises the reveal gate end to end until SP5**, because no
credential can pass it. The tests prove it refuses; they cannot prove it admits
the right caller.

## Deferred

To SP5: API keys, the prefix replacing `sk_live_`, the `api_key_id` foreign
key, granting the reveal scope, auditing denied reveals, and bulk fetch
returning values.

To SP6: the bucket and secret UI, where Zustand, Zod and React Hook Form arrive
with real consumers.

Later: rate limiting, security headers, the README threat model, and the KEK
rotation CLI with its runbook.

To v2: workspaces and secret versioning, as A5 ruled.
