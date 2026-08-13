# The KEK rotation CLI, design

Date: 2026-08-12
Status: Approved, ready for planning
Depends on: security headers (merged), ADR 002 as amended

## Purpose

`SECRETS_KEKS` is already versioned. `KeyProvider` already unwraps under
whichever version a bucket names and wraps only under the current one, so
old and new keys already coexist correctly. Nothing exists that actually
performs a rotation: reading every bucket, unwrapping its DEK under the
retired KEK, and rewrapping it under the new one.

ADR 002's test plan already states the property this must hold: "KEK
rotation: secrets remain readable after KEK change and DEK rewrap." Nothing
has ever tested it, because nothing exists to test.

This is the last of four post-v1 hardening pieces. The README and threat
model, and security headers, both shipped first; per-key rate limiting
remains separately, with its own open design question about shared storage.

Backend only. No frontend changes, no schema changes, no new dependency.

## Where this sits

| Piece | Touches | Status |
|---|---|---|
| The README and the threat model | docs only | merged |
| Security headers | `main.py`, one module, `envelope.py` | merged |
| Per-key rate limiting | middleware, storage, config | not started, needs design |
| **The KEK rotation CLI** | `api/scripts/`, crypto | this spec |

## Scope

### In scope

- `api/scripts/rotate_kek.py`, run by hand against `DATABASE_URL`
- `--dry-run`, reporting what would rotate without touching a row
- A completion summary naming when it is safe to retire the old KEK
- The property test ADR 002's test plan already names

### Explicitly out of scope

Each with a reason, rather than by omission:

- **Scheduling.** A KEK has no shelf life the way a TLS certificate does;
  nothing forces rotation on a calendar. It is rotated for one of two
  reasons: a suspected compromise, which needs a human deciding right now
  rather than waiting for a cron window, or routine hygiene, rare enough at
  this project's scale that automating it buys little. The new KEK also has
  to already be in `SECRETS_KEKS` and deployed before rotation can run at
  all, which is itself a manual step a schedule cannot remove.
- **Running against Fly directly**, via `fly ssh console` or an admin API
  endpoint. Neon is reachable from anywhere with the connection string, the
  same way `make migrate` already reaches it from a laptop. `fly ssh` needs
  a machine actually running, which `min_machines_running = 0` does not
  guarantee, and needs SSH access configured on the app, which does not
  exist. An admin endpoint is a new auth tier, new attack surface, and a
  request that could time out mid-rotation over HTTP, for a command run by
  hand a handful of times a year.
- **Removing the retired KEK from `SECRETS_KEKS` automatically.** That is a
  Fly secrets edit and a redeploy, outside anything a script running against
  Postgres can reach.
- **DEK rotation.** ADR 002 A15 records that `kek_version` lives on the
  bucket rather than the secret specifically because DEK rotation is a
  different operation needing its own amendment and its own column. Nothing
  here touches that boundary.
- **A resumable batch size or progress bar for very large bucket counts.**
  This is a solo project's scale. The per-bucket loop described below is
  already the right shape if that ever stops being true.
- **Per-key rate limiting.** The other remaining piece, sharing nothing with
  this one beyond both eventually needing production access.

## Trigger and execution

Manual only, run the way `api/scripts/dump_openapi.py` already establishes
the pattern for: `uv run python scripts/rotate_kek.py`, invoked by an
operator, never scheduled.

It connects to `DATABASE_URL` from `.env`, the same trust boundary
`make migrate` already uses from a laptop against Neon.

**The precondition lives entirely in configuration this script never
writes.** Before running it, the operator generates a new KEK, adds it to
`SECRETS_KEKS` as a new `version:base64` entry alongside the retired one, and
points `SECRETS_KEK_VERSION` at the new version. "Target version" is never a
separate CLI argument: it is `KeyProvider.current_version`, the identical
concept `wrap()` already uses when creating a bucket, so there is no second
notion of "current" for the two to drift apart on.

The Fly redeploy that makes the new KEK live, and the later one that drops
the retired key once rotation is confirmed complete, are both manual steps
outside this script's reach. It only ever touches Postgres.

## The rotation loop

Rotation crosses every user's buckets, but the only existing row-lock
helper, `get_bucket_for_update`, is deliberately scoped to one user's bucket
by name. It exists to serialise a bucket delete against a concurrent
secret write within one request, and takes a `User` for exactly that reason.
It is the wrong tool here and is not reused. Rotation locks by primary key
instead, which needs no user in scope at all:

```python
for bucket_id in bucket_ids_needing_rotation:
    row = session.scalars(
        select(Bucket).where(Bucket.id == bucket_id).with_for_update()
    ).one_or_none()
    if row is None or row.kek_version == target_version:
        continue  # deleted, or rotated since the list was built
    dek = provider.unwrap(row.wrapped_dek, row.kek_version, wrap_aad(row.id))
    row.wrapped_dek = provider.wrap(dek, wrap_aad(row.id))
    row.kek_version = target_version
    session.commit()
```

`wrap_aad` already exists and is reused as-is: it binds to `bucket.id`,
which never changes, so rewrapping touches neither the AAD nor anything a
secret row holds. The `bucket_ids_needing_rotation` list itself is a plain
`select(Bucket.id).where(Bucket.kek_version != target_version)` across all
users, since rotation is an operator action against the whole deployment,
not scoped to any one account.

### A crash mid-run is not a broken state

It leaves buckets split across two KEK versions, which is exactly the
coexistence `KeyProvider` already serves: a row still naming the retired
version still unwraps correctly, because `SECRETS_KEKS` still lists that key
until the operator removes it. Rerunning the script re-queries for buckets
not yet on the target version, so it resumes exactly where it stopped. No
state file, no `--resume` flag, no flag day.

### A per-bucket failure aborts the run

If `unwrap` raises `UnknownKekVersion` or `InvalidTag`, the run stops rather
than skipping that bucket and continuing. A crypto failure here is far more
likely a misconfiguration affecting every remaining bucket the same way (a
retired key removed too early, a copy-paste error in `SECRETS_KEKS`) than a
one-off bad row, and this matches the fail-closed pattern already
established elsewhere: `Settings` crashes at import on a bad KEK rather than
deferring the failure to the first request that needs it, and ADR 002 A21
refuses an unauditable read rather than serving it silently. Aborting costs
nothing specific to this design, because the per-bucket-commit shape already
made partial progress durable: fix the underlying problem and rerun.

### `--dry-run`

Runs the identical query, skips the loop body, and prints what would happen.
The one meaningful branch in the whole script; everything else is a
straight query and rewrap.

## Reporting

No database audit row. `AuditEntry.user_id` is a `NOT NULL` foreign key to a
real `User` row, and the audit log's whole design, per ADR 002 A17 and A21,
is tracking who accessed a secret's *value*, tied to a real actor. Rotation
never touches or reveals a secret's plaintext, and there is no signed-in
user behind a CLI invocation to attribute it to. Making the FK nullable or
inventing a synthetic system user would be schema surgery, on a
security-relevant table, for an event that table was not designed to hold.

The completion summary printed to the terminal the operator is watching is
the record instead:

```
Rotated 4,812 buckets to version 2.
0 buckets remain on version 1.
Safe to remove version 1 from SECRETS_KEKS.
```

`--dry-run` prints the "would rotate" form of the same counts without
touching a row.

## Implementation

The rotation logic lives in an importable function, not only inside
`main()`:

```python
def run_rotation(session: Session, provider: KeyProvider, *, dry_run: bool) -> RotationResult
```

`main()` wraps it: parses `--dry-run`, builds a real DB session against
`DATABASE_URL`, builds a `KeyProvider` from `Settings`, calls
`run_rotation`, prints the summary.

This is a deliberate departure from `dump_openapi.py`'s shape.
`dump_openapi.py` avoids the database entirely, on purpose, and its test
shells out to a subprocess with `DATABASE_URL` stripped, to prove exactly
that independence. This script's entire purpose is the database, so its
test calls `run_rotation` directly against the `db_session` fixture, the
same way router logic is tested, rather than through a subprocess.

## Testing

Real Postgres via testcontainers, this project's standing convention, not a
mock.

**The property ADR 002's test plan names.** Create a bucket and a secret
under KEK version 1. Rotate to version 2. Read the secret back through the
normal API, not by inspecting the row, and assert the value is unchanged.
This proves the rewrap is transparent through the whole encryption tier, not
merely that a DEK round-trips in isolation.

**Idempotency.** Running rotation twice rotates nothing the second time, and
the second run's summary reports zero rotated.

**Resume.** Rotate half the buckets, interrupt, rerun, confirm the rest
completes and nothing already on the target version is touched twice.

**`--dry-run` touches zero rows.** Assert no `wrapped_dek` or `kek_version`
changes on any bucket after a dry run, and that the reported count matches
what a real run would have rotated.

**A bucket already on the target version is skipped and counted
separately** from one actually rotated, so the summary's numbers mean what
they say.

**A misconfigured KEK aborts rather than skipping.** Remove the version a
row names from the configured `SECRETS_KEKS` mid-fixture and confirm the run
raises rather than silently continuing past that bucket.

## Acceptance criteria

1. `rotate_kek.py` is run manually; nothing schedules it.
2. It connects to `DATABASE_URL` from the environment, the same as
   `make migrate`.
3. The target version is `KeyProvider.current_version`, never a separate
   argument.
4. Each bucket rotates inside its own transaction, locked by primary key
   (not `get_bucket_for_update`, which is scoped to one user).
5. A bucket already on the target version is skipped, not re-rewrapped.
6. Rerunning after an interruption resumes rather than restarting.
7. An unwrap failure aborts the run rather than skipping that bucket.
8. `--dry-run` performs the identical selection and touches no row.
9. A completion summary states buckets rotated, buckets remaining on old
   versions, and whether it is safe to remove the retired key.
10. No row is written to `audit_log` for rotation.
11. A secret written before rotation reads back unchanged through the
    normal API after rotation, proven by a test.
12. No new dependency, no schema change, no frontend change.
13. `make lint` and `make test` pass, and `make types` produces no diff,
    since no Pydantic response model changes.

## ADR amendments this spec requires

None. `KeyProvider`'s multi-version support and `kek_version`'s placement on
the bucket (ADR 002 A15) already anticipated rotation; this spec builds the
operation the design already made room for, without changing the design
itself.

## Risks

**A KEK never in production means the gating path is only exercised in
tests.** Nothing is deployed yet, so this script has never run against real
data. The property test is what stands in for that until the first real
rotation, the same limitation the security headers piece recorded for its
own environment-gated behaviour.

**Aborting on the first failure means one bad row can block the whole
run.** If the abort-on-failure judgment call is wrong, one corrupted bucket
stops every other bucket from rotating even when they are fine. Accepted for
now on the reasoning that a crypto failure here is more likely systemic than
isolated; revisit if a real rotation ever produces a genuinely isolated bad
row.

**The completion summary is the only record, and it lives only in whatever
terminal ran the command.** If the operator does not save that output, there
is no second place to confirm rotation finished cleanly short of a manual
`SELECT DISTINCT kek_version FROM buckets` query. Acceptable, since that
query is one line and this project has no log aggregation to write to
regardless.

## Deferred

To per-key rate limiting, the other remaining piece.

Not code, and outstanding: branch protection on `main`, the domain purchase
that unblocks the Fly deploy, the GitGuardian false positive on
`POSTGRES_PASSWORD: manguito`, setting `SECRETS_KEKS` and
`SECRETS_KEK_VERSION` as real Fly secrets, and `docs_url=None` in production
(named as a follow-up by the security headers piece).
