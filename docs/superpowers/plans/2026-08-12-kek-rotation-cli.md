# The KEK rotation CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manually-run script that rewraps every bucket's DEK under a new KEK version, resumable after any interruption, provably transparent to the secrets underneath it.

**Architecture:** The rotation logic lives in one importable function, `run_rotation`, tested directly against a real Postgres session the same way router logic is tested. A thin `main()` wraps it for CLI args and real database setup, the way `dump_openapi.py` wraps its own logic. Each bucket rotates in its own transaction using a primary-key row lock built for this task, not the existing `get_bucket_for_update`, which is scoped to one user and cannot see across accounts.

**Tech Stack:** Python 3.12, SQLAlchemy 2.x, pytest with testcontainers (real Postgres).

## Global Constraints

- Backend only. Nothing under `web/` changes.
- No new dependency.
- No schema change, no Alembic migration.
- Python 3.12+, type hints everywhere, mypy strict clean over `app scripts alembic tests`.
- ruff with `select = ["E","F","I","N","UP","B","SIM"]`, line length 100.
- Tests use a real Postgres via testcontainers, not SQLite.
- **`get_bucket_for_update` is not reused.** It filters by `user_id` (`api/app/buckets.py`) and exists to serialize a bucket delete against a concurrent secret write within one request. Rotation crosses every user's buckets and needs a lock with no user in scope. Locking is done directly in `rotate_kek.py`, by primary key.
- **No new row in `audit_log`.** `AuditEntry.user_id` is `NOT NULL`, and there is no signed-in user behind a CLI invocation. The completion summary printed to stdout is the record.
- **The target version is always `KeyProvider.current_version`.** Never a separate CLI argument.
- **A per-bucket unwrap failure aborts the whole run.** It does not skip that bucket and continue.
- No em dashes in code, comments, or commit messages.
- Comments explain why, not what.
- Commit messages: conventional commits, imperative mood, scoped (`feat(api): ...`, `test(api): ...`).

---

## File Structure

```
api/
├── app/
│   └── kek_rotation.py       new: run_rotation, RotationResult, the query and the loop
├── scripts/
│   └── rotate_kek.py         new: CLI entry point, wraps run_rotation
└── tests/
    └── test_kek_rotation.py  new
```

The rotation logic lives under `app/`, not only in `scripts/`, so it is importable
by tests the same way `app/buckets.py` and `app/secrets_service.py` are.
`scripts/rotate_kek.py` stays a thin wrapper, mirroring how `dump_openapi.py`
imports `app.main.app` rather than embedding FastAPI setup in the script
itself.

---

### Task 1: The rotation function and its result type

**Files:**
- Create: `api/app/kek_rotation.py`
- Test: `api/tests/test_kek_rotation.py`

**Interfaces:**
- Consumes: `KeyProvider`, `wrap_aad` from `app.crypto.keys` (`api/app/crypto/keys.py`, already exists); `Bucket` from `app.models` (already exists); `UnknownKekVersion` from `app.crypto.keys`; `InvalidTag` from `cryptography.exceptions`.
- Produces:
  - `@dataclass(frozen=True) class RotationResult: rotated: int; already_current: int`
  - `def run_rotation(session: Session, provider: KeyProvider, *, dry_run: bool) -> RotationResult`

This is the whole rotation loop, with no CLI, no `main()`, no real database
connection setup. `run_rotation` takes a `Session` a test can hand it directly,
which is what makes Task 1 testable without any script-level machinery.

`run_rotation` reads `provider.current_version` itself; the caller never
passes a target version, matching the spec's rule that there is only one
notion of "current."

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_kek_rotation.py`:

```python
import base64
import os
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.crypto.keys import EnvKeyProvider, build_key_provider, wrap_aad
from app.kek_rotation import RotationResult, run_rotation
from app.models import Bucket, User


def two_version_settings() -> Settings:
    """A Settings carrying both an old and a new KEK, version 1 and 2.

    Every field is passed explicitly and the dotenv source is disabled, the
    same reasoning test_auth_cookies.py's settings_for() gives: reading
    ../.env would let a developer's local file silently change which KEKs
    this test exercises.
    """
    old_kek = base64.b64encode(bytes(range(32))).decode()
    new_kek = base64.b64encode(bytes(range(1, 33))).decode()
    return Settings(
        _env_file=None,
        database_url="postgresql+psycopg://u:p@localhost:5433/db",
        cors_origins="",
        environment="test",
        google_client_id="id",
        google_client_secret="secret",
        google_redirect_uri="http://testserver/cb",
        app_url="http://testserver",
        session_cookie_domain="",
        secrets_keks=f"1:{old_kek},2:{new_kek}",
        secrets_kek_version=2,
    )


def make_bucket(session: Session, provider: EnvKeyProvider, user: User, name: str) -> Bucket:
    """A bucket wrapped under whichever version provider.current_version names.

    Mirrors create_bucket in app/buckets.py, without the audit and commit
    concerns that function has: this test file wants a bucket already on
    disk, not the create endpoint's side effects.
    """
    from app.crypto.keys import generate_dek

    bucket_id = uuid.uuid4()
    bucket = Bucket(
        id=bucket_id,
        user_id=user.id,
        name=name,
        wrapped_dek=provider.wrap(generate_dek(), wrap_aad(bucket_id)),
        kek_version=provider.current_version,
    )
    session.add(bucket)
    session.flush()
    return bucket


def a_user(session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    return user


def test_rotates_a_bucket_on_the_old_version(db_session: Session) -> None:
    settings = two_version_settings()
    provider = build_key_provider(settings)
    # Wrapped under version 1 specifically, not whatever is current, so the
    # rotation actually has something to do.
    old_provider = EnvKeyProvider(provider._keks, current_version=1)  # type: ignore[attr-defined]
    user = a_user(db_session, "rotate-basic")
    bucket = make_bucket(db_session, old_provider, user, "rotate-basic")
    db_session.commit()

    result = run_rotation(db_session, provider, dry_run=False)

    assert result == RotationResult(rotated=1, already_current=0)
    db_session.refresh(bucket)
    assert bucket.kek_version == 2


def test_skips_a_bucket_already_on_the_current_version(db_session: Session) -> None:
    settings = two_version_settings()
    provider = build_key_provider(settings)
    user = a_user(db_session, "rotate-current")
    make_bucket(db_session, provider, user, "rotate-current")
    db_session.commit()

    result = run_rotation(db_session, provider, dry_run=False)

    assert result == RotationResult(rotated=0, already_current=1)


def test_dry_run_touches_no_row(db_session: Session) -> None:
    settings = two_version_settings()
    provider = build_key_provider(settings)
    old_provider = EnvKeyProvider(provider._keks, current_version=1)  # type: ignore[attr-defined]
    user = a_user(db_session, "rotate-dry")
    bucket = make_bucket(db_session, old_provider, user, "rotate-dry")
    before = bucket.wrapped_dek
    db_session.commit()

    result = run_rotation(db_session, provider, dry_run=True)

    assert result == RotationResult(rotated=1, already_current=0)
    db_session.refresh(bucket)
    assert bucket.kek_version == 1
    assert bucket.wrapped_dek == before


def test_running_twice_rotates_nothing_the_second_time(db_session: Session) -> None:
    settings = two_version_settings()
    provider = build_key_provider(settings)
    old_provider = EnvKeyProvider(provider._keks, current_version=1)  # type: ignore[attr-defined]
    user = a_user(db_session, "rotate-idempotent")
    make_bucket(db_session, old_provider, user, "rotate-idempotent")
    db_session.commit()

    first = run_rotation(db_session, provider, dry_run=False)
    second = run_rotation(db_session, provider, dry_run=False)

    assert first == RotationResult(rotated=1, already_current=0)
    assert second == RotationResult(rotated=0, already_current=1)


def test_an_unwrap_failure_aborts_rather_than_skipping(db_session: Session) -> None:
    """A bucket naming a KEK version this deployment does not hold.

    Simulates the failure by pointing the provider at a settings object
    where secrets_keks never had version 1, the version the stored bucket
    still names. run_rotation must raise rather than continue past it.
    """
    from app.crypto.keys import UnknownKekVersion

    settings = two_version_settings()
    full_provider = build_key_provider(settings)
    old_provider = EnvKeyProvider(full_provider._keks, current_version=1)  # type: ignore[attr-defined]
    user = a_user(db_session, "rotate-broken")
    make_bucket(db_session, old_provider, user, "rotate-broken")
    db_session.commit()

    # A provider that only knows version 2. Version 1, which the bucket
    # above is wrapped under, is unconfigured from this provider's view.
    new_kek = base64.b64encode(bytes(range(1, 33))).decode()
    partial_settings = Settings(
        _env_file=None,
        database_url=settings.database_url,
        cors_origins="",
        environment="test",
        google_client_id="id",
        google_client_secret="secret",
        google_redirect_uri="http://testserver/cb",
        app_url="http://testserver",
        session_cookie_domain="",
        secrets_keks=f"2:{new_kek}",
        secrets_kek_version=2,
    )
    partial_provider = build_key_provider(partial_settings)

    with pytest.raises(UnknownKekVersion):
        run_rotation(db_session, partial_provider, dry_run=False)


def test_a_secret_reads_back_unchanged_after_rotation(db_session: Session) -> None:
    """The property ADR 002's test plan names: rewrap does not touch the value.

    Goes through the same functions the API's own read path uses, not just
    the DEK, so this proves the rewrap is transparent through the whole
    encryption tier rather than that a DEK round trips in isolation.
    """
    from app.secrets_service import put_secret, read_secret

    settings = two_version_settings()
    provider = build_key_provider(settings)
    old_provider = EnvKeyProvider(provider._keks, current_version=1)  # type: ignore[attr-defined]
    user = a_user(db_session, "rotate-secret")
    bucket = make_bucket(db_session, old_provider, user, "rotate-secret")
    secret, _created = put_secret(db_session, old_provider, bucket, "DATABASE_URL", "postgres://x")
    db_session.commit()

    run_rotation(db_session, provider, dry_run=False)
    db_session.commit()

    db_session.refresh(bucket)
    db_session.refresh(secret)
    assert read_secret(provider, bucket, secret) == "postgres://x"
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd api && uv run pytest tests/test_kek_rotation.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'app.kek_rotation'`.

- [ ] **Step 3: Write the module**

Create `api/app/kek_rotation.py`:

```python
"""Rewrapping every bucket's DEK under a new KEK version.

Locks by primary key rather than reusing get_bucket_for_update in
app/buckets.py, which filters by user_id and exists to serialise a bucket
delete against a concurrent secret write within one request. Rotation
crosses every user's buckets, so it needs a lock with no user in scope.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crypto.keys import KeyProvider, wrap_aad
from app.models import Bucket


@dataclass(frozen=True)
class RotationResult:
    rotated: int
    already_current: int


def run_rotation(session: Session, provider: KeyProvider, *, dry_run: bool) -> RotationResult:
    """Rewrap every bucket not already on provider.current_version.

    Both counts are taken from one snapshot, before any writing happens:
    to_rotate is every bucket not yet on the target version, already_current
    is every bucket that already is. That snapshot is also the loop's own
    work list, so the two numbers describe the same instant a dry run would
    have seen.

    Each bucket commits in its own transaction. A crash mid run leaves
    buckets split across two KEK versions, which is not a broken state: a
    row naming the retired version still unwraps correctly as long as
    SECRETS_KEKS still lists that key. Rerunning re-takes the snapshot, so it
    resumes exactly where it stopped, with no state file.

    An unwrap failure (UnknownKekVersion, InvalidTag) is allowed to
    propagate rather than being caught here. It is far more likely a
    misconfiguration affecting every remaining bucket the same way than an
    isolated bad row, and the per-bucket commit already made prior progress
    durable, so aborting costs nothing: fix the configuration and rerun.

    A caller that receives a RotationResult from a real (non dry) run knows,
    without any further query, that every bucket is now on target_version:
    this function either finishes rotating every id in to_rotate or raises
    before returning at all.
    """
    target_version = provider.current_version

    to_rotate = session.scalars(select(Bucket.id).where(Bucket.kek_version != target_version)).all()
    already_current = len(
        session.scalars(select(Bucket.id).where(Bucket.kek_version == target_version)).all()
    )

    if dry_run:
        return RotationResult(rotated=len(to_rotate), already_current=already_current)

    rotated = 0
    for bucket_id in to_rotate:
        row = session.scalars(
            select(Bucket).where(Bucket.id == bucket_id).with_for_update()
        ).one_or_none()
        if row is None or row.kek_version == target_version:
            # Deleted since the snapshot was taken, or already rotated by a
            # concurrent run. Either way there is nothing left to do here.
            continue
        aad = wrap_aad(row.id)
        dek = provider.unwrap(row.wrapped_dek, row.kek_version, aad)
        row.wrapped_dek = provider.wrap(dek, aad)
        row.kek_version = target_version
        session.commit()
        rotated += 1

    return RotationResult(rotated=rotated, already_current=already_current)
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd api && uv run pytest tests/test_kek_rotation.py -v`
Expected: PASS, 6 tests.

- [ ] **Step 5: Falsify the abort-on-failure behavior**

Temporarily change `run_rotation`'s loop to catch `UnknownKekVersion` and
`continue` instead of letting it propagate. Re-run
`test_an_unwrap_failure_aborts_rather_than_skipping`. Expected: FAIL, because
`pytest.raises` finds nothing raised. Restore the propagating version and
confirm green again. Record the actual output in your report.

- [ ] **Step 6: Falsify the property test**

Temporarily change the loop so it updates `row.kek_version` without touching
`row.wrapped_dek` (simulating a rotation that forgets to rewrap). Re-run
`test_a_secret_reads_back_unchanged_after_rotation`. Expected: FAIL, because
`read_secret` now unwraps under the wrong KEK version for what is actually
stored. Restore the correct version and confirm green. Record the actual
output.

- [ ] **Step 7: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts alembic tests
git add app/kek_rotation.py tests/test_kek_rotation.py
git commit -m "feat(api): add the KEK rotation function

Locks buckets by primary key rather than reusing get_bucket_for_update,
which is scoped to one user and cannot see across accounts. An unwrap
failure aborts the run rather than skipping the bucket, falsified by
temporarily catching it and watching the abort test fail."
```

---

### Task 2: The CLI entry point

**Files:**
- Create: `api/scripts/rotate_kek.py`
- Test: `api/tests/test_rotate_kek_cli.py`

**Interfaces:**
- Consumes: `run_rotation`, `RotationResult` from `app.kek_rotation` (Task 1); `build_key_provider` from `app.crypto.keys`; `get_settings` from `app.config`; `get_engine` from `app.db`.
- Produces: `def main(argv: list[str] | None = None) -> None`, and a `if __name__ == "__main__":` entry point in `scripts/rotate_kek.py`.

This task is the thin wrapper `dump_openapi.py` already models: parse `--dry-run`,
build real settings and a real engine, open one session, call `run_rotation`,
print the summary.

Unlike `dump_openapi.py`, this script needs a real `DATABASE_URL`, so it does
not set any environment defaults. A missing or invalid `DATABASE_URL` should
fail the same way `get_settings()` already fails everywhere else in this
codebase: loudly, before anything else runs.

The completion summary format, verbatim:

```
Rotated 4812 buckets to version 2.
0 buckets remain on another version.
Safe to remove the retired KEK version from SECRETS_KEKS.
```

`0 buckets remain on another version` is not a claim that needs its own
query to verify: `format_summary` is only ever called with a `RotationResult`
that `run_rotation` returned without raising, and Task 1's `run_rotation`
either finishes rotating every bucket in its snapshot or propagates an
exception before returning at all. Reaching this line is the proof. This is
deliberately more general than naming one specific retired version, since
`SECRETS_KEKS` can hold more than two versions at once.

For `--dry-run`, the format is:

```
Would rotate 4812 buckets to version 2.
188 already on version 2.
```

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_rotate_kek_cli.py`:

```python
import base64
import uuid

from sqlalchemy.orm import Session

from app.config import Settings
from app.crypto.keys import EnvKeyProvider, build_key_provider, generate_dek, wrap_aad
from app.kek_rotation import RotationResult
from app.models import Bucket, User
from scripts.rotate_kek import format_dry_run_summary, format_summary


def test_summary_names_the_target_version_and_that_it_is_safe_to_remove_the_old_key() -> None:
    """Reaching format_summary at all is the proof.

    run_rotation either finishes every bucket in its snapshot or raises, so
    by the time main() has a RotationResult to format, 0 remaining is
    already true. format_summary states it without a further query.
    """
    result = RotationResult(rotated=4812, already_current=0)

    text = format_summary(result, target_version=2)

    assert "Rotated 4812 buckets to version 2." in text
    assert "0 buckets remain on another version." in text
    assert "Safe to remove" in text


def test_dry_run_summary_says_would_rotate() -> None:
    result = RotationResult(rotated=4812, already_current=188)

    text = format_dry_run_summary(result, target_version=2)

    assert "Would rotate 4812 buckets to version 2." in text
    assert "188 already on version 2." in text
    assert "Rotated" not in text
```

Note: these tests exercise formatting only, not database access, which is
what Task 1's tests already cover thoroughly. This task's own database
coverage is Step 5 below, an end to end smoke test through `main()` itself.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd api && uv run pytest tests/test_rotate_kek_cli.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'scripts.rotate_kek'`.

- [ ] **Step 3: Write the script**

Create `api/scripts/rotate_kek.py`:

```python
"""Rewrap every bucket's DEK under the current KEK version.

Run by hand: `uv run python scripts/rotate_kek.py [--dry-run]`. Never
scheduled. See docs/superpowers/specs/2026-08-12-kek-rotation-cli-design.md
for why: a KEK has no shelf life a calendar can track, and rotation needs a
human deciding it is time, not a cron window.

The new KEK must already be in SECRETS_KEKS, with SECRETS_KEK_VERSION
pointing at it, before this runs. That is a manual step this script cannot
perform: it only ever touches Postgres.
"""

import argparse
import sys

from sqlalchemy.orm import Session

from app.config import get_settings
from app.crypto.keys import build_key_provider
from app.db import get_engine
from app.kek_rotation import RotationResult, run_rotation


def format_summary(result: RotationResult, *, target_version: int) -> str:
    # 0 remaining is not re-verified by a query here. run_rotation either
    # finishes rotating every bucket in its snapshot or raises before
    # returning, so a RotationResult reaching this function already proves
    # nothing is left on another version.
    return (
        f"Rotated {result.rotated} buckets to version {target_version}.\n"
        f"0 buckets remain on another version.\n"
        f"Safe to remove the retired KEK version from SECRETS_KEKS."
    )


def format_dry_run_summary(result: RotationResult, *, target_version: int) -> str:
    return (
        f"Would rotate {result.rotated} buckets to version {target_version}.\n"
        f"{result.already_current} already on version {target_version}."
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would rotate without changing anything.",
    )
    args = parser.parse_args(argv)

    settings = get_settings()
    provider = build_key_provider(settings)

    with Session(get_engine()) as session:
        result = run_rotation(session, provider, dry_run=args.dry_run)

    if args.dry_run:
        print(format_dry_run_summary(result, target_version=provider.current_version))
    else:
        print(format_summary(result, target_version=provider.current_version))


if __name__ == "__main__":
    main(sys.argv[1:])
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd api && uv run pytest tests/test_rotate_kek_cli.py -v`
Expected: PASS, 2 tests.

- [ ] **Step 5: An end to end smoke test through main()**

Append to `api/tests/test_rotate_kek_cli.py`:

```python
def test_main_runs_end_to_end_against_a_real_database(
    db_session: Session, migrated_engine: object, capsys: object
) -> None:
    """Not a unit test of run_rotation, which Task 1 already covers.

    This proves main() itself wires argument parsing, settings, the engine
    and the summary together correctly, the seam Task 1's tests do not
    reach because they call run_rotation directly.
    """
    import os

    from scripts.rotate_kek import main

    user = User(google_sub="cli-smoke", email="cli-smoke@example.com", name="Test")
    db_session.add(user)
    db_session.flush()

    old_kek = base64.b64encode(bytes(range(32))).decode()
    new_kek = base64.b64encode(bytes(range(1, 33))).decode()
    old_settings = Settings(
        _env_file=None,
        database_url=os.environ["DATABASE_URL"],
        cors_origins="",
        environment="test",
        google_client_id="id",
        google_client_secret="secret",
        google_redirect_uri="http://testserver/cb",
        app_url="http://testserver",
        session_cookie_domain="",
        secrets_keks=f"1:{old_kek}",
        secrets_kek_version=1,
    )
    old_provider = build_key_provider(old_settings)
    bucket_id = uuid.uuid4()
    bucket = Bucket(
        id=bucket_id,
        user_id=user.id,
        name="cli-smoke",
        wrapped_dek=old_provider.wrap(generate_dek(), wrap_aad(bucket_id)),
        kek_version=1,
    )
    db_session.add(bucket)
    db_session.commit()

    os.environ["SECRETS_KEKS"] = f"1:{old_kek},2:{new_kek}"
    os.environ["SECRETS_KEK_VERSION"] = "2"
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        main([])
    finally:
        get_settings.cache_clear()
        os.environ["SECRETS_KEKS"] = f"1:{old_kek}"
        os.environ["SECRETS_KEK_VERSION"] = "1"
        get_settings.cache_clear()

    captured = capsys.readouterr()
    assert "Rotated 1 buckets to version 2." in captured.out

    db_session.expire_all()
    refreshed = db_session.get(Bucket, bucket_id)
    assert refreshed is not None
    assert refreshed.kek_version == 2
```

This test mutates `os.environ` and clears `get_settings`'s cache, following
the exact pattern `conftest.py`'s `_reset_caches` fixture already establishes
for this codebase. It restores both in a `finally` block so a failure does
not leak a changed `SECRETS_KEK_VERSION` into later tests in the same
session.

- [ ] **Step 6: Run it and watch it pass**

Run: `cd api && uv run pytest tests/test_rotate_kek_cli.py -v`
Expected: PASS, 3 tests.

- [ ] **Step 7: Run the whole backend suite once**

Run: `cd api && uv run pytest -q`
Expected: PASS, everything, including Task 1's and Task 2's new tests. Watch
specifically for `get_settings` cache pollution: if a test after this one in
the same file or session sees a stale `SECRETS_KEK_VERSION`, the `finally`
block in Step 5 did not run or did not restore correctly.

- [ ] **Step 8: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts alembic tests
git add scripts/rotate_kek.py tests/test_rotate_kek_cli.py
git commit -m "feat(api): add the rotate_kek CLI entry point

A thin wrapper around run_rotation, mirroring how dump_openapi.py wraps its
own logic. --dry-run reports what would change without touching a row. The
summary states whether it is safe to remove the retired KEK, the CLI's only
handoff to the operator since rotation writes no audit_log row."
```

---

### Task 3: Verify the whole change from the repo root

**Files:**
- Modify: only what a check below finds wrong

**Interfaces:**
- Consumes: everything Tasks 1 and 2 built.
- Produces: the finished change.

Every prior step ran from `api/`. This runs the checks CI runs, from the repo
root, and confirms the claims the spec makes about scope: backend only, no
new dependency, no schema change.

- [ ] **Step 1: The full suite and every linter**

Run: `make lint && make test`
Expected: ruff, ruff format, mypy, eslint and tsc all clean; pytest and vitest
both green. The frontend is untouched, so its numbers must be unchanged from
before this branch.

- [ ] **Step 2: No schema drift**

Run: `make types && git status --short`
Expected: `git status` empty. No Pydantic response model changed, so
`generated.ts` must not move.

- [ ] **Step 3: No Alembic migration was generated**

Run: `ls api/alembic/versions/ | wc -l`
Expected: the same count as on `main` before this branch. Rotation changes
row values, never the schema, so no new migration file should exist. If one
does, something ran `alembic revision` by mistake; delete it.

- [ ] **Step 4: Nothing outside the backend changed**

Run: `git diff --stat main...HEAD`
Expected: only files under `api/` plus this plan and the spec. Nothing under
`web/`.

- [ ] **Step 5: No new dependency**

Run: `git diff main...HEAD -- api/pyproject.toml api/uv.lock`
Expected: no output.

- [ ] **Step 6: No audit_log row from rotation**

Run: `cd api && grep -n "record_audit" app/kek_rotation.py scripts/rotate_kek.py`
Expected: no output. The spec is explicit that rotation writes no audit
entry; this confirms neither new file calls it.

- [ ] **Step 7: No em dashes**

Run: `grep -rn "—" api/app/kek_rotation.py api/scripts/rotate_kek.py api/tests/test_kek_rotation.py api/tests/test_rotate_kek_cli.py`
Expected: no output.

- [ ] **Step 8: Run the CLI for real, once, against the dev database**

This is the one check that exercises the script the way an operator actually
will: as a subprocess, not through pytest.

```bash
cd api
uv run python scripts/rotate_kek.py --dry-run
```

Expected: it runs against whatever `DATABASE_URL` your `.env` names (local
dev Postgres from `make dev`, or the placeholder if `make dev` is not
running, in which case this step should fail to connect rather than crash on
something else). Report the actual output, including a connection failure if
`make dev` is not up. A connection failure here is an acceptable result for
this step, since the goal is proving the CLI's argument parsing and startup
path work outside the test harness, not that a live database is reachable
right now.

- [ ] **Step 9: Commit anything the checks corrected**

```bash
git add -A
git commit -m "fix(api): correct what the verification pass found"
```

If nothing needed fixing, say so in the report and skip the commit. Do not
manufacture a change to have something to commit.

---

## What this deliberately leaves undone

- **Scheduling.** No cron, no GitHub Actions workflow, no Fly machine
  scheduled task. The spec's reasoning: a KEK has no shelf life, and the
  precondition (a new KEK already deployed) is manual regardless.
- **Automatically removing the retired KEK from `SECRETS_KEKS`.** A Fly
  secrets edit and redeploy, outside anything this script can reach.
- **DEK rotation.** ADR 002 A15 reserves that for its own amendment.
- **A resumable batch size for very large bucket counts.** The per-bucket
  loop is already the right shape if this project's scale ever changes.
- **Per-key rate limiting.** The other remaining hardening piece, unrelated
  beyond both eventually touching production.

## Notes for the executing agent

- `EnvKeyProvider._keks` is accessed directly in test helpers (with a
  `# type: ignore[attr-defined]` comment, since it is a private attribute)
  to build a second provider pinned to an older `current_version` from the
  same key material. This is a test-only convenience; production code never
  does this, since `build_key_provider(settings)` is the only real
  construction path and always uses `settings.secrets_kek_version` as
  current.
- The backend's KEK generation command, for reference while testing by hand:
  `python -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"`.
- `get_settings()`, `get_engine()` and `get_key_provider()` are all
  `lru_cache`d. Any test that changes `SECRETS_KEKS` or
  `SECRETS_KEK_VERSION` in `os.environ` after the module has already been
  imported must call `get_settings.cache_clear()` (and `get_key_provider`'s
  own cache, if that function is used instead of `build_key_provider`
  directly) or the change will not take effect. `conftest.py`'s
  `_reset_caches` fixture is the existing pattern for this.
- `format_summary`'s "0 buckets remain on another version" line is not a
  hedge or an approximation. It is provably true whenever the function is
  reached, because `run_rotation` cannot return a `RotationResult` from a
  real (non dry) run without having rotated every bucket its snapshot named.
  If a future change makes `run_rotation` able to return partial progress
  (for instance, catching a per-bucket failure instead of letting it
  propagate), this line stops being true and must change with it.
