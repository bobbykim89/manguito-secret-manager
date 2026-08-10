# SP5: API keys, design

Date: 2026-08-10
Status: Approved, ready for planning
Depends on: SP4 (merged), ADR 002 as amended

## Purpose

Give a machine a way in. Everything so far authenticates a browser: a Google
login, a session cookie, and endpoints that only a person clicking things can
reach. A CI pipeline pulling `DATABASE_URL` at boot has no passphrase to
present and no browser to redirect, which is the entire reason ADR 002's threat
model rejects a zero-knowledge design.

SP5 issues credentials for that caller, scopes them, and makes SP4's bulk
reveal gate finally able to admit one.

Backend only, though the generated OpenAPI types change.

## Scope

### In scope

- The `api_keys` table and its `api_key_buckets` join table
- Issuing, listing and revoking keys, from a session
- Verifying a key on the four secret endpoints
- Scope enforcement: which buckets, write, and reveal
- Bulk reveal actually returning values
- The `reveal.denied` audit entry SP4 deferred here
- `audit_log.api_key_id`, unwritten since SP3, gaining its foreign key

### Explicitly out of scope

- **Any frontend.** `web/src/api/generated.ts` is regenerated and committed
  because the schema changed, but nothing consumes the new types until SP6.
- **Rate limiting.** A7 already defers it past this point, and it needs shared
  storage that does not exist.
- Security headers and the README threat model.
- Workspaces and secret versioning, ruled out for v1 by A5.

## The key

```
msm_a3f9c2d1_9tHkPq...
└┬─┘ └───┬──┘ └──┬───┘
 │       │       └─ 32 random bytes, base64url, 43 characters
 │       └───────── 8 character lookup id, unique and indexed
 └───────────────── project prefix
```

A6 rejected `sk_live_` because it collides with Stripe's convention and implies
an `sk_test_` variant that will never exist, and A8 moved the replacement here.
The prefix is `msm_`, matching the `msm_session` and `msm_oauth` cookies this
project already sets.

The lookup id exists so verification is one indexed query rather than a scan
that hashes every candidate. It is not secret and carries no entropy claim. The
32 random bytes are the credential.

### Storage and comparison

**SHA-256 of the whole token, never bcrypt or Argon2.** Invariant 6 is
explicit, and the reasoning bears restating because it looks backwards at a
glance: slow hashing exists to defend low-entropy human passwords against
offline cracking. A 256 bit random token has no brute force surface to defend,
and this hash runs on every API request, so a deliberately slow KDF would be
pure latency on the hot path.

Hashing the whole token rather than only its secret segment binds the id to the
secret, so a token pairing one key's id with another key's secret cannot
verify.

The comparison uses `compare_digest` on **encoded bytes**. SP2 shipped a bug
where `compare_digest` on a `str` containing non-ASCII raised `TypeError`,
which escaped the failure path entirely and returned a 500 with a live
credential still set. The same mistake is available here through a header
instead of a query parameter, so both sides are encoded before comparison.

## Data model

```
api_keys
  id            UUID primary key, server default
  user_id       UUID FK users.id ON DELETE CASCADE
  lookup_id     Text, unique, the 8 character segment
  token_hash    BYTEA, SHA-256 of the whole token
  name          Text, a label for the dashboard
  can_write     bool, not null
  can_reveal    bool, not null
  expires_at    timestamptz, nullable
  revoked_at    timestamptz, nullable
  last_used_at  timestamptz, nullable
  created_at    timestamptz

api_key_buckets
  api_key_id    UUID FK api_keys.id ON DELETE CASCADE
  bucket_id     UUID FK buckets.id ON DELETE CASCADE
  primary key (api_key_id, bucket_id)
```

A join table rather than an array column, so an orphaned scope is the
database's problem rather than application code remembering to prune.

`name` is a display label, 1 to 64 characters, not unique, and deliberately
unrestricted in charset, because it never enters a URL, a query string or a
lookup: ADR 002 addresses keys by id. It exists because a list of eight
character ids tells you nothing about which one your deploy pipeline holds.

`expires_at` is nullable by design. ADR 002 argues that forcing rotation on a
pipeline which only needs a database URL is hostile to the actual use case, and
these keys are individually revocable with one update.

`ApiKey.__repr__` omits `token_hash`, for the same reason `Bucket.__repr__`
omits its wrapped key: a log line is a different trust boundary from the
database.

**`audit_log.api_key_id` gains its foreign key here.** It has been nullable and
unwritten since SP3.

### Deleting a bucket prunes the scope and keeps the key

`ON DELETE CASCADE` on `api_key_buckets.bucket_id` removes exactly the rows
naming the deleted bucket. A key scoped to three buckets keeps working on the
other two.

A key scoped only to the deleted bucket still authenticates and can reach
nothing, so every request is a 404. That is odd but harmless, and it keeps
deleting a bucket a decision about the bucket rather than about every
credential that ever mentioned it. Revoking such a key automatically would mean
a delete silently destroying a credential as a side effect.

## Authenticating a caller

### Two dependencies, deliberately not one

`CurrentUser` is unchanged and still reads only the session cookie. It keeps
serving `/v1/auth/me`, the bucket endpoints, and the key management endpoints
this sub-project adds.

`CurrentCaller` is new, accepts either credential, and serves only the four
secret endpoints.

That is what makes the authority boundary structural. A bearer token presented
to `POST /v1/buckets` is not rejected by a check someone could later forget to
write: it is never read, because that endpoint's dependency does not look at
the header.

### The Caller

```python
caller.user            # who, for ownership and for the audit row
caller.api_key         # the key, or None for a session
caller.may_access(bucket)
caller.may_write()
caller.may_reveal()
```

A session answers yes to access on any bucket it owns, yes to write, and
**always no to reveal**. ADR 003 requires that a browser can never reach bulk
reveal regardless of the user's own rights. Putting that in the caller rather
than in the endpoint means a future endpoint cannot bypass it by forgetting.

### Verification

Parse the three segments, look up by `lookup_id`, `compare_digest` the SHA-256
of the whole presented token against the stored hash, then check `revoked_at`
and `expires_at`.

**Every failure returns the same 401 `UNAUTHENTICATED` with the same body.** A
malformed token, an unknown lookup id, a valid id with the wrong secret, a
revoked key and an expired key are indistinguishable from outside. A holder who
needs to know why looks at the dashboard, which is authenticated as the owner.

**If an `Authorization` header is present, it decides.** A failure there is a
401 with no fallback to the cookie. Falling back would not be a privilege
escalation, since the cookie user is who they are, but it would silently serve
a CI script whose key expired three weeks ago, and that failure should be loud.

### `last_used_at`

Written and committed in the dependency, in its own transaction, before the
endpoint runs. A request that authenticates and then 404s still records that
the credential was presented, which is exactly what matters when reviewing a
suspected leak.

## Authorizing a request

| Condition | Response |
|---|---|
| No credential, or any verification failure | 401 `UNAUTHENTICATED` |
| Bucket not owned by the caller's user | 404 `BUCKET_NOT_FOUND` |
| Bucket owned but outside the key's scope | 404 `BUCKET_NOT_FOUND` |
| Write without `can_write` | 403 `WRITE_NOT_PERMITTED` |
| `?reveal=true` without `can_reveal`, or from a session | 403 `REVEAL_NOT_PERMITTED` |

**A bucket outside a key's scope returns 404, not 403.** This trades
debuggability for disclosure, deliberately. A leaked key probing bucket names
learns nothing, which is the entire point of scoping it. The cost is that a
mis-scoped key looks like a missing bucket, mitigated because the key's scopes
are visible in the dashboard that issued it.

A denied write is 403 rather than 404, because by then the caller has already
proved it may see the bucket, so refusing tells them nothing new.

### The reveal gate flips

SP4 refused before any credential was inspected, which was correct while
nothing could ever pass. The gate now has to know who is asking, so it resolves
the caller first, and an unauthenticated `?reveal=true` becomes 401 rather than
403. SP4 shipped a test pinning the old behaviour with a docstring saying it
changes here.

## Endpoints

```
GET    /v1/keys        metadata for every key, including revoked ones
POST   /v1/keys        create; the only moment the token exists
DELETE /v1/keys/{id}   revoke
```

All three require `CurrentUser`, so a key cannot mint or revoke a key.

**Create** takes a name, at least one bucket name, `can_write`, `can_reveal`,
and an optional `expires_at`. An empty bucket list is a 422, since a key that
can reach nothing has no reason to exist. It resolves the names to ids and
rejects a name that is not yours with the same 404 a bucket lookup gives. An
`expires_at` already in the past is a 422 rather than a key that is born dead.
The response carries the full token once. Nothing else ever returns it.

**List** returns, per key: `id`, `lookup_id`, `name`, the bucket names it is
scoped to, `can_write`, `can_reveal`, `expires_at`, `revoked_at`,
`last_used_at` and `created_at`. Revoked keys are included, since a revoked key
is exactly what you want to see when reconstructing what happened. The
`lookup_id` is there because it is the only part of a token a holder can read
off a config file and match against this list. It never returns `token_hash`
and never returns a token.

**Revoke** sets `revoked_at`. Revoking an already-revoked key succeeds without
moving the timestamp, so the original revocation time survives. Another user's
key returns 404, the same answer an unowned bucket gives.

### Bulk reveal returns a mapping

`GET /v1/buckets/{bucket}/secrets?reveal=true` with a reveal-scoped key returns

```json
{ "ok": true, "data": { "DATABASE_URL": "postgres://...", "STRIPE_KEY": "..." } }
```

rather than the list of metadata objects the unrevealed call returns.

Two reasons. It is the shape the consumer wants, since a CI script feeds it
straight into an environment rather than walking a list discarding timestamps.
And it makes the endpoint's two response shapes trivially distinguishable in
the schema, where the alternative, one model with an optional `value`, would
have the unrevealed path return `value: null` on every row, which a client can
misread as an empty secret.

A4 fixes the URL, not the body, so this needs no amendment.

## Auditing

New actions: `apikey.created`, `apikey.revoked`, and `reveal.denied`.

**`reveal.denied` is the entry SP4 deferred.** It was worth nothing there,
where refusal was architecturally guaranteed and an entry would have recorded
only that the gate worked. It is worth a lot here, where it records a
credential that asked for bulk reveal and was refused.

**A successful reveal writes one `secret.read` per key returned.** Pulling
twenty secrets writes twenty rows, each carrying `api_key_id`. That is the
event most worth being able to reconstruct after a leak, and one row saying
"a reveal happened" would not support that.

Every secret operation performed with a key now carries `api_key_id`, which is
what makes the log able to answer which credential did something rather than
only which person.

## Testing

Real Postgres via testcontainers.

**Indistinguishable failures.** An unknown lookup id, a valid id with the wrong
secret, a revoked key, an expired key, a malformed token and a missing token
all return the identical 401 body. Asserted as equality against one constant,
not as five separate status checks.

**Non-ASCII in the header returns 401, not 500.** This is SP2's `compare_digest`
bug reachable through a different door, and it is the test that would catch it.

**The authorization matrix**: in-scope read succeeds; out-of-scope bucket is
404; write without `can_write` is 403; reveal without `can_reveal` is 403;
reveal with it returns values; a session with `?reveal=true` is 403 even for
the bucket's owner.

**The boundary**: a key presented to a bucket endpoint or to `/v1/keys` is 401.

**Lifecycle**: `last_used_at` moves even when the request then 404s; deleting a
bucket prunes one scope row and leaves the key working elsewhere; revoking
twice keeps the first timestamp.

**Disclosure**: the token appears exactly once, in the creation response;
neither the list nor any other endpoint contains it or `token_hash`; `repr` of
a key omits the hash.

**Auditing**: a reveal of three secrets writes three `secret.read` rows all
carrying `api_key_id`; a denied reveal writes one `reveal.denied`; creating and
revoking write their own actions.

## Acceptance criteria

1. A created key is returned exactly once and never again by any endpoint.
2. A valid key reads a secret in a bucket it is scoped to.
3. A bucket the key is not scoped to returns 404, not 403.
4. A write without `can_write` returns 403 `WRITE_NOT_PERMITTED`.
5. `?reveal=true` with `can_reveal` returns a mapping of key name to value.
6. `?reveal=true` without `can_reveal` returns 403 and writes `reveal.denied`.
7. A session with `?reveal=true` returns 403 even for its own bucket.
8. An unauthenticated `?reveal=true` returns 401, not 403.
9. Unknown, wrong-secret, revoked, expired, malformed and missing tokens all
   return the identical 401 body.
10. A non-ASCII `Authorization` header returns 401, never 500.
11. A key presented to a bucket endpoint or to `/v1/keys` returns 401.
12. `last_used_at` is updated even when the request then fails.
13. Deleting a bucket prunes that scope row and leaves the key working on its
    other buckets.
14. Revoking an already-revoked key succeeds without moving `revoked_at`.
15. A reveal of N secrets writes N `secret.read` entries, each with
    `api_key_id`.
16. `make lint` and `make test` pass, and the regenerated
    `web/src/api/generated.ts` is committed so `types-drift` is clean.
17. No new dependency.

## ADR 002 amendments this spec requires

**A24. The prefix is `msm_`, and the format is fixed.** A6 rejected `sk_live_`
and A8 moved the replacement to this sub-project. Keys are
`msm_<8 char lookup id>_<43 char base64url secret>`. The lookup id is unique and
indexed so verification is one query; the secret is 32 random bytes. The stored
hash is SHA-256 of the whole token, not of the secret segment alone, so a token
pairing one key's id with another's secret cannot verify.

**A25. API keys reach the secret endpoints only.** Buckets and key management
require a session. Two operations in this system are unrecoverable: deleting a
bucket destroys its data key, which is shredding with no undo, and issuing a
key creates a credential outliving the one that made it. A leaked key can reach
neither. This is enforced structurally, by the bucket and key endpoints
depending on a session-only resolver that never reads the `Authorization`
header, rather than by a check that could be omitted from a future endpoint.

**A26. A bucket outside a key's scope returns 404.** The same answer an
unowned bucket gives, so a leaked key probing names learns nothing. A denied
write is 403, because the caller has by then already proved it may see the
bucket. The debugging cost is accepted: a mis-scoped key looks like a missing
bucket, and the dashboard that issued it shows the scopes.

## Risks

**The 404 for an out-of-scope bucket will be reported as a bug.** It is the
correct behaviour and it will still look wrong to whoever is wiring up a
pipeline at the time. The message should be identical to the unowned case, so
there is nothing to infer from the difference, and the docs should say plainly
that a 404 can mean "not in this key's scope".

**Nothing rate limits key verification.** A7 defers rate limiting past this
point for lack of shared storage. A 32 byte random secret has no meaningful
brute force surface, so this is an availability concern rather than a
confidentiality one, but it is the first thing to add when A7 is addressed.

**Bulk reveal is the largest disclosure this API can perform.** One request can
return every secret in a bucket. That is the point, and it is why it needs an
explicit scope, why it is unreachable from a browser, and why it writes a row
per secret rather than one row per call.

## Deferred

To SP6: the UI for issuing, listing and revoking keys, including the show-once
treatment of a new token.

Later: rate limiting, security headers, the README threat model, and the KEK
rotation CLI with its runbook.

To v2: workspaces and secret versioning, as A5 ruled.
