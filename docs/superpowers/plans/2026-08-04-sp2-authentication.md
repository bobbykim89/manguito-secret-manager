# SP2: Authentication (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish who a request belongs to, through Google OAuth login, server-side sessions, and a `current_user` dependency every SP3 bucket route will hang off.

**Architecture:** Four endpoints under `/v1/auth`. The Google interaction sits behind a `GoogleOAuthClient` protocol so tests inject a fake and the suite never touches the network, mirroring ADR 002's `KeyProvider` pattern. Sessions are opaque 32 byte tokens stored as SHA-256 hashes in Postgres, carried in an `HttpOnly` cookie, expiring absolutely after seven days. OAuth CSRF protection is a `state` value plus a PKCE verifier held in a short-lived cookie.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.x (sync, `Mapped`/`mapped_column`), psycopg3, Alembic, Authlib, httpx, pytest, testcontainers.

## Global Constraints

Every task's requirements implicitly include this section.

- **SQLAlchemy is synchronous.** Routes are `def`, never `async def`. Exception: FastAPI exception handlers are `async def`, matching the existing ones in `app/envelope.py`.
- **SQLAlchemy 2.x style:** `Mapped[...]` and `mapped_column`, never legacy declarative. (CLAUDE.md)
- **The engine uses `poolclass=NullPool`.** Already configured; do not change it.
- **Every schema change gets an Alembic migration in the same commit.** (CLAUDE.md)
- **Tests use a real Postgres via testcontainers, not SQLite.** (CLAUDE.md)
- **No network I/O in the test suite.** The Google boundary is faked.
- **Response envelope is fixed:** `{"ok": true, "data": ...}` and `{"ok": false, "error": {"code": "...", "message": "..."}}`.
- **Exception:** `/v1/auth/google/start` and `/v1/auth/google/callback` redirect instead of returning the envelope, because a browser navigates to them directly. The rule: endpoints a browser navigates to redirect; endpoints JavaScript calls return the envelope.
- **Plaintext session tokens, the Google client secret, and the PKCE verifier are never logged.** (CLAUDE.md invariant 1)
- **`SECRETS_KEK` must not appear anywhere.** It arrives in SP3.
- **No API keys, no buckets, no cryptography beyond SHA-256 hashing.** Moved to SP3 per ADR 002 A8.
- **No em dashes** in code, comments, docs, or commit messages. (CLAUDE.md)
- Comments explain why, not what.
- Commit messages: commitizen format, imperative, scoped.
- `make lint` must pass: ruff check, ruff format, mypy strict over `app scripts alembic tests`.
- The domain is unchosen. Use `<domain>` in documentation; real values live only in untracked config.

**Test counts:** SP1 ends at 25 backend tests. Each task below states how many tests *it* adds. Do not assert a cumulative total in any task; verify the tests this task added pass, plus that no previously passing test broke.

---

### Task 1: Configuration, dependencies, and the schema-dump guard

**Files:**
- Modify: `api/pyproject.toml`
- Modify: `api/app/config.py`
- Modify: `api/scripts/dump_openapi.py`
- Modify: `api/tests/conftest.py`
- Modify: `.env.example`
- Test: `api/tests/test_config.py`

**Interfaces:**
- Consumes: `app.config.Settings`, `get_settings()`.
- Produces: `Settings` gains `google_client_id: str`, `google_client_secret: str`, `google_redirect_uri: str`, `app_url: str`, `session_cookie_domain: str = ""`, and a property `is_production -> bool`.

**Why `dump_openapi.py` and `conftest.py` change here.** Both build the app at import time, which validates `Settings`. Adding required fields without giving them placeholders breaks `make types` and therefore the `types-drift` CI check, and breaks pytest collection. This is the same failure SP1 hit; fix it in the same commit that causes it.

- [ ] **Step 1: Add the dependencies**

```bash
cd api && uv add authlib httpx
```

Expected: `pyproject.toml` gains both under `dependencies` (runtime, not dev), and `uv.lock` updates.

Note: `httpx2` already exists as a dev dependency for Starlette's `TestClient`. That is a different package and both coexist. Authlib needs `httpx`.

- [ ] **Step 2: Write the failing settings test**

Append to `api/tests/test_config.py`:

```python
def test_google_settings_read_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "https://api.example.com/v1/auth/google/callback")
    monkeypatch.setenv("APP_URL", "https://app.example.com")

    settings = Settings()

    assert settings.google_client_id == "client-id"
    assert settings.google_client_secret == "client-secret"
    assert settings.google_redirect_uri == "https://api.example.com/v1/auth/google/callback"
    assert settings.app_url == "https://app.example.com"


def test_session_cookie_domain_defaults_to_empty() -> None:
    """Exercises the class default, not merely the absence of an env var.

    Settings reads ../.env, and pydantic-settings resolves env, then dotenv,
    then the field default. Asserting on a field this test never sets would
    otherwise fail for anyone whose local .env happens to set it.
    """
    settings = Settings(
        _env_file=None,
        database_url="postgresql+psycopg://u:p@localhost:5433/db",
        google_client_id="client-id",
        google_client_secret="client-secret",
        google_redirect_uri="https://api.example.com/cb",
        app_url="https://app.example.com",
    )

    assert settings.session_cookie_domain == ""


@pytest.mark.parametrize(
    ("environment", "expected"),
    [
        ("production", True),
        ("Production", True),
        ("staging", True),
        ("prod", True),
        ("local", False),
        ("test", False),
        ("schema-dump", False),
    ],
)
def test_is_production_fails_closed(environment: str, expected: bool) -> None:
    """Anything unrecognised counts as production.

    A wrong guess costs a broken local login you notice at once, rather than a
    session cookie shipped without Secure in production, which nobody notices.
    """
    settings = Settings(
        _env_file=None,
        database_url="postgresql+psycopg://u:p@localhost:5433/db",
        environment=environment,
        google_client_id="client-id",
        google_client_secret="client-secret",
        google_redirect_uri="https://api.example.com/cb",
        app_url="https://app.example.com",
    )

    assert settings.is_production is expected
```

Add `import pytest` to the file's imports if it is not already there.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_config.py -v`
Expected: FAIL with `ValidationError` on the missing fields, or `AttributeError` on `is_production`.

- [ ] **Step 4: Add the settings fields**

In `api/app/config.py`, add to the `Settings` class after `environment`:

```python
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    app_url: str
    session_cookie_domain: str = ""

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() not in _NON_PRODUCTION
```

with this module-level constant above the class:

```python
# Values that are definitely not production. Anything else, including a typo
# or a new environment name, is treated as production, because a wrong guess
# here costs a broken local login you notice immediately rather than a missing
# Secure flag in production that nobody notices.
_NON_PRODUCTION = frozenset({"local", "test", "schema-dump"})
```

Do not type `environment` as a `Literal`. `conftest.py` sets `ENVIRONMENT=test`
and `dump_openapi.py` sets `ENVIRONMENT=schema-dump`; a Literal would reject
both and break pytest collection and the `types-drift` check.

Update the class docstring's second paragraph to read:

```python
    """Application configuration, read from the environment.

    SECRETS_KEK is deliberately absent until SP3. Nothing decrypts yet, and an
    unvalidated secret sitting in Fly that no code reads is a configuration
    error nobody would notice.
    """
```

- [ ] **Step 5: Give the schema dump placeholders for the new fields**

In `api/scripts/dump_openapi.py`, extend the existing `setdefault` block:

```python
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://schema-dump/schema-dump")
os.environ.setdefault("CORS_ORIGINS", "")
os.environ.setdefault("ENVIRONMENT", "schema-dump")
os.environ.setdefault("GOOGLE_CLIENT_ID", "schema-dump")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "schema-dump")
os.environ.setdefault("GOOGLE_REDIRECT_URI", "http://schema-dump/callback")
os.environ.setdefault("APP_URL", "http://schema-dump")
```

- [ ] **Step 6: Give pytest collection the same placeholders**

In `api/tests/conftest.py`, extend the module-level block:

```python
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-client-secret")
os.environ.setdefault("GOOGLE_REDIRECT_URI", "http://testserver/v1/auth/google/callback")
os.environ.setdefault("APP_URL", "http://testserver")
```

- [ ] **Step 7: Update the example environment file**

Append to `.env.example`:

```bash
# Google OAuth. Register both the localhost and production redirect URIs on
# one client in the Google Cloud console; Google allows plain http for
# localhost specifically.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8000/v1/auth/google/callback
APP_URL=http://localhost:5173
# Empty locally. Set to .<domain> in production so the cookie is shared
# between app.<domain> and api.<domain>.
SESSION_COOKIE_DOMAIN=
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd api && uv run pytest tests/test_config.py -v`
Expected: 6 passed (3 pre-existing plus 3 new).

- [ ] **Step 9: Verify the schema dump still works with no environment at all**

Run: `cd api && uv run pytest tests/test_dump_openapi.py -v`
Expected: 3 passed. This is the check that would otherwise fail in CI's `types-drift`.

- [ ] **Step 10: Update your local .env**

Your untracked `.env` needs the new keys or `make dev` will fail at import. Add the five keys from Step 7. Leave `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` empty for now; nothing reads them until Task 5. Do not commit `.env`.

- [ ] **Step 11: Run lint and the full suite**

Run: `make lint && make test`
Expected: no lint errors; backend tests pass with 3 more than before.

- [ ] **Step 12: Commit**

```bash
git add api/pyproject.toml api/uv.lock api/app/config.py api/scripts/dump_openapi.py api/tests/conftest.py api/tests/test_config.py .env.example
git commit -m "feat(api): add Google OAuth configuration

Extends the schema dump and pytest collection placeholders in the same
commit, because both build the app at import and would otherwise break
make types and the types-drift check."
```

---

### Task 2: The users and sessions tables

**Files:**
- Create: `api/app/models/__init__.py`
- Create: `api/app/models/user.py`
- Create: `api/app/models/session.py`
- Create: `api/alembic/versions/0002_users_and_sessions.py`
- Modify: `api/alembic/env.py`
- Test: `api/tests/test_models.py`

**Interfaces:**
- Consumes: `app.db.Base`.
- Produces: `app.models.User` (fields `id: uuid.UUID`, `google_sub: str`, `email: str`, `name: str | None`, `created_at: datetime`, `updated_at: datetime`) and `app.models.UserSession` (fields `id: uuid.UUID`, `token_hash: bytes`, `user_id: uuid.UUID`, `created_at: datetime`, `expires_at: datetime`, relationship `user`). Alembic head becomes `0002`.

**The model is named `UserSession`, not `Session`.** `Session` is SQLAlchemy's own class and is imported in nearly every module here. A model with the same name would shadow it and produce confusing type errors. The table is still `sessions`.

- [ ] **Step 1: Write the failing model test**

Create `api/tests/test_models.py`:

```python
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import Engine, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User, UserSession


def test_tables_exist_after_migration(migrated_engine: Engine) -> None:
    tables = set(inspect(migrated_engine).get_table_names())

    assert {"users", "sessions", "alembic_version"} <= tables


def test_user_round_trips(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        user = User(google_sub="sub-1", email="a@example.com", name="A")
        session.add(user)
        session.commit()
        session.refresh(user)

        assert isinstance(user.id, uuid.UUID)
        assert user.created_at is not None
        assert user.updated_at is not None


def test_updating_a_user_advances_updated_at(migrated_engine: Engine) -> None:
    """Proves onupdate fires, which asserting non-null after an insert does not.

    func.now() returns the transaction timestamp in Postgres, so the update
    has to happen in a separate transaction or both stamps are identical.
    """
    with Session(migrated_engine) as session:
        user = User(google_sub="touch-1", email="before@example.com")
        session.add(user)
        session.commit()
        user_id = user.id
        created = user.created_at
        first_updated = user.updated_at

    with Session(migrated_engine) as session:
        stored = session.get(User, user_id)
        assert stored is not None
        stored.email = "after@example.com"
        session.commit()
        session.refresh(stored)

        assert stored.updated_at > first_updated
        assert stored.created_at == created


def test_google_sub_is_unique(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        session.add(User(google_sub="dupe", email="one@example.com"))
        session.commit()

    with Session(migrated_engine) as session:
        session.add(User(google_sub="dupe", email="two@example.com"))
        try:
            session.commit()
        except IntegrityError:
            return
    raise AssertionError("expected a unique violation on google_sub")


def test_deleting_a_user_cascades_to_sessions(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        user = User(google_sub="cascade", email="c@example.com")
        session.add(user)
        session.flush()
        session.add(
            UserSession(
                token_hash=b"\x01" * 32,
                user_id=user.id,
                expires_at=datetime.now(UTC) + timedelta(days=7),
            )
        )
        session.commit()
        user_id = user.id

    with Session(migrated_engine) as session:
        stored = session.get(User, user_id)
        assert stored is not None
        session.delete(stored)
        session.commit()

    with Session(migrated_engine) as session:
        remaining = session.execute(select(UserSession)).scalars().all()
        assert remaining == []
```

- [ ] **Step 2: Add the migrated_engine fixture**

Append to `api/tests/conftest.py`:

```python
@pytest.fixture(scope="session")
def migrated_engine(postgres_url: str) -> Iterator[Engine]:
    """An engine against a database with every migration applied.

    Session scoped because running Alembic per test would dominate the
    suite's runtime. Tests that write must clean up after themselves or use
    values unique to the test.
    """
    from alembic import command
    from alembic.config import Config

    api_root = Path(__file__).resolve().parent.parent
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))
    config.set_main_option("sqlalchemy.url", postgres_url)
    command.upgrade(config, "head")

    engine = create_db_engine(postgres_url)
    yield engine
    engine.dispose()
    command.downgrade(config, "base")
```

Add these imports at the top of `conftest.py`:

```python
from pathlib import Path

from sqlalchemy import Engine

from app.db import create_db_engine
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models'`

- [ ] **Step 4: Create the User model**

Create `api/app/models/user.py`:

```python
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class User(Base):
    """A person, identified by their Google account.

    google_sub is the identity rather than email, because Google's subject
    identifier is stable forever while an email address can change or be
    reassigned to someone else.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    google_sub: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

- [ ] **Step 5: Create the UserSession model**

Create `api/app/models/session.py`:

```python
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, LargeBinary, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.user import User


class UserSession(Base):
    """A logged in browser session.

    Named UserSession rather than Session because SQLAlchemy's Session is
    imported in nearly every module here and shadowing it produces confusing
    type errors. The table is still `sessions`.

    Only the SHA-256 hash of the token is stored, for the same reason ADR 002
    gives for API keys: a 256 bit random token has no brute force surface, and
    hashing means a stolen database dump does not hand over live sessions.
    """

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    # unique=True alone, matching google_sub. Adding index=True as well would
    # merge into a single unique index in the model while the migration
    # declares a constraint, and autogenerate would then propose spurious
    # drops and recreates forever after.
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    user: Mapped[User] = relationship()
```

- [ ] **Step 6: Export both models**

Create `api/app/models/__init__.py`:

```python
"""Model package.

Every model must be imported here so Base.metadata is complete by the time
Alembic's env.py reads it. A model that is never imported is invisible to
autogenerate and silently missing from migrations.
"""

from app.models.session import UserSession
from app.models.user import User

__all__ = ["User", "UserSession"]
```

- [ ] **Step 7: Make Alembic see the models**

In `api/alembic/env.py`, change the import of `Base` to also import the model package:

```python
from app.db import Base
from app.models import User, UserSession  # noqa: F401  (registers models on Base.metadata)
```

Keep `target_metadata = Base.metadata` as it is, and delete the comment above it that says models arrive in SP2.

- [ ] **Step 8: Create the migration**

Create `api/alembic/versions/0002_users_and_sessions.py`:

```python
"""Users and sessions.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("google_sub", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("google_sub"),
    )
    op.create_table(
        "sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    # No explicit index on token_hash: the unique constraint above already
    # builds one, and Postgres uses it for the equality lookup.
    op.create_index("ix_sessions_expires_at", "sessions", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_sessions_expires_at", table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("users")
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd api && uv run pytest tests/test_models.py -v`
Expected: 4 passed.

- [ ] **Step 10: Update the migration tests, and make them restore the schema**

Three changes to `api/tests/test_migrations.py`.

**Zeroth**, `test_baseline_migration_applies_and_reverses` asserts
`version == "0001"` after upgrading to head. Head is now `0002`. Update that
assertion, or the file fails before any of the following matters.

**First**, `test_baseline_creates_no_domain_tables` asserts the table set after
upgrading to **head**, which is now `0002` and does create tables. Rename it to
`test_migrations_create_the_expected_tables`, replace its docstring with
`"""SP2 adds exactly two tables and no more."""`, and change the assertion to:

```python
        tables = set(inspect(engine).get_table_names())
        assert tables == {"alembic_version", "users", "sessions"}
```

**Second, and this one is a real bug if skipped.** Both tests in this file end
with the database downgraded to `base`. The new `migrated_engine` fixture is
session scoped, so it upgrades once and never again. Alphabetically
`test_migrations` runs before `test_models`, so leaving the database at `base`
drops the tables every later test depends on, producing failures in files that
did nothing wrong.

Make both tests restore the schema. Each must end with:

```python
    command.upgrade(config, "head")
```

In `test_baseline_migration_applies_and_reverses`, add it after the downgrade
assertions. In `test_migrations_create_the_expected_tables`, replace the
`finally: command.downgrade(config, "base")` with a `finally` that downgrades
and then upgrades again, so the assertion still runs against a known state but
the file leaves the database as it found it.

- [ ] **Step 10b: Prove the ordering bug is actually gone**

Run the two files together in the order pytest would collect them:

Run: `cd api && uv run pytest tests/test_migrations.py tests/test_models.py -v`
Expected: all 6 pass. Before the restore is added, `test_models` fails with
`UndefinedTable`. Run it once without the fix if you want to see the failure
mode, then add the fix.

- [ ] **Step 11: Run lint and the full suite**

Run: `make lint && make test`
Expected: no lint errors; 4 new backend tests.

- [ ] **Step 12: Commit**

```bash
git add api/app/models api/alembic api/tests/test_models.py api/tests/test_migrations.py api/tests/conftest.py
git commit -m "feat(api): add the users and sessions tables

The session model is named UserSession because SQLAlchemy's Session is
imported in nearly every module here and shadowing it produces confusing
type errors."
```

---

### Task 3: The session store

**Files:**
- Create: `api/app/auth/__init__.py`
- Create: `api/app/auth/sessions.py`
- Test: `api/tests/test_auth_sessions.py`

**Interfaces:**
- Consumes: `app.models.User`, `app.models.UserSession`.
- Produces, all in `app.auth.sessions`:
  - `SESSION_LIFETIME: timedelta` (7 days)
  - `generate_token() -> str`
  - `hash_token(token: str) -> bytes`
  - `create_session(session: Session, user: User) -> tuple[str, UserSession]` returning the plaintext token and the row
  - `lookup_session_user(session: Session, token: str) -> User | None`
  - `delete_session(session: Session, token: str) -> None`
  - `purge_expired_sessions(session: Session, user: User) -> None`

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_auth_sessions.py`:

```python
import base64
import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session

from app.auth.sessions import (
    SESSION_LIFETIME,
    _TOKEN_BYTES,
    create_session,
    delete_session,
    generate_token,
    hash_token,
    lookup_session_user,
    purge_expired_sessions,
)
from app.models import User, UserSession


def make_user(session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com")
    session.add(user)
    session.flush()
    return user


def test_generated_tokens_are_unique_and_carry_full_entropy() -> None:
    # Pinned to a literal, not just to _TOKEN_BYTES: generate_token() reads
    # _TOKEN_BYTES too, so comparing solely against that constant would let
    # both sides drift together and never catch a weakened value.
    assert _TOKEN_BYTES == 32

    tokens = {generate_token() for _ in range(100)}

    assert len(tokens) == 100
    for token in tokens:
        padding = "=" * (-len(token) % 4)
        assert len(base64.urlsafe_b64decode(token + padding)) == _TOKEN_BYTES


def test_hash_token_is_sha256_of_the_utf8_token() -> None:
    assert hash_token("abc") == hashlib.sha256(b"abc").digest()


def test_create_session_returns_the_plaintext_and_stores_only_the_hash(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        user = make_user(session, "create-1")

        token, row = create_session(session, user)
        session.commit()

        assert row.token_hash == hash_token(token)
        stored = session.execute(select(UserSession.token_hash)).scalars().all()
        assert hash_token(token) in stored

        # Reads every column of the persisted row. `token not in repr(row)`
        # would be tautological: UserSession has no __repr__ override, so the
        # default never contains field values and would pass even with the
        # plaintext sitting in the column.
        stored_row = (
            session.execute(
                text("SELECT * FROM sessions WHERE token_hash = :hash"),
                {"hash": hash_token(token)},
            )
            .mappings()
            .one()
        )
        assert all(token not in str(value) for value in stored_row.values())


def test_create_session_sets_absolute_expiry(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        user = make_user(session, "create-2")

        _, row = create_session(session, user)
        session.commit()

        delta = row.expires_at - datetime.now(UTC)
        assert timedelta(days=6, hours=23) < delta <= SESSION_LIFETIME


def test_lookup_returns_the_user_for_a_live_token(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        user = make_user(session, "lookup-1")
        token, _ = create_session(session, user)
        session.commit()

        assert lookup_session_user(session, token) == user


def test_lookup_returns_none_for_an_unknown_token(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        assert lookup_session_user(session, "not-a-real-token") is None


def test_lookup_returns_none_for_an_expired_token(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        user = make_user(session, "lookup-expired")
        token, row = create_session(session, user)
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        session.commit()

        assert lookup_session_user(session, token) is None


def test_delete_session_removes_the_row(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        user = make_user(session, "delete-1")
        token, _ = create_session(session, user)
        session.commit()

        delete_session(session, token)
        session.commit()

        assert lookup_session_user(session, token) is None


def test_delete_session_is_idempotent(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        delete_session(session, "never-existed")
        session.commit()


def test_purge_removes_only_that_users_expired_rows(migrated_engine: Engine) -> None:
    with Session(migrated_engine) as session:
        mine = make_user(session, "purge-mine")
        theirs = make_user(session, "purge-theirs")

        _, my_expired = create_session(session, mine)
        my_expired.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        my_live_token, _ = create_session(session, mine)
        _, their_expired = create_session(session, theirs)
        their_expired.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        session.commit()

        purge_expired_sessions(session, mine)
        session.commit()

        remaining = session.execute(
            select(UserSession).where(UserSession.user_id == mine.id)
        ).scalars().all()
        assert len(remaining) == 1
        assert lookup_session_user(session, my_live_token) == mine

        theirs_remaining = session.execute(
            select(UserSession).where(UserSession.user_id == theirs.id)
        ).scalars().all()
        assert len(theirs_remaining) == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_auth_sessions.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.auth'`

- [ ] **Step 3: Implement the session store**

Create `api/app/auth/__init__.py` as an empty file, then create `api/app/auth/sessions.py`:

```python
import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import User, UserSession

SESSION_LIFETIME = timedelta(days=7)

# 32 bytes of entropy. token_urlsafe returns roughly 4/3 characters per byte.
_TOKEN_BYTES = 32


def generate_token() -> str:
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_token(token: str) -> bytes:
    """SHA-256 rather than a slow KDF.

    A 256 bit random token has no brute force surface, and this runs on every
    authenticated request, so a deliberately slow hash would be pure latency.
    Same reasoning ADR 002 applies to API keys.
    """
    return hashlib.sha256(token.encode()).digest()


def create_session(session: Session, user: User) -> tuple[str, UserSession]:
    """Create a session and return the plaintext token with its row.

    The plaintext is returned rather than stored: it goes into the cookie and
    is never persisted anywhere.
    """
    token = generate_token()
    row = UserSession(
        token_hash=hash_token(token),
        user_id=user.id,
        expires_at=datetime.now(UTC) + SESSION_LIFETIME,
    )
    session.add(row)
    session.flush()
    return token, row


def lookup_session_user(session: Session, token: str) -> User | None:
    statement = (
        select(User)
        .join(UserSession, UserSession.user_id == User.id)
        .where(
            UserSession.token_hash == hash_token(token),
            UserSession.expires_at > datetime.now(UTC),
        )
    )
    return session.execute(statement).scalar_one_or_none()


def delete_session(session: Session, token: str) -> None:
    session.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))


def purge_expired_sessions(session: Session, user: User) -> None:
    """Housekeeping, not enforcement.

    Expiry is enforced by the lookup query. This keeps the table from growing
    without bound, and runs at login because Fly stops the machine when idle
    so there is no always on process to sweep from.
    """
    session.execute(
        delete(UserSession).where(
            UserSession.user_id == user.id,
            UserSession.expires_at <= datetime.now(UTC),
        )
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && uv run pytest tests/test_auth_sessions.py -v`
Expected: 10 passed.

- [ ] **Step 5: Run lint and the full suite**

Run: `make lint && make test`
Expected: no lint errors; 10 new backend tests.

- [ ] **Step 6: Commit**

```bash
git add api/app/auth api/tests/test_auth_sessions.py
git commit -m "feat(api): add the session store

Tokens are returned in plaintext for the cookie and stored only as a
SHA-256 hash, so a database dump yields no usable sessions."
```

---

### Task 4: Cookie helpers

**Files:**
- Create: `api/app/auth/cookies.py`
- Test: `api/tests/test_auth_cookies.py`

**Interfaces:**
- Consumes: `app.config.Settings`.
- Produces, all in `app.auth.cookies`:
  - `SESSION_COOKIE = "msm_session"`, `OAUTH_COOKIE = "msm_oauth"`, `OAUTH_COOKIE_PATH = "/v1/auth"`, `OAUTH_COOKIE_MAX_AGE = 600`
  - `set_session_cookie(response: Response, token: str, settings: Settings) -> None`
  - `clear_session_cookie(response: Response, settings: Settings) -> None`
  - `set_oauth_cookie(response: Response, state: str, verifier: str, settings: Settings) -> None`
  - `read_oauth_cookie(raw: str | None) -> tuple[str, str] | None` returning `(state, verifier)`
  - `clear_oauth_cookie(response: Response, settings: Settings) -> None`

**Why the flags are tested.** `Secure` and `Domain` differ between environments and a local run never exercises the production values. Getting them wrong means login works in development and fails only after deploy.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_auth_cookies.py`:

```python
import pytest
from fastapi import Response

from app.auth.cookies import (
    OAUTH_COOKIE,
    SESSION_COOKIE,
    clear_oauth_cookie,
    clear_session_cookie,
    read_oauth_cookie,
    set_oauth_cookie,
    set_session_cookie,
)
from app.config import Settings


def settings_for(environment: str, domain: str = "") -> Settings:
    """Every field is passed explicitly, and the dotenv source is disabled.

    Settings otherwise reads ../.env, so a developer with SESSION_COOKIE_DOMAIN
    set locally would fail the "no Domain locally" assertion while CI passed.
    """
    return Settings(
        _env_file=None,
        database_url="postgresql+psycopg://u:p@localhost:5433/db",
        cors_origins="",
        environment=environment,
        google_client_id="id",
        google_client_secret="secret",
        google_redirect_uri="http://testserver/cb",
        app_url="http://testserver",
        session_cookie_domain=domain,
    )


def header_for(response: Response, name: str) -> str:
    for key, value in response.raw_headers:
        if key.decode().lower() == "set-cookie" and value.decode().startswith(f"{name}="):
            return value.decode()
    raise AssertionError(f"no Set-Cookie for {name}")


def test_session_cookie_is_secure_in_production() -> None:
    response = Response()
    set_session_cookie(response, "tok", settings_for("production", ".example.com"))

    header = header_for(response, SESSION_COOKIE)
    assert "Secure" in header
    assert "HttpOnly" in header
    assert "samesite=lax" in header.lower()
    assert "Domain=.example.com" in header


def test_session_cookie_is_not_secure_locally() -> None:
    response = Response()
    set_session_cookie(response, "tok", settings_for("local"))

    header = header_for(response, SESSION_COOKIE)
    assert "Secure" not in header
    assert "Domain=" not in header
    assert "HttpOnly" in header


def test_clearing_the_session_cookie_expires_it() -> None:
    response = Response()
    clear_session_cookie(response, settings_for("local"))

    header = header_for(response, SESSION_COOKIE)
    assert "Max-Age=0" in header or "expires=Thu, 01 Jan 1970" in header.lower()


def test_oauth_cookie_round_trips_state_and_verifier() -> None:
    response = Response()
    set_oauth_cookie(response, "the-state", "the-verifier", settings_for("local"))

    header = header_for(response, OAUTH_COOKIE)
    raw = header.split(";")[0].split("=", 1)[1]

    assert read_oauth_cookie(raw) == ("the-state", "the-verifier")


def test_oauth_cookie_is_scoped_and_short_lived() -> None:
    response = Response()
    set_oauth_cookie(response, "s", "v", settings_for("local"))

    header = header_for(response, OAUTH_COOKIE)
    assert "Path=/v1/auth" in header
    assert "Max-Age=600" in header
    assert "HttpOnly" in header


@pytest.mark.parametrize("raw", [None, "", "no-separator", "a.b.c"])
def test_read_oauth_cookie_rejects_malformed_values(raw: str | None) -> None:
    assert read_oauth_cookie(raw) is None


def test_clearing_the_oauth_cookie_uses_the_same_path() -> None:
    response = Response()
    clear_oauth_cookie(response, settings_for("local"))

    header = header_for(response, OAUTH_COOKIE)
    assert "Path=/v1/auth" in header


def test_clearing_the_session_cookie_matches_the_production_attributes() -> None:
    """Locally neither the set nor the clear carries a Domain, so asserting its
    absence cannot tell a correct clear from one that dropped _domain(). A
    browser only deletes a cookie when domain and path match the original, so
    that regression would produce a logout that appears to work and does not.
    """
    settings = settings_for("production", ".example.com")
    set_response = Response()
    set_session_cookie(set_response, "tok", settings)
    clear_response = Response()
    clear_session_cookie(clear_response, settings)

    set_header = header_for(set_response, SESSION_COOKIE)
    clear_header = header_for(clear_response, SESSION_COOKIE)

    assert "Domain=.example.com" in clear_header
    assert "Secure" in clear_header
    assert "Path=/" in clear_header
    assert "Max-Age=0" in clear_header
    for attribute in ("Domain=.example.com", "Secure", "Path=/"):
        assert attribute in set_header


def test_clearing_the_oauth_cookie_matches_the_production_attributes() -> None:
    settings = settings_for("production", ".example.com")
    clear_response = Response()
    clear_oauth_cookie(clear_response, settings)

    clear_header = header_for(clear_response, OAUTH_COOKIE)

    assert "Domain=.example.com" in clear_header
    assert "Secure" in clear_header
    assert "Path=/v1/auth" in clear_header


def test_session_cookie_lifetime_follows_session_lifetime() -> None:
    response = Response()
    set_session_cookie(response, "tok", settings_for("local"))

    header = header_for(response, SESSION_COOKIE)

    # The literal matters. Asserting only against SESSION_LIFETIME would be
    # self-satisfying, because set_session_cookie derives the max age from the
    # same constant, so a changed value would move both sides together.
    assert "Max-Age=604800" in header
    assert f"Max-Age={int(SESSION_LIFETIME.total_seconds())}" in header
```

`SESSION_LIFETIME` comes from `app.auth.sessions`; add it to that test file's imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_auth_cookies.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.auth.cookies'`

- [ ] **Step 3: Implement the cookie helpers**

Create `api/app/auth/cookies.py`:

```python
from fastapi import Response

from app.auth.sessions import SESSION_LIFETIME
from app.config import Settings

SESSION_COOKIE = "msm_session"
OAUTH_COOKIE = "msm_oauth"
OAUTH_COOKIE_PATH = "/v1/auth"
OAUTH_COOKIE_MAX_AGE = 600

# Both halves come from secrets.token_urlsafe, whose alphabet excludes ".",
# so a single dot is an unambiguous separator and avoids encoding JSON.
_SEPARATOR = "."


def _domain(settings: Settings) -> str | None:
    return settings.session_cookie_domain or None


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        domain=_domain(settings),
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        domain=_domain(settings),
        path="/",
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
    )


def set_oauth_cookie(response: Response, state: str, verifier: str, settings: Settings) -> None:
    """Hold the CSRF state and the PKCE verifier for one login attempt.

    Not signed. The protection is a double submit comparison: state binds the
    callback to the browser that began the flow, and an attacker who tampers
    still needs a Google authorization matching the value they chose.
    """
    response.set_cookie(
        OAUTH_COOKIE,
        f"{state}{_SEPARATOR}{verifier}",
        max_age=OAUTH_COOKIE_MAX_AGE,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        domain=_domain(settings),
        path=OAUTH_COOKIE_PATH,
    )


def read_oauth_cookie(raw: str | None) -> tuple[str, str] | None:
    if not raw:
        return None
    parts = raw.split(_SEPARATOR)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1]


def clear_oauth_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        OAUTH_COOKIE,
        domain=_domain(settings),
        path=OAUTH_COOKIE_PATH,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && uv run pytest tests/test_auth_cookies.py -v`
Expected: 10 passed (7 named tests, one of which is parametrized four ways).

- [ ] **Step 5: Run lint and the full suite**

Run: `make lint && make test`
Expected: no lint errors.

- [ ] **Step 6: Commit**

```bash
git add api/app/auth/cookies.py api/tests/test_auth_cookies.py
git commit -m "feat(api): add session and OAuth cookie helpers

Secure and Domain differ by environment and a local run never exercises the
production values, so both are asserted directly on the Set-Cookie header."
```

---

### Task 5: The Google boundary

**Files:**
- Create: `api/app/auth/google.py`
- Test: `api/tests/test_auth_google.py`

**Interfaces:**
- Consumes: `app.config.Settings`, `get_settings`.
- Produces, all in `app.auth.google`:
  - `GoogleIdentity` frozen dataclass with `sub: str`, `email: str`, `email_verified: bool`, `name: str | None`
  - `GoogleAuthError(Exception)`
  - `GoogleOAuthClient` Protocol with `authorization_url(self, state: str, code_challenge: str) -> str` and `exchange_code(self, code: str, verifier: str) -> GoogleIdentity`
  - `AuthlibGoogleClient` implementing it
  - `get_google_client() -> GoogleOAuthClient` FastAPI dependency
  - `pkce_challenge(verifier: str) -> str`

- [ ] **Step 0: Declare joserfc explicitly**

```bash
cd api && uv add joserfc
```

`joserfc` is already installed as one of Authlib's own dependencies, so this
adds no new package to the environment. Declaring it directly is still right:
this module imports it, and depending on a transitive dependency means a future
Authlib release could drop it and break the build with no signal.

The reason this module uses `joserfc` rather than `authlib.jose`: importing
`authlib.jose` emits `AuthlibDeprecationWarning`, which would put a warning in
every test run, and the module is slated for removal in Authlib 2.0. `joserfc`
is the replacement Authlib itself points at.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_auth_google.py`:

```python
import base64
import hashlib
from urllib.parse import parse_qs, urlparse

from app.auth.google import AuthlibGoogleClient, GoogleIdentity, pkce_challenge
from app.config import Settings


def settings_for() -> Settings:
    return Settings(
        database_url="postgresql+psycopg://u:p@localhost:5433/db",
        cors_origins="",
        environment="local",
        google_client_id="the-client-id",
        google_client_secret="the-secret",
        google_redirect_uri="http://testserver/v1/auth/google/callback",
        app_url="http://testserver",
    )


def test_pkce_challenge_is_unpadded_base64url_sha256() -> None:
    verifier = "abc123"
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )

    assert pkce_challenge(verifier) == expected
    assert "=" not in pkce_challenge(verifier)


def test_authorization_url_carries_state_challenge_and_scopes() -> None:
    client = AuthlibGoogleClient(settings_for())

    url = client.authorization_url("the-state", "the-challenge")
    query = parse_qs(urlparse(url).query)

    assert query["state"] == ["the-state"]
    assert query["code_challenge"] == ["the-challenge"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["client_id"] == ["the-client-id"]
    assert query["redirect_uri"] == ["http://testserver/v1/auth/google/callback"]
    assert set(query["scope"][0].split()) == {"openid", "email", "profile"}


def test_authorization_url_never_contains_the_client_secret() -> None:
    client = AuthlibGoogleClient(settings_for())

    assert "the-secret" not in client.authorization_url("s", "c")


def test_google_identity_is_immutable() -> None:
    identity = GoogleIdentity(sub="s", email="e@example.com", email_verified=True, name=None)

    try:
        identity.sub = "other"  # type: ignore[misc]
    except Exception:
        return
    raise AssertionError("GoogleIdentity should be frozen")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_auth_google.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.auth.google'`

- [ ] **Step 3: Implement the Google boundary**

Create `api/app/auth/google.py`:

```python
import base64
import hashlib
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx
from joserfc import jwt
from joserfc.errors import JoseError
from joserfc.jwk import KeySet
from joserfc.jwt import JWTClaimsRegistry

from app.config import Settings, get_settings

# Google's endpoints are stable and documented. Hardcoding them avoids a
# discovery request on every login for values that have not changed in years.
AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs"
VALID_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
SCOPES = "openid email profile"
_JWKS_TTL_SECONDS = 3600


class GoogleAuthError(Exception):
    """The exchange failed, or the identity Google returned is not usable."""


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    name: str | None


class GoogleOAuthClient(Protocol):
    def authorization_url(self, state: str, code_challenge: str) -> str: ...

    def exchange_code(self, code: str, verifier: str) -> GoogleIdentity: ...


def _is_verified(claims: dict[str, Any]) -> bool:
    """Identity comparison, not truthiness.

    bool("false") is True, and this claim decides whether a stranger gets an
    account on an open registration instance. Anything other than a genuine
    JSON true counts as unverified.
    """
    return claims.get("email_verified") is True


def pkce_challenge(verifier: str) -> str:
    """S256 challenge: unpadded base64url of the verifier's SHA-256."""
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


class GoogleClient:
    """Real Google client.

    Kept behind GoogleOAuthClient so tests inject a fake and the suite never
    reaches the network, the same shape ADR 002 uses for KeyProvider.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._jwks: KeySet | None = None
        self._jwks_fetched_at = 0.0

    def authorization_url(self, state: str, code_challenge: str) -> str:
        query = urlencode(
            {
                "client_id": self._settings.google_client_id,
                "redirect_uri": self._settings.google_redirect_uri,
                "response_type": "code",
                "scope": SCOPES,
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "access_type": "online",
                "prompt": "select_account",
            }
        )
        return f"{AUTHORIZE_ENDPOINT}?{query}"

    def exchange_code(self, code: str, verifier: str) -> GoogleIdentity:
        try:
            response = httpx.post(
                TOKEN_ENDPOINT,
                data={
                    "code": code,
                    "client_id": self._settings.google_client_id,
                    "client_secret": self._settings.google_client_secret,
                    "redirect_uri": self._settings.google_redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": verifier,
                },
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            raise GoogleAuthError("token endpoint unreachable") from exc

        if response.status_code != 200:
            # Never include the body: it can echo the client secret back.
            raise GoogleAuthError(f"token endpoint returned {response.status_code}")

        id_token = response.json().get("id_token")
        if not id_token:
            raise GoogleAuthError("token response carried no id_token")

        claims = self._verify_id_token(id_token)
        return GoogleIdentity(
            sub=str(claims["sub"]),
            email=str(claims.get("email", "")),
            email_verified=_is_verified(claims),
            name=claims.get("name"),
        )

    def _key_set(self) -> KeySet:
        now = time.monotonic()
        if self._jwks is None or now - self._jwks_fetched_at > _JWKS_TTL_SECONDS:
            try:
                keys = httpx.get(JWKS_ENDPOINT, timeout=10.0).json()
            except httpx.HTTPError as exc:
                raise GoogleAuthError("jwks endpoint unreachable") from exc
            self._jwks = KeySet.import_key_set(keys)
            self._jwks_fetched_at = now
        return self._jwks

    def _verify_id_token(self, id_token: str) -> dict[str, Any]:
        """Verify the signature, then the claims.

        Signature first: an unverified token's claims are attacker controlled,
        so validating them before checking the signature would be validating
        whatever the attacker wrote.
        """
        try:
            token = jwt.decode(id_token, self._key_set(), algorithms=["RS256"])
        except JoseError as exc:
            raise GoogleAuthError("id_token failed signature verification") from exc

        registry = JWTClaimsRegistry(
            iss={"essential": True, "values": sorted(VALID_ISSUERS)},
            aud={"essential": True, "value": self._settings.google_client_id},
            exp={"essential": True},
            sub={"essential": True},
        )
        try:
            registry.validate(token.claims)
        except JoseError as exc:
            raise GoogleAuthError("id_token claims failed validation") from exc

        return dict(token.claims)


@lru_cache(maxsize=1)
def get_google_client() -> GoogleOAuthClient:
    # get_settings is itself lru_cache(maxsize=1), so the settings object is
    # already process lifetime and caching the client changes nothing about
    # that. Without this the JWKS cache resets on every dependency resolution,
    # making every login fetch Google's keys again. Caching does not affect
    # dependency_overrides, which replaces the callable by identity.
    return GoogleClient(get_settings())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && uv run pytest tests/test_auth_google.py -v`
Expected: 4 passed.

- [ ] **Step 5: Run lint and the full suite**

Run: `make lint && make test`
Expected: no lint errors. If mypy objects to `claims.get(...)` returning `Any`, keep the explicit `str(...)` and `bool(...)` conversions already present rather than adding `type: ignore`.

- [ ] **Step 6: Commit**

```bash
git add api/app/auth/google.py api/tests/test_auth_google.py
git commit -m "feat(api): add the Google OAuth boundary

The protocol keeps the network out of the test suite, mirroring the
KeyProvider shape ADR 002 already uses. The token endpoint's response body is
never included in an error, because it can echo the client secret back."
```

---

### Task 6: The current_user dependency and GET /v1/auth/me

**Files:**
- Create: `api/app/auth/dependencies.py`
- Create: `api/app/routers/auth.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_auth_me.py`
- Modify: `api/tests/conftest.py`

**Interfaces:**
- Consumes: `app.auth.sessions.lookup_session_user`, `app.auth.cookies.SESSION_COOKIE`, `app.db.get_db`, `app.envelope.ApiError`, `app.models.User`.
- Produces: `app.auth.dependencies.current_user(request, session) -> User`; `app.routers.auth.router` (prefix `/v1/auth`); `MeData` Pydantic model with `id: uuid.UUID`, `email: str`, `name: str | None`. Adds fixtures `client` and `db_session`.

- [ ] **Step 1: Add test fixtures**

Append to `api/tests/conftest.py`:

```python
@pytest.fixture
def client(migrated_engine: Engine) -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def db_session(migrated_engine: Engine) -> Iterator[SQLSession]:
    with SQLSession(migrated_engine) as session:
        yield session
```

Add to `conftest.py`'s imports:

```python
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as SQLSession
```

- [ ] **Step 2: Write the failing test**

Create `api/tests/test_auth_me.py`:

```python
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import create_session
from app.models import User

UNAUTHENTICATED_BODY = {
    "ok": False,
    "error": {"code": "UNAUTHENTICATED", "message": "Authentication is required."},
}


def seed_user_and_token(session: Session, sub: str) -> tuple[User, str]:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    token, _ = create_session(session, user)
    session.commit()
    return user, token


def test_me_returns_the_current_user(client: TestClient, db_session: Session) -> None:
    user, token = seed_user_and_token(db_session, "me-ok")
    client.cookies.set(SESSION_COOKIE, token)

    response = client.get("/v1/auth/me")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["email"] == user.email
    assert body["data"]["id"] == str(user.id)


def test_me_without_a_cookie_is_unauthenticated(client: TestClient) -> None:
    response = client.get("/v1/auth/me")

    assert response.status_code == 401
    assert response.json() == UNAUTHENTICATED_BODY


def test_me_with_an_unknown_token_is_unauthenticated(client: TestClient) -> None:
    client.cookies.set(SESSION_COOKIE, "not-a-real-token")

    response = client.get("/v1/auth/me")

    assert response.status_code == 401
    assert response.json() == UNAUTHENTICATED_BODY


def test_me_with_an_expired_session_is_unauthenticated(
    client: TestClient, db_session: Session
) -> None:
    user = User(google_sub="me-expired", email="e@example.com")
    db_session.add(user)
    db_session.flush()
    token, row = create_session(db_session, user)
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()
    client.cookies.set(SESSION_COOKIE, token)

    response = client.get("/v1/auth/me")

    assert response.status_code == 401
    assert response.json() == UNAUTHENTICATED_BODY


def test_a_token_never_resolves_to_a_different_user(
    client: TestClient, db_session: Session
) -> None:
    _, mine = seed_user_and_token(db_session, "iso-mine")
    other, _ = seed_user_and_token(db_session, "iso-other")
    client.cookies.set(SESSION_COOKIE, mine)

    response = client.get("/v1/auth/me")

    assert response.json()["data"]["email"] != other.email
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_auth_me.py -v`
Expected: FAIL with 404 on `/v1/auth/me`, because the router does not exist.

- [ ] **Step 4: Implement the dependency**

Create `api/app/auth/dependencies.py`:

```python
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import lookup_session_user
from app.db import get_db
from app.envelope import ApiError
from app.models import User

UNAUTHENTICATED_MESSAGE = "Authentication is required."


def current_user(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> User:
    """Resolve the caller, or refuse.

    A missing cookie, an unknown token, and an expired session all produce the
    same response, so the endpoint never reveals whether a token existed.
    """
    token = request.cookies.get(SESSION_COOKIE)
    user = lookup_session_user(session, token) if token else None
    if user is None:
        raise ApiError("UNAUTHENTICATED", UNAUTHENTICATED_MESSAGE, status_code=401)
    return user


CurrentUser = Annotated[User, Depends(current_user)]
```

- [ ] **Step 5: Create the auth router with /me**

Create `api/app/routers/auth.py`:

```python
import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from app.auth.dependencies import CurrentUser
from app.envelope import Err, Ok

# Endpoints a browser navigates to redirect on failure; endpoints JavaScript
# calls return the ADR 002 envelope. /me and /logout are the second kind.
# Tasks that add /google/start and /google/callback add the first kind.
router = APIRouter(prefix="/v1/auth", tags=["auth"])


class MeData(BaseModel):
    id: uuid.UUID
    email: str
    name: str | None


@router.get("/me", response_model=Ok[MeData], responses={401: {"model": Err}})
def me(user: CurrentUser) -> Ok[MeData]:
    return Ok(data=MeData(id=user.id, email=user.email, name=user.name))
```

- [ ] **Step 6: Register the router**

In `api/app/main.py`, change the routers import and the registration:

```python
from app.routers import auth, health
```

and, after `application.include_router(health.router)`:

```python
    application.include_router(auth.router)
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd api && uv run pytest tests/test_auth_me.py -v`
Expected: 5 passed.

- [ ] **Step 8: Regenerate the API types**

`MeData` is a new response model, so the committed TypeScript is now stale and `types-drift` would fail.

Run: `make types`
Expected: `web/src/api/generated.ts` gains `MeData` and `Ok_MeData_`.

- [ ] **Step 9: Run lint and the full suite**

Run: `make lint && make test`
Expected: no lint errors; frontend tests unchanged.

- [ ] **Step 10: Commit**

```bash
git add api/app/auth/dependencies.py api/app/routers/auth.py api/app/main.py api/tests/test_auth_me.py api/tests/conftest.py web/src/api/generated.ts
git commit -m "feat(api): add current_user and GET /v1/auth/me

Missing, unknown, and expired tokens produce an identical response, so the
endpoint never reveals whether a token existed."
```

---

### Task 7: The OAuth login flow

**Files:**
- Modify: `api/app/routers/auth.py`
- Test: `api/tests/test_auth_flow.py`

**Interfaces:**
- Consumes: `app.auth.google.{GoogleOAuthClient, GoogleIdentity, GoogleAuthError, get_google_client, pkce_challenge}`, `app.auth.cookies.*`, `app.auth.sessions.{create_session, purge_expired_sessions}`, `app.models.User`.
- Produces: `GET /v1/auth/google/start` and `GET /v1/auth/google/callback` on the existing router, plus `upsert_user(session, identity) -> User` in `app.routers.auth`.

**Error codes.** Five failure conditions map to four codes, deliberately: `CONSENT_DENIED`; `INVALID_STATE` for both a missing cookie and a mismatch; `EXCHANGE_FAILED` for both a rejection and an unreachable Google; `EMAIL_NOT_VERIFIED`. The client can act on neither collapsed distinction.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_auth_flow.py`:

```python
from collections.abc import Iterator
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.cookies import OAUTH_COOKIE, SESSION_COOKIE
from app.auth.google import GoogleAuthError, GoogleIdentity, get_google_client
from app.main import app
from app.models import User, UserSession


class FakeGoogleClient:
    def __init__(self, identity: GoogleIdentity | None = None, error: Exception | None = None):
        self.identity = identity
        self.error = error

    def authorization_url(self, state: str, code_challenge: str) -> str:
        return f"https://accounts.google.test/auth?state={state}&code_challenge={code_challenge}"

    def exchange_code(self, code: str, verifier: str) -> GoogleIdentity:
        if self.error is not None:
            raise self.error
        assert self.identity is not None
        return self.identity


VERIFIED = GoogleIdentity(
    sub="google-sub-1", email="user@example.com", email_verified=True, name="User One"
)


@pytest.fixture
def fake_google() -> Iterator[FakeGoogleClient]:
    fake = FakeGoogleClient(identity=VERIFIED)
    app.dependency_overrides[get_google_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_google_client, None)


def start_flow(client: TestClient) -> tuple[str, str]:
    """Run /start and return the state and the raw oauth cookie."""
    response = client.get("/v1/auth/google/start", follow_redirects=False)
    assert response.status_code == 307
    state = parse_qs(urlparse(response.headers["location"]).query)["state"][0]
    return state, client.cookies[OAUTH_COOKIE]


def error_code(response: Any) -> str:
    """The response type comes from httpx2 via TestClient, so it is left loose.

    The str() is not decorative: without it mypy strict rejects the return as
    no-any-return, because indexing an Any propagates Any.
    """
    return str(parse_qs(urlparse(response.headers["location"]).query)["error"][0])


def test_start_redirects_to_google_and_sets_the_oauth_cookie(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    response = client.get("/v1/auth/google/start", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"].startswith("https://accounts.google.test/auth")
    assert OAUTH_COOKIE in response.cookies


def test_start_uses_a_fresh_state_each_time(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    first, _ = start_flow(client)
    second, _ = start_flow(client)

    assert first != second


def test_callback_creates_a_user_and_a_session(
    client: TestClient, fake_google: FakeGoogleClient, db_session: Session
) -> None:
    state, _ = start_flow(client)

    response = client.get(
        f"/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
    )

    assert response.status_code == 307
    assert "error=" not in response.headers["location"]
    assert SESSION_COOKIE in response.cookies

    user = db_session.execute(
        select(User).where(User.google_sub == VERIFIED.sub)
    ).scalar_one()
    assert user.email == VERIFIED.email
    sessions = db_session.execute(
        select(UserSession).where(UserSession.user_id == user.id)
    ).scalars().all()
    assert len(sessions) == 1


def test_second_login_reuses_the_user_and_refreshes_a_changed_email(
    client: TestClient, fake_google: FakeGoogleClient, db_session: Session
) -> None:
    state, _ = start_flow(client)
    client.get(f"/v1/auth/google/callback?code=a&state={state}", follow_redirects=False)

    fake_google.identity = GoogleIdentity(
        sub=VERIFIED.sub, email="renamed@example.com", email_verified=True, name="Renamed"
    )
    state, _ = start_flow(client)
    client.get(f"/v1/auth/google/callback?code=b&state={state}", follow_redirects=False)

    users = db_session.execute(
        select(User).where(User.google_sub == VERIFIED.sub)
    ).scalars().all()
    assert len(users) == 1
    db_session.refresh(users[0])
    assert users[0].email == "renamed@example.com"


def test_denied_consent_redirects_with_its_code(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    response = client.get(
        "/v1/auth/google/callback?error=access_denied", follow_redirects=False
    )

    assert error_code(response) == "CONSENT_DENIED"


def test_missing_state_cookie_is_invalid_state(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    response = client.get(
        "/v1/auth/google/callback?code=abc&state=anything", follow_redirects=False
    )

    assert error_code(response) == "INVALID_STATE"


def test_mismatched_state_is_invalid_state(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    start_flow(client)

    response = client.get(
        "/v1/auth/google/callback?code=abc&state=not-the-one", follow_redirects=False
    )

    assert error_code(response) == "INVALID_STATE"


def test_exchange_failure_redirects_with_its_code(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    state, _ = start_flow(client)
    fake_google.error = GoogleAuthError("boom")

    response = client.get(
        f"/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
    )

    assert error_code(response) == "EXCHANGE_FAILED"


def test_unverified_email_is_rejected(
    client: TestClient, fake_google: FakeGoogleClient, db_session: Session
) -> None:
    state, _ = start_flow(client)
    fake_google.identity = GoogleIdentity(
        sub="unverified-sub", email="nope@example.com", email_verified=False, name=None
    )

    response = client.get(
        f"/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
    )

    assert error_code(response) == "EMAIL_NOT_VERIFIED"
    assert (
        db_session.execute(
            select(User).where(User.google_sub == "unverified-sub")
        ).scalar_one_or_none()
        is None
    )


@pytest.mark.parametrize(
    "query",
    [
        "error=access_denied",
        "code=abc&state=wrong",
    ],
)
def test_the_oauth_cookie_is_cleared_on_failure(
    client: TestClient, fake_google: FakeGoogleClient, query: str
) -> None:
    start_flow(client)

    response = client.get(f"/v1/auth/google/callback?{query}", follow_redirects=False)

    cleared = response.headers.get_list("set-cookie")
    assert any(OAUTH_COOKIE in header and "Max-Age=0" in header for header in cleared)


def test_the_oauth_cookie_is_cleared_on_success(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    state, _ = start_flow(client)

    response = client.get(
        f"/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
    )

    cleared = response.headers.get_list("set-cookie")
    assert any(OAUTH_COOKIE in header and "Max-Age=0" in header for header in cleared)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_auth_flow.py -v`
Expected: FAIL with 404, because `/v1/auth/google/start` does not exist.

- [ ] **Step 3: Implement the two endpoints**

Add to `api/app/routers/auth.py`. New imports at the top:

```python
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.cookies import (
    OAUTH_COOKIE,
    clear_oauth_cookie,
    read_oauth_cookie,
    set_oauth_cookie,
    set_session_cookie,
)
from app.auth.google import (
    GoogleAuthError,
    GoogleIdentity,
    GoogleOAuthClient,
    get_google_client,
    pkce_challenge,
)
from app.auth.sessions import create_session, purge_expired_sessions
from app.config import Settings, get_settings
from app.db import get_db
from app.models import User
```

Then append:

```python
_STATE_BYTES = 32
_VERIFIER_BYTES = 64


def upsert_user(session: Session, identity: GoogleIdentity) -> User:
    """Find by google_sub, or create. Email and name are refreshed on login.

    google_sub is the identity because it is stable forever, while an email
    address can change or be reassigned to a different person.
    """
    user = session.execute(
        select(User).where(User.google_sub == identity.sub)
    ).scalar_one_or_none()
    if user is None:
        user = User(google_sub=identity.sub, email=identity.email, name=identity.name)
        session.add(user)
        session.flush()
        return user
    user.email = identity.email
    user.name = identity.name
    return user


@router.get("/google/start", include_in_schema=False)
def google_start(
    settings: Annotated[Settings, Depends(get_settings)],
    google: Annotated[GoogleOAuthClient, Depends(get_google_client)],
) -> RedirectResponse:
    state = secrets.token_urlsafe(_STATE_BYTES)
    verifier = secrets.token_urlsafe(_VERIFIER_BYTES)
    response = RedirectResponse(
        google.authorization_url(state, pkce_challenge(verifier)), status_code=307
    )
    set_oauth_cookie(response, state, verifier, settings)
    return response


@router.get("/google/callback", include_in_schema=False)
def google_callback(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    google: Annotated[GoogleOAuthClient, Depends(get_google_client)],
    session: Annotated[Session, Depends(get_db)],
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> Response:
    """Complete the login.

    A browser navigates here directly, so failures redirect with an error code
    rather than rendering the envelope. A user whose consent screen failed
    should not be looking at JSON in their address bar.
    """

    def fail(reason: str) -> Response:
        response = RedirectResponse(f"{settings.app_url}/login?error={reason}", status_code=307)
        clear_oauth_cookie(response, settings)
        return response

    if error is not None:
        return fail("CONSENT_DENIED")

    stored = read_oauth_cookie(request.cookies.get(OAUTH_COOKIE))
    # Compared as bytes: secrets.compare_digest raises TypeError on str
    # arguments containing non-ASCII characters, and Starlette percent-decodes
    # query params as UTF-8, so ?state=caf%C3%A9 would escape fail() entirely
    # and leave the OAuth cookie set through a 500.
    if (
        stored is None
        or state is None
        or not secrets.compare_digest(stored[0].encode(), state.encode())
    ):
        return fail("INVALID_STATE")

    if code is None:
        return fail("EXCHANGE_FAILED")

    try:
        identity = google.exchange_code(code, stored[1])
    except GoogleAuthError:
        return fail("EXCHANGE_FAILED")

    if not identity.email_verified:
        return fail("EMAIL_NOT_VERIFIED")

    user = upsert_user(session, identity)
    purge_expired_sessions(session, user)
    token, _ = create_session(session, user)
    session.commit()

    response = RedirectResponse(settings.app_url, status_code=307)
    set_session_cookie(response, token, settings)
    clear_oauth_cookie(response, settings)
    return response
```

`include_in_schema=False` on both: they are browser navigation endpoints that return redirects, so they contribute nothing useful to the OpenAPI document and would generate TypeScript types no client calls.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && uv run pytest tests/test_auth_flow.py -v`
Expected: 12 passed (11 named tests, one parametrized twice).

- [ ] **Step 5: Verify the types did not drift**

Both endpoints are `include_in_schema=False`, so the OpenAPI document should be unchanged.

Run: `make types && git diff --exit-code -- web/src/api/generated.ts`
Expected: no diff. If there is one, commit it.

- [ ] **Step 6: Run lint and the full suite**

Run: `make lint && make test`
Expected: no lint errors.

- [ ] **Step 7: Commit**

```bash
git add api/app/routers/auth.py api/tests/test_auth_flow.py
git commit -m "feat(api): add the Google OAuth login flow

State plus PKCE in a short lived cookie, compared with compare_digest. Five
failure conditions map to four codes, and every exit path clears the oauth
cookie so a stale verifier never lingers."
```

---

### Task 8: Logout

**Files:**
- Modify: `api/app/routers/auth.py`
- Test: `api/tests/test_auth_logout.py`

**Interfaces:**
- Consumes: `app.auth.sessions.delete_session`, `app.auth.cookies.{SESSION_COOKIE, clear_session_cookie}`.
- Produces: `POST /v1/auth/logout` returning `Ok[LogoutData]`, and `LogoutData` with a single field `signed_out: bool`.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_auth_logout.py`:

```python
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import create_session, hash_token
from app.models import User, UserSession


def seed(session: Session, sub: str) -> str:
    user = User(google_sub=sub, email=f"{sub}@example.com")
    session.add(user)
    session.flush()
    token, _ = create_session(session, user)
    session.commit()
    return token


def test_logout_deletes_the_session_row(client: TestClient, db_session: Session) -> None:
    token = seed(db_session, "logout-1")
    client.cookies.set(SESSION_COOKIE, token)

    response = client.post("/v1/auth/logout")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "data": {"signed_out": True}}
    assert (
        db_session.execute(
            select(UserSession).where(UserSession.token_hash == hash_token(token))
        ).scalar_one_or_none()
        is None
    )


def test_logout_clears_the_cookie(client: TestClient, db_session: Session) -> None:
    token = seed(db_session, "logout-2")
    client.cookies.set(SESSION_COOKIE, token)

    response = client.post("/v1/auth/logout")

    headers = response.headers.get_list("set-cookie")
    assert any(SESSION_COOKIE in header and "Max-Age=0" in header for header in headers)


def test_logout_without_a_session_still_succeeds(client: TestClient) -> None:
    response = client.post("/v1/auth/logout")

    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_logout_twice_still_succeeds(client: TestClient, db_session: Session) -> None:
    token = seed(db_session, "logout-3")
    client.cookies.set(SESSION_COOKIE, token)

    client.post("/v1/auth/logout")
    client.cookies.set(SESSION_COOKIE, token)
    second = client.post("/v1/auth/logout")

    assert second.status_code == 200
    assert second.json()["ok"] is True


def test_logout_leaves_other_sessions_alone(client: TestClient, db_session: Session) -> None:
    mine = seed(db_session, "logout-mine")
    theirs = seed(db_session, "logout-theirs")
    client.cookies.set(SESSION_COOKIE, mine)

    client.post("/v1/auth/logout")

    assert (
        db_session.execute(
            select(UserSession).where(UserSession.token_hash == hash_token(theirs))
        ).scalar_one_or_none()
        is not None
    )
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_auth_logout.py -v`
Expected: FAIL with 405 or 404, because the route does not exist.

- [ ] **Step 3: Implement logout**

Add to `api/app/routers/auth.py`'s imports:

```python
from app.auth.cookies import SESSION_COOKIE, clear_session_cookie
from app.auth.sessions import delete_session
```

Merge these into the existing `app.auth.cookies` and `app.auth.sessions` import lines rather than adding duplicates.

Then append:

```python
class LogoutData(BaseModel):
    signed_out: bool


@router.post("/logout", response_model=Ok[LogoutData])
def logout(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_db)],
) -> Ok[LogoutData]:
    """Destroy the session.

    Succeeds even when nothing matched. Reporting whether a session existed
    would answer a question the caller has no business asking, and there is
    nothing useful for a client to do differently either way.
    """
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        delete_session(session, token)
        session.commit()
    clear_session_cookie(response, settings)
    return Ok(data=LogoutData(signed_out=True))
```

Note this route takes `response: Response` as a parameter rather than returning one, because it returns the envelope through `response_model` while still needing to set a header.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && uv run pytest tests/test_auth_logout.py -v`
Expected: 5 passed.

- [ ] **Step 5: Regenerate types**

`LogoutData` is a new response model.

Run: `make types`
Expected: `generated.ts` gains `LogoutData` and `Ok_LogoutData_`.

- [ ] **Step 6: Run lint and the full suite**

Run: `make lint && make test`
Expected: no lint errors.

- [ ] **Step 7: Commit**

```bash
git add api/app/routers/auth.py api/tests/test_auth_logout.py web/src/api/generated.ts
git commit -m "feat(api): add POST /v1/auth/logout

Idempotent by design: reporting whether a session existed answers a question
the caller has no business asking."
```

---

### Task 9: Documentation and acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/adr/0002-backend-architecture-cryptography-and-auth.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Document the auth setup in the README**

Add a section after "Local development":

````markdown
## Authentication

Google OAuth with server side sessions. The backend performs the code
exchange; the frontend never sees a Google token.

To run login locally you need a Google OAuth client:

1. In the Google Cloud console, create an OAuth 2.0 Client ID of type **Web
   application**.
2. Add two authorized redirect URIs to the same client:
   - `http://localhost:8000/v1/auth/google/callback`
   - `https://api.<domain>/v1/auth/google/callback`

   Google permits plain `http` for `localhost` specifically, so no tunnel or
   self signed certificate is needed.
3. Copy the client id and secret into `.env`.

The redirect URI is configuration rather than something derived from the
request `Host` header. Deriving it is how open redirect bugs start.

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
first login. Cross user isolation is therefore load bearing, not theoretical.
````

- [ ] **Step 2: Record what SP2 settled in ADR 002**

Append a short amendment:

```markdown
### A13. SP2 outcomes

Session lifetime, the cookie names, and the error codes are now fixed by
implementation: `msm_session` and `msm_oauth`, seven day absolute expiry, and
four callback error codes: `CONSENT_DENIED`, `INVALID_STATE` for a missing
cookie or a mismatch, `EXCHANGE_FAILED` for a missing code and for a rejection
or an unreachable Google, and `EMAIL_NOT_VERIFIED`. Distinct conditions
deliberately share a code, because a browser can do nothing different with the
distinction.
The Google interaction sits behind a `GoogleOAuthClient` protocol so the test
suite performs no network I/O.
```

- [ ] **Step 3: Walk the acceptance criteria**

Confirm each item from the spec against the suite:

| # | Criterion | Covered by |
|---|---|---|
| 1 | First login creates one `users` row and one `sessions` row and sets `msm_session` | `test_callback_creates_a_user_and_a_session` |
| 2 | Second login creates no new user and updates a changed email | `test_second_login_reuses_the_user_and_refreshes_a_changed_email` |
| 3 | Every callback failure condition redirects with one of the four codes and clears `msm_oauth`. Do not assert a count: conditions share codes and counting sub-conditions is ambiguous | `test_auth_flow.py`, the failure tests plus the two clearing tests |
| 4 | `/v1/auth/me` returns the user; missing, unknown, and expired all give an identical 401 | `test_auth_me.py` |
| 5 | Logout deletes the row and is idempotent | `test_auth_logout.py` |
| 6 | `Secure` set under production and not locally | `test_auth_cookies.py` |
| 7 | No test performs network I/O | The Google client is faked in every test that would otherwise reach out |
8. `make lint` and `make test` pass, mypy strict covers the new modules
9. The plaintext token appears in no log line and no response body other than `Set-Cookie`

- [ ] **Step 4: Verify criterion 9 directly**

Run:

```bash
cd api && uv run pytest -q 2>&1 | grep -iE "msm_session=[A-Za-z0-9_-]{20,}" && echo "TOKEN LEAKED IN OUTPUT" || echo "no token in test output"
```

Expected: `no token in test output`.

- [ ] **Step 5: Run the full verification**

Run: `make lint && make test && make types && git diff --exit-code -- web/src/api/generated.ts`
Expected: everything passes and there is no type drift.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/adr/0002-backend-architecture-cryptography-and-auth.md
git commit -m "docs: document Google OAuth setup and record SP2 outcomes"
```

---

## What SP2 deliberately leaves undone

| Deferred to | Items |
|---|---|
| **SP2b** | The login screen, rendering the four error codes, the authenticated shell |
| **SP3** | API keys and their prefix (ADR 002 A8), buckets, secrets, envelope encryption, `SECRETS_KEK` |
| **SP4** | Audit logging, per key rate limiting, security headers, the threat model in the README |
| **Later** | Sliding session expiry, a sessions list UI, `avatar_url`, closing registration to an allowlist |
