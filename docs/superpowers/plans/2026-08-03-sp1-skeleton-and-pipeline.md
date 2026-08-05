# SP1: Skeleton and Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the complete deployment and integration path — browser on Vercel → generated TypeScript client → FastAPI on Fly → Neon Postgres — with CI gating every step and no domain logic anywhere in it.

**Architecture:** A single repository with `api/` (FastAPI, synchronous SQLAlchemy, Alembic) and `web/` (Vite, React 19, TanStack Query), joined by a type pipeline that dumps the OpenAPI schema offline and compiles it to committed TypeScript. The only endpoint is `GET /v1/health`, which executes `SELECT 1`. The only migration is an empty baseline whose purpose is to prove Alembic runs in Fly's release step.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.x (sync), psycopg3, Alembic, pydantic-settings, uv, pytest, testcontainers, ruff, mypy. React 19, Vite, TypeScript strict, Tailwind, React Router v7, TanStack Query, Vitest, React Testing Library, MSW, openapi-typescript. Docker, Fly.io, Vercel, Neon, GitHub Actions.

## Global Constraints

Every task's requirements implicitly include this section.

- **Python `>=3.12`.** React `19.x`. TypeScript `strict: true`, no `any` in committed code.
- **SQLAlchemy is synchronous.** Routes are `def`, never `async def`. Driver is psycopg3, URL scheme `postgresql+psycopg://`. (ADR 002 A1)
- **The engine must use `poolclass=NullPool`.** Neon's pooled endpoint already runs PgBouncer. (ADR 002)
- **Response envelope is fixed:** `{"ok": true, "data": ...}` and `{"ok": false, "error": {"code": "...", "message": "..."}}`. It is modelled in Pydantic, never constructed ad hoc, because these models drive the OpenAPI schema. (ADR 002)
- **No domain tables.** The baseline Alembic revision is empty. SP2 owns the first real schema.
- **No authentication, no cryptography.** `GET /v1/health` is public. `SECRETS_KEK` is not set anywhere in SP1.
- **Do not install Zustand, Zod, or React Hook Form.** SP1 has no client state and no forms. (ADR 003 A5)
- **Do not create `web/src/stores/`, `web/src/components/`, or `web/src/lib/`.** They arrive with their first file.
- **`web/src/api/generated.ts` is generated and committed. Never hand-edit it.**
- **Envelope narrowing happens exactly once, in `web/src/api/client.ts`.** No `ok` checks in hooks or components. (ADR 003 A1)
- **Commit messages use commitizen format:** `type(scope): subject`. (ADR 001)
- **The domain is unchosen.** Use the literal placeholder `<domain>` in documentation and real values only in untracked config. Tasks 1–11 do not depend on it; Task 12 does.
- **CORS:** `allow_credentials=True` with an explicit origin list. Never a wildcard — the two are incompatible in browsers, and SP2's session cookie depends on this.

---

### Task 1: Python project scaffold, settings, and database session

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `Makefile`
- Create: `api/pyproject.toml`
- Create: `api/app/__init__.py`
- Create: `api/app/config.py`
- Create: `api/app/db.py`
- Test: `api/tests/__init__.py`
- Test: `api/tests/conftest.py`
- Test: `api/tests/test_config.py`
- Test: `api/tests/test_db.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `app.config.Settings` with fields `database_url: str`, `cors_origins: str`, `environment: str`, and property `cors_origin_list -> list[str]`; `app.config.get_settings() -> Settings` (lru_cached). `app.db.Base` (DeclarativeBase subclass); `app.db.create_db_engine(database_url: str) -> Engine`; `app.db.get_engine() -> Engine` (lru_cached); `app.db.get_db() -> Iterator[Session]`. Pytest fixtures `postgres_url` (session-scoped `str`).

- [ ] **Step 1: Create the repository ignore file**

Create `.gitignore`:

```gitignore
# Python
__pycache__/
*.py[cod]
.venv/
.pytest_cache/
.mypy_cache/
.ruff_cache/

# Node
node_modules/
dist/
.vite/

# Environment
.env
.env.local

# Generated intermediates
/openapi.json

# OS / editor
.DS_Store
```

- [ ] **Step 2: Create the example environment file**

Create `.env.example`:

```bash
# Copy to .env for local development. .env is gitignored.
DATABASE_URL=postgresql+psycopg://secretbox:secretbox@localhost:5433/secretbox
CORS_ORIGINS=http://localhost:5173
ENVIRONMENT=local
```

Note the port is **5433**, not 5432, so the Compose database does not collide with a Postgres already running on the host.

- [ ] **Step 3: Create the Compose file for local Postgres**

Compose runs Postgres only. The API runs on the host under `uvicorn --reload`, because containerising it during development costs a rebuild or bind mount per edit and the Dockerfile is already exercised by CI and Fly. (ADR 001 A7)

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: secretbox
      POSTGRES_PASSWORD: secretbox
      POSTGRES_DB: secretbox
    ports:
      - "5433:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U secretbox"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres-data:
```

- [ ] **Step 4: Create the Python project definition**

Create `api/pyproject.toml`:

```toml
[project]
name = "secretbox-api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "sqlalchemy>=2.0",
    "psycopg[binary]>=3.2",
    "alembic>=1.14",
    "pydantic>=2.9",
    "pydantic-settings>=2.6",
]

[dependency-groups]
dev = [
    "pytest>=8.3",
    "httpx>=0.28",
    "testcontainers[postgres]>=4.8",
    "hypothesis>=6.112",
    "ruff>=0.8",
    "mypy>=1.13",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["app"]

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "N", "UP", "B", "SIM"]

[tool.mypy]
python_version = "3.12"
strict = true
plugins = ["pydantic.mypy"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 5: Install dependencies and confirm the lockfile is created**

```bash
cd api && uv sync
```

Expected: `api/uv.lock` exists and `api/.venv/` is populated.

- [ ] **Step 6: Write the failing settings test**

Create `api/tests/__init__.py` as an empty file, then create `api/tests/test_config.py`:

```python
from app.config import Settings


def test_settings_read_from_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    monkeypatch.setenv("ENVIRONMENT", "production")

    settings = Settings()

    assert settings.database_url == "postgresql+psycopg://u:p@localhost:5433/db"
    assert settings.environment == "production"


def test_cors_origin_list_splits_and_strips(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("CORS_ORIGINS", " https://a.example.com , https://b.example.com ")

    assert Settings().cors_origin_list == [
        "https://a.example.com",
        "https://b.example.com",
    ]


def test_cors_origin_list_is_empty_when_unset(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("CORS_ORIGINS", "")

    assert Settings().cors_origin_list == []
```

- [ ] **Step 7: Run the settings test to verify it fails**

Run: `cd api && uv run pytest tests/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.config'`

- [ ] **Step 8: Implement settings**

Create `api/app/__init__.py` as an empty file, then create `api/app/config.py`:

```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, read from the environment.

    SECRETS_KEK is deliberately absent in SP1. Nothing decrypts yet, and an
    unvalidated secret sitting in Fly that no code reads is a configuration
    error nobody would notice. SP3 introduces it with a startup check.
    """

    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    cors_origins: str = ""
    environment: str = "local"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 9: Run the settings test to verify it passes**

Run: `cd api && uv run pytest tests/test_config.py -v`
Expected: 3 passed

- [ ] **Step 10: Write the failing database test**

Create `api/tests/conftest.py`:

```python
import os
from collections.abc import Iterator

import pytest
from testcontainers.community.postgres import PostgresContainer

# app.main builds the FastAPI app at import time, which validates Settings.
# Test modules import it at module scope, so these must be set before pytest
# collects them. The postgres_url fixture overwrites DATABASE_URL with the real
# container URL and clears the cached settings and engine.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://placeholder/placeholder")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
os.environ.setdefault("ENVIRONMENT", "test")


@pytest.fixture(scope="session")
def postgres_url() -> Iterator[str]:
    """A real Postgres for the whole test session.

    ADR 002 requires a real database rather than SQLite, because database
    behaviour differences matter in this project.
    """
    with PostgresContainer("postgres:17-alpine", driver="psycopg") as container:
        url = container.get_connection_url()
        os.environ["DATABASE_URL"] = url
        os.environ["CORS_ORIGINS"] = "http://localhost:5173"
        os.environ["ENVIRONMENT"] = "test"
        yield url


@pytest.fixture(scope="session", autouse=True)
def _reset_caches(postgres_url: str) -> Iterator[None]:
    from app.config import get_settings
    from app.db import get_engine

    get_settings.cache_clear()
    get_engine.cache_clear()
    yield
    get_settings.cache_clear()
    get_engine.cache_clear()
```

Create `api/tests/test_db.py`:

```python
from sqlalchemy import text
from sqlalchemy.pool import NullPool

from app.db import create_db_engine, get_db


def test_engine_uses_nullpool(postgres_url: str) -> None:
    """Neon's pooled endpoint already runs PgBouncer; pooling on top of a
    pooler causes connection accounting problems. (ADR 002)"""
    engine = create_db_engine(postgres_url)

    assert isinstance(engine.pool, NullPool)


def test_get_db_yields_a_usable_session(postgres_url: str) -> None:
    sessions = get_db()
    session = next(sessions)
    try:
        assert session.execute(text("SELECT 1")).scalar_one() == 1
    finally:
        sessions.close()
```

- [ ] **Step 11: Run the database test to verify it fails**

Run: `cd api && uv run pytest tests/test_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.db'`

- [ ] **Step 12: Implement the database module**

Create `api/app/db.py`:

```python
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy.pool import NullPool

from app.config import get_settings


class Base(DeclarativeBase):
    """Declarative base. No models in SP1; SP2 adds the first ones.

    Declared here so Alembic's env.py can point target_metadata at it without
    being rewritten later.
    """


def create_db_engine(database_url: str) -> Engine:
    return create_engine(database_url, poolclass=NullPool, future=True)


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    return create_db_engine(get_settings().database_url)


def get_db() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
```

- [ ] **Step 13: Run the database test to verify it passes**

Run: `cd api && uv run pytest tests/test_db.py -v`
Expected: 2 passed. The first run pulls the `postgres:17-alpine` image, so allow up to a minute.

- [ ] **Step 14: Create the Makefile**

Targets are added by later tasks as their capabilities land. Create `Makefile`:

```make
.DEFAULT_GOAL := help
.PHONY: help db-up db-down test lint

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

db-up: ## Start local Postgres
	docker compose up -d --wait postgres

db-down: ## Stop local Postgres
	docker compose down

test: ## Run backend tests
	cd api && uv run pytest

lint: ## Run backend linters
	cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy app
```

- [ ] **Step 15: Verify lint and tests pass through the Makefile**

Run: `make lint && make test`
Expected: ruff, ruff format, and mypy report no errors; 5 tests pass.

If `ruff format --check` fails, run `cd api && uv run ruff format .` and re-run.

- [ ] **Step 16: Commit**

```bash
git add .gitignore .env.example docker-compose.yml Makefile api/
git commit -m "feat(api): scaffold project with settings and database session

Sync SQLAlchemy with psycopg3 per ADR 002 A1, NullPool per ADR 002.
Compose runs Postgres only per ADR 001 A7."
```

---

### Task 2: Response envelope and error handling

**Files:**
- Create: `api/app/envelope.py`
- Test: `api/tests/test_envelope.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `app.envelope.Ok[T]` (Pydantic generic, fields `ok: Literal[True]`, `data: T`); `app.envelope.ErrorBody` (fields `code: str`, `message: str`); `app.envelope.Err` (fields `ok: Literal[False]`, `error: ErrorBody`); `app.envelope.ApiError(code: str, message: str, status_code: int = 400)` exception with attributes `.code`, `.message`, `.status_code`; `app.envelope.api_error_handler(request: Request, exc: Exception) -> JSONResponse`.

- [ ] **Step 1: Write the failing envelope test**

Create `api/tests/test_envelope.py`:

```python
import pytest
from pydantic import BaseModel

from app.envelope import ApiError, Err, ErrorBody, Ok


class Payload(BaseModel):
    db: str


def test_ok_serialises_with_literal_true() -> None:
    assert Ok[Payload](data=Payload(db="ok")).model_dump() == {
        "ok": True,
        "data": {"db": "ok"},
    }


def test_err_serialises_with_literal_false() -> None:
    body = Err(error=ErrorBody(code="DB_UNAVAILABLE", message="Database is not reachable."))

    assert body.model_dump() == {
        "ok": False,
        "error": {"code": "DB_UNAVAILABLE", "message": "Database is not reachable."},
    }


def test_ok_rejects_a_false_flag() -> None:
    with pytest.raises(ValueError):
        Ok[Payload](ok=False, data=Payload(db="ok"))


def test_api_error_carries_code_message_and_status() -> None:
    error = ApiError("BUCKET_NOT_FOUND", "No such bucket.", status_code=404)

    assert error.code == "BUCKET_NOT_FOUND"
    assert error.message == "No such bucket."
    assert error.status_code == 404
    assert str(error) == "No such bucket."


def test_api_error_defaults_to_400() -> None:
    assert ApiError("BAD_REQUEST", "Nope.").status_code == 400
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_envelope.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.envelope'`

- [ ] **Step 3: Implement the envelope**

Create `api/app/envelope.py`:

```python
from typing import Literal

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class Ok[T](BaseModel):
    """Success arm of the ADR 002 response envelope."""

    ok: Literal[True] = True
    data: T


class ErrorBody(BaseModel):
    code: str
    message: str


class Err(BaseModel):
    """Failure arm of the ADR 002 response envelope."""

    ok: Literal[False] = False
    error: ErrorBody


class ApiError(Exception):
    """An application error that renders as the envelope's failure arm.

    Never put a secret value in `message`. ADR 002 requires that the error
    handler cannot serialise a secret into a response or a stack trace.
    """

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


async def api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return JSONResponse(
        status_code=exc.status_code,
        content=Err(error=ErrorBody(code=exc.code, message=exc.message)).model_dump(),
    )
```

The `assert isinstance` is present because Starlette types exception handlers as accepting `Exception`; mypy strict rejects a narrower signature.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && uv run pytest tests/test_envelope.py -v`
Expected: 5 passed

- [ ] **Step 5: Run lint**

Run: `make lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add api/app/envelope.py api/tests/test_envelope.py
git commit -m "feat(api): add response envelope and ApiError handler

Models both arms of the ADR 002 envelope in Pydantic so they drive the
OpenAPI schema rather than being constructed ad hoc in routes."
```

---

### Task 3: Health endpoint and application assembly

**Files:**
- Create: `api/app/routers/__init__.py`
- Create: `api/app/routers/health.py`
- Create: `api/app/main.py`
- Test: `api/tests/test_health.py`

**Interfaces:**
- Consumes: `app.db.get_db`, `app.config.get_settings`, `app.envelope.{Ok, Err, ApiError, api_error_handler}`.
- Produces: `app.routers.health.HealthData` (Pydantic model, field `db: str`) — this becomes the OpenAPI schema component named `HealthData` that `web/src/api/generated.ts` exposes; `app.routers.health.router` (APIRouter, prefix `/v1`); `app.main.app` (FastAPI instance) — imported by `scripts/dump_openapi.py` and by the Docker `CMD`.

- [ ] **Step 1: Write the failing health test**

Create `api/tests/test_health.py`:

```python
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import create_db_engine, get_db
from app.main import app


@pytest.fixture
def client(postgres_url: str) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def test_health_returns_ok_envelope(client: TestClient) -> None:
    response = client.get("/v1/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "data": {"db": "ok"}}


def test_health_returns_503_when_the_database_is_unreachable(client: TestClient) -> None:
    unreachable = create_db_engine("postgresql+psycopg://nobody:nobody@127.0.0.1:1/none")

    def broken_db() -> Iterator[Session]:
        with Session(unreachable) as session:
            yield session

    app.dependency_overrides[get_db] = broken_db
    try:
        response = client.get("/v1/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {
        "ok": False,
        "error": {"code": "DB_UNAVAILABLE", "message": "Database is not reachable."},
    }


def test_cors_allows_the_configured_origin(client: TestClient) -> None:
    response = client.options(
        "/v1/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_rejects_an_unlisted_origin(client: TestClient) -> None:
    response = client.options(
        "/v1/health",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert "access-control-allow-origin" not in response.headers
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_health.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 3: Implement the health router**

Create `api/app/routers/__init__.py` as an empty file, then create `api/app/routers/health.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.envelope import ApiError, Err, Ok

router = APIRouter(prefix="/v1", tags=["health"])


class HealthData(BaseModel):
    db: str


@router.get("/health", response_model=Ok[HealthData], responses={503: {"model": Err}})
def health(session: Annotated[Session, Depends(get_db)]) -> Ok[HealthData]:
    """Prove the process is up and the database is reachable.

    Uses SELECT 1 rather than querying a table, because SP1 deliberately
    creates no tables.
    """
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise ApiError(
            "DB_UNAVAILABLE",
            "Database is not reachable.",
            status_code=503,
        ) from exc
    return Ok(data=HealthData(db="ok"))
```

- [ ] **Step 4: Implement the application**

Create `api/app/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.envelope import ApiError, api_error_handler
from app.routers import health


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(title="secretbox API", version="0.1.0")

    # allow_credentials with a wildcard origin is rejected by browsers, and
    # SP2's session cookie depends on credentialed requests working.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_exception_handler(ApiError, api_error_handler)
    application.include_router(health.router)
    return application


app = create_app()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd api && uv run pytest tests/test_health.py -v`
Expected: 4 passed

- [ ] **Step 6: Run the full suite and lint**

Run: `make lint && make test`
Expected: no lint errors; 14 tests pass

- [ ] **Step 7: Commit**

```bash
git add api/app/routers api/app/main.py api/tests/test_health.py
git commit -m "feat(api): add GET /v1/health and assemble the application

SELECT 1 proves connectivity without requiring any table, so the baseline
migration can stay empty."
```

---

### Task 4: Alembic with an empty baseline revision

**Files:**
- Create: `api/alembic.ini`
- Create: `api/alembic/env.py`
- Create: `api/alembic/script.py.mako`
- Create: `api/alembic/versions/0001_baseline.py`
- Test: `api/tests/test_migrations.py`

**Interfaces:**
- Consumes: `app.db.Base`, `app.config.get_settings`.
- Produces: a migration chain whose head is revision `0001`. SP2 stacks its first real schema on top of it with `down_revision = "0001"`.

- [ ] **Step 1: Write the failing migration test**

Create `api/tests/test_migrations.py`:

```python
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from app.db import create_db_engine

API_ROOT = Path(__file__).resolve().parent.parent


def alembic_config(postgres_url: str) -> Config:
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", postgres_url)
    return config


def test_baseline_migration_applies_and_reverses(postgres_url: str) -> None:
    config = alembic_config(postgres_url)
    engine = create_db_engine(postgres_url)

    command.upgrade(config, "head")
    with engine.connect() as connection:
        version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert version == "0001"

    command.downgrade(config, "base")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM alembic_version")).scalar_one() == 0


def test_baseline_creates_no_domain_tables(postgres_url: str) -> None:
    """SP1 deliberately ships no schema. SP2 owns the first real tables."""
    config = alembic_config(postgres_url)
    engine = create_db_engine(postgres_url)

    command.upgrade(config, "head")
    try:
        tables = set(inspect(engine).get_table_names())
        assert tables == {"alembic_version"}
    finally:
        command.downgrade(config, "base")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_migrations.py -v`
Expected: FAIL — `alembic.ini` does not exist

- [ ] **Step 3: Create the Alembic configuration**

Create `api/alembic.ini`:

```ini
[alembic]
script_location = alembic
prepend_sys_path = .
version_path_separator = os
; Left empty on purpose. env.py falls back to Settings.database_url when this
; is unset, so production reads DATABASE_URL and tests can inject a URL.
sqlalchemy.url =

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARNING
handlers = console
qualname =

[logger_sqlalchemy]
level = WARNING
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

- [ ] **Step 4: Create the Alembic environment**

Create `api/alembic/env.py`:

```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import get_settings
from app.db import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# No models in SP1; SP2 imports them here so autogenerate sees them.
target_metadata = Base.metadata


def database_url() -> str:
    return config.get_main_option("sqlalchemy.url") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    config.set_main_option("sqlalchemy.url", database_url())
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 5: Create the revision template**

Create `api/alembic/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = ${repr(up_revision)}
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 6: Create the empty baseline revision**

Create `api/alembic/versions/0001_baseline.py`:

```python
"""Baseline.

Deliberately empty. Its purpose is to prove that Alembic is wired, runs
against Neon, and executes in Fly's release step, without inventing a table
that exists only to be dropped. SP2 stacks the first real schema on top by
setting down_revision = "0001".

Revision ID: 0001
Revises:
Create Date: 2026-08-03
"""

from collections.abc import Sequence

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd api && uv run pytest tests/test_migrations.py -v`
Expected: 2 passed

- [ ] **Step 8: Verify migrations run against local Compose Postgres**

```bash
make db-up
cp .env.example .env
cd api && uv run alembic upgrade head
```

Expected: `Running upgrade  -> 0001, Baseline`

- [ ] **Step 9: Add the migrate target to the Makefile**

In `Makefile`, add `migrate` to the `.PHONY` line and append:

```make
migrate: ## Apply migrations to the local database
	cd api && uv run alembic upgrade head
```

- [ ] **Step 10: Run lint and the full suite**

Run: `make lint && make test`
Expected: no lint errors; 16 tests pass

- [ ] **Step 11: Commit**

```bash
git add api/alembic.ini api/alembic api/tests/test_migrations.py Makefile
git commit -m "feat(api): configure Alembic with an empty baseline revision

Proves the migration path end to end without creating a throwaway table.
env.py falls back to Settings.database_url so tests can inject a URL."
```

---

### Task 5: Container image and Fly configuration

**Files:**
- Create: `api/Dockerfile`
- Create: `api/.dockerignore`
- Create: `api/fly.toml`

**Interfaces:**
- Consumes: `app.main:app` (Task 3), the Alembic chain (Task 4).
- Produces: a runtime image serving on port 8080 as a non-root user, and `fly.toml` declaring `release_command = "alembic upgrade head"`.

- [ ] **Step 1: Create the Docker ignore file**

Create `api/.dockerignore`:

```
.venv/
.pytest_cache/
.mypy_cache/
.ruff_cache/
__pycache__/
tests/
.env
```

- [ ] **Step 2: Create the Dockerfile**

Create `api/Dockerfile`:

```dockerfile
FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Dependencies first, so edits to application code reuse the cached layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
RUN uv sync --frozen --no-dev


FROM python:3.12-slim AS runtime

RUN useradd --create-home --uid 10001 appuser
WORKDIR /app

COPY --from=builder --chown=appuser:appuser /app /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

USER appuser
EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 3: Build the image**

Run: `docker build -t secretbox-api:dev api/`
Expected: build succeeds

- [ ] **Step 4: Verify the container runs as a non-root user**

Run: `docker run --rm secretbox-api:dev id -u`
Expected: `10001`

- [ ] **Step 5: Verify the container serves health against local Postgres**

```bash
make db-up
docker run --rm --network host \
  -e DATABASE_URL='postgresql+psycopg://secretbox:secretbox@localhost:5433/secretbox' \
  -e CORS_ORIGINS='http://localhost:5173' \
  -e ENVIRONMENT=local \
  --name secretbox-api-check -d secretbox-api:dev
sleep 3
curl -s localhost:8080/v1/health
docker stop secretbox-api-check
```

Expected: `{"ok":true,"data":{"db":"ok"}}`

If `--network host` is unavailable (Docker Desktop on macOS or Windows), use `-p 8080:8080` and `host.docker.internal` in the URL instead.

- [ ] **Step 6: Verify the container reports 503 without a database**

```bash
docker run --rm -p 8081:8080 \
  -e DATABASE_URL='postgresql+psycopg://nobody:nobody@127.0.0.1:1/none' \
  -e CORS_ORIGINS='' -e ENVIRONMENT=local \
  --name secretbox-api-down -d secretbox-api:dev
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' localhost:8081/v1/health
docker stop secretbox-api-down
```

Expected: `503`

- [ ] **Step 7: Create the Fly configuration**

`app` and `primary_region` are placeholders until Task 12 runs `fly launch`. Create `api/fly.toml`:

```toml
app = "secretbox-api"
primary_region = "sea"

[build]

[deploy]
  # Runs against Neon before the new machine takes traffic. This is what makes
  # the empty baseline revision worth having in SP1.
  release_command = "alembic upgrade head"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

- [ ] **Step 8: Verify the auto-stop block matches ADR 001 exactly**

Run: `grep -A2 'auto_stop_machines' api/fly.toml`
Expected: `auto_stop_machines = "stop"`, `auto_start_machines = true`, `min_machines_running = 0`. Idle cost approaching zero is the entire cost argument in ADR 001; a typo here is the failure mode that produces a surprise bill.

- [ ] **Step 9: Commit**

```bash
git add api/Dockerfile api/.dockerignore api/fly.toml
git commit -m "feat(api): add multi-stage Dockerfile and Fly configuration

Runs as uid 10001. fly.toml carries the ADR 001 auto-stop block and applies
migrations in the release command."
```

---

### Task 6: Offline OpenAPI schema dump

**Files:**
- Create: `api/scripts/dump_openapi.py`
- Test: `api/tests/test_dump_openapi.py`

**Interfaces:**
- Consumes: `app.main.app`.
- Produces: a script printing the OpenAPI document as JSON on stdout, deterministically ordered. Consumed by the `types` Makefile target (Task 8) and the `types-drift` CI check (Task 11).

- [ ] **Step 1: Write the failing dump test**

Create `api/tests/test_dump_openapi.py`:

```python
import json
import os
import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent


def run_dump() -> subprocess.CompletedProcess[str]:
    """Run the script with DATABASE_URL removed.

    The type pipeline must not need a database or a running server, so this
    deliberately strips the environment the rest of the suite sets up.
    """
    env = {
        "PATH": os.environ["PATH"],
        "PYTHONPATH": str(API_ROOT),
    }
    return subprocess.run(
        [sys.executable, "scripts/dump_openapi.py"],
        cwd=API_ROOT,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


def test_dump_runs_without_a_database_or_server() -> None:
    result = run_dump()

    assert result.returncode == 0, result.stderr


def test_dump_emits_the_health_path_and_envelope_schemas() -> None:
    schema = json.loads(run_dump().stdout)

    assert "/v1/health" in schema["paths"]
    assert "HealthData" in schema["components"]["schemas"]


def test_dump_is_deterministic() -> None:
    assert run_dump().stdout == run_dump().stdout
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && uv run pytest tests/test_dump_openapi.py -v`
Expected: FAIL — `can't open file 'scripts/dump_openapi.py'`, returncode 2

- [ ] **Step 3: Implement the dump script**

Create `api/scripts/dump_openapi.py`:

```python
"""Write the OpenAPI document to stdout.

Deliberately imports the FastAPI app object rather than fetching
/openapi.json from a running server: no process to start, no port to bind,
no readiness to poll. The Makefile `types` target and the `types-drift` CI
check both invoke this script, so they cannot diverge. (ADR 001 A3)
"""

import json
import os
import sys

# The app reads settings at import time for CORS. Nothing here touches the
# database, so a placeholder URL is correct rather than merely convenient.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://schema-dump/schema-dump")
os.environ.setdefault("CORS_ORIGINS", "")
os.environ.setdefault("ENVIRONMENT", "schema-dump")


def main() -> None:
    from app.main import app

    # sort_keys and a fixed indent keep the generated TypeScript diff-stable.
    json.dump(app.openapi(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && uv run pytest tests/test_dump_openapi.py -v`
Expected: 3 passed

- [ ] **Step 5: Inspect the output by hand**

Run: `cd api && uv run python scripts/dump_openapi.py | head -30`
Expected: JSON beginning with `"components"` (keys are sorted), containing a `HealthData` schema.

- [ ] **Step 6: Run lint and the full suite**

Run: `make lint && make test`
Expected: no lint errors; 19 tests pass

- [ ] **Step 7: Commit**

```bash
git add api/scripts/dump_openapi.py api/tests/test_dump_openapi.py
git commit -m "feat(api): dump the OpenAPI schema offline

Imports the app object instead of polling a live server, per ADR 001 A3.
Output is sorted and fixed-indent so generated types stay diff-stable."
```

---

### Task 7: Frontend scaffold and test harness

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/tsconfig.node.json`
- Create: `web/vite.config.ts`
- Create: `web/eslint.config.js`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/index.css`
- Create: `web/src/vite-env.d.ts`
- Create: `web/src/routes/router.tsx`
- Create: `web/src/test/setup.ts`
- Create: `web/.env.example`
- Test: `web/src/routes/router.test.tsx`
- Modify: `Makefile`

**Interfaces:**
- Consumes: nothing from the backend.
- Produces: `web/src/routes/router.tsx` exporting `router` (a `createBrowserRouter` instance) and `routes` (a `RouteObject[]` used by tests to build a memory router); `web/src/test/setup.ts` registering the MSW server lifecycle and exporting `server`.

Tailwind 4 is configured through the Vite plugin, so there is no `tailwind.config.ts` or `postcss.config.js`.

- [ ] **Step 1: Create the package definition**

Create `web/package.json`:

```json
{
  "name": "secretbox-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.62.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.1.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.17.0",
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "eslint": "^9.17.0",
    "eslint-plugin-react-hooks": "^5.1.0",
    "eslint-plugin-react-refresh": "^0.4.16",
    "globals": "^15.14.0",
    "jsdom": "^25.0.0",
    "msw": "^2.7.0",
    "openapi-typescript": "^7.5.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "typescript-eslint": "^8.19.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

Zustand, Zod, and React Hook Form are absent on purpose. (ADR 003 A5)

- [ ] **Step 2: Install dependencies**

Run: `cd web && npm install`
Expected: `web/package-lock.json` and `web/node_modules/` are created.

- [ ] **Step 3: Create the TypeScript configuration**

Three files, matching the layout `tsc -b` expects: an aggregator that owns no
files, plus one project per compilation target. A single combined
`tsconfig.json` does not build under `tsc -b`, because the root of a build
graph cannot both reference projects and compile sources.

Create `web/tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

Create `web/tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

Create `web/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noEmit": true
  },
  "include": ["vite.config.ts", "eslint.config.js"]
}
```

- [ ] **Step 4: Create the Vite configuration**

Create `web/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
```

- [ ] **Step 5: Create the ESLint configuration**

Create `web/eslint.config.js`:

```js
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/api/generated.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
```

`src/api/generated.ts` is ignored because it is generated and must never be hand-edited.

- [ ] **Step 6: Create the entry HTML, stylesheet, and example environment**

Create `web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>secretbox</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `web/src/index.css`:

```css
@import "tailwindcss";
```

Create `web/src/vite-env.d.ts`. Without it `import.meta.env` has no type and
`tsc -b` fails in strict mode as soon as Task 8 reads `VITE_API_URL`:

```ts
/// <reference types="vite/client" />
```

Create `web/.env.example`:

```bash
# Copy to .env.local for local development.
VITE_API_URL=http://localhost:8000
```

- [ ] **Step 7: Write the failing router test**

Create `web/src/routes/router.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { routes } from "./router";

describe("router", () => {
  it("renders the index route", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: /secretbox/i })).toBeInTheDocument();
  });

  it("renders a not-found message for an unknown path", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/nope"] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/page not found/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Create the test setup file**

Create `web/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

/** Shared MSW server. ADR 003 requires mocking at the fetch layer, not hooks. */
export const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `cd web && npm test`
Expected: FAIL — cannot resolve `./router`

- [ ] **Step 10: Implement the router**

Create `web/src/routes/router.tsx`:

```tsx
import { createBrowserRouter, type RouteObject } from "react-router";

function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">secretbox</h1>
    </main>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <p>Page not found.</p>
    </main>
  );
}

/** Exported separately so tests can build a memory router over them. */
export const routes: RouteObject[] = [
  { path: "/", element: <Home /> },
  { path: "*", element: <NotFound /> },
];

export const router = createBrowserRouter(routes);
```

- [ ] **Step 11: Create the application entry point**

Create `web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import "./index.css";
import { router } from "./routes/router";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd web && npm test`
Expected: 2 passed

- [ ] **Step 13: Verify typecheck, lint, and build**

Run: `cd web && npm run typecheck && npm run lint && npm run build`
Expected: all three succeed; `web/dist/` is produced.

- [ ] **Step 14: Extend the Makefile with web targets**

In `Makefile`, replace the `test` and `lint` targets with:

```make
test: ## Run backend and frontend tests
	cd api && uv run pytest
	cd web && npm test

lint: ## Run backend and frontend linters
	cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy app
	cd web && npm run lint && npm run typecheck
```

- [ ] **Step 15: Verify the Makefile targets**

Run: `make lint && make test`
Expected: backend and frontend both pass.

- [ ] **Step 16: Commit**

```bash
git add web/ Makefile
git commit -m "feat(web): scaffold Vite, React 19, Tailwind, Router, and Vitest

Installs only what SP1's walking skeleton exercises. Zustand, Zod, and React
Hook Form are deferred to SP2 and SP3 per ADR 003 A5."
```

---

### Task 8: Generated types and the typed API client

**Files:**
- Create: `web/src/api/generated.ts` (generated, committed)
- Create: `web/src/api/client.ts`
- Test: `web/src/api/client.test.ts`
- Modify: `Makefile`

**Interfaces:**
- Consumes: `api/scripts/dump_openapi.py` (Task 6); `server` from `web/src/test/setup.ts` (Task 7).
- Produces: `web/src/api/client.ts` exporting `ApiError` (class with `.code: string`, `.message: string`, `.status: number`) and `client` (object with `get<T>(path: string): Promise<T>`). `web/src/api/generated.ts` exporting `paths` and `components`, so `components["schemas"]["HealthData"]` resolves.

- [ ] **Step 1: Add the types target to the Makefile**

In `Makefile`, add `types` to `.PHONY` and append:

```make
types: ## Regenerate web/src/api/generated.ts from the FastAPI schema
	cd api && uv run python scripts/dump_openapi.py > $(CURDIR)/openapi.json
	cd web && npx openapi-typescript $(CURDIR)/openapi.json -o src/api/generated.ts
	rm -f $(CURDIR)/openapi.json
```

`openapi.json` at the repository root is already gitignored (Task 1).

- [ ] **Step 2: Generate the types**

Run: `make types`
Expected: `web/src/api/generated.ts` is created.

- [ ] **Step 3: Confirm the generated file has what later tasks need**

Run: `grep -n 'HealthData' web/src/api/generated.ts`
Expected: a `HealthData: { db: string; }` entry under `components["schemas"]`.

- [ ] **Step 4: Write the failing client test**

Create `web/src/api/client.test.ts`:

```ts
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { server } from "../test/setup";
import { ApiError, client } from "./client";

const BASE = "http://localhost:8000";

describe("client", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("returns data from the success arm of the envelope", async () => {
    server.use(
      http.get(`${BASE}/v1/health`, () =>
        HttpResponse.json({ ok: true, data: { db: "ok" } }),
      ),
    );

    await expect(client.get<{ db: string }>("/v1/health")).resolves.toEqual({ db: "ok" });
  });

  it("throws ApiError carrying the code and message from the failure arm", async () => {
    server.use(
      http.get(`${BASE}/v1/health`, () =>
        HttpResponse.json(
          { ok: false, error: { code: "DB_UNAVAILABLE", message: "Database is not reachable." } },
          { status: 503 },
        ),
      ),
    );

    await expect(client.get("/v1/health")).rejects.toMatchObject({
      name: "ApiError",
      code: "DB_UNAVAILABLE",
      message: "Database is not reachable.",
      status: 503,
    });
  });

  it("throws ApiError with NETWORK_ERROR when the request cannot be made", async () => {
    server.use(http.get(`${BASE}/v1/health`, () => HttpResponse.error()));

    await expect(client.get("/v1/health")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
  });

  it("throws ApiError with INVALID_RESPONSE when the body is not an envelope", async () => {
    server.use(http.get(`${BASE}/v1/health`, () => HttpResponse.json({ nope: true })));

    await expect(client.get("/v1/health")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("sends credentials so the session cookie is attached", async () => {
    let credentials: RequestCredentials | undefined;
    server.use(
      http.get(`${BASE}/v1/health`, ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json({ ok: true, data: { db: "ok" } });
      }),
    );

    await client.get("/v1/health");

    expect(credentials).toBe("include");
  });

  it("is an instance of ApiError, so callers can narrow on it", async () => {
    server.use(
      http.get(`${BASE}/v1/health`, () =>
        HttpResponse.json({ ok: false, error: { code: "X", message: "y" } }, { status: 400 }),
      ),
    );

    await expect(client.get("/v1/health")).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 5: Point the test environment at a base URL**

In `web/vite.config.ts`, add an `env` block inside `test` so `import.meta.env.VITE_API_URL` is defined under Vitest:

```ts
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    env: {
      VITE_API_URL: "http://localhost:8000",
    },
  },
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npm test -- src/api/client.test.ts`
Expected: FAIL — cannot resolve `./client`

- [ ] **Step 7: Implement the client**

Create `web/src/api/client.ts`:

```ts
/**
 * The single place the ADR 002 response envelope is narrowed.
 *
 * Components and TanStack Query hooks deal in domain types and thrown
 * errors, never in `{ ok, data }` wrappers. Letting `ok` checks spread into
 * components is the most likely way this codebase degrades. (ADR 003 A1)
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

const BASE_URL: string = import.meta.env.VITE_API_URL ?? "";

function isErrorBody(value: unknown): value is { code: string; message: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { code?: unknown; message?: unknown };
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

// Validates each arm rather than trusting `ok` alone. A body of {ok: false}
// with no error would otherwise reach body.error.code and throw a raw
// TypeError, which is exactly the contract this module exists to prevent.
function isEnvelope<T>(body: unknown): body is Envelope<T> {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { ok?: unknown; data?: unknown; error?: unknown };
  if (candidate.ok === true) {
    return "data" in candidate;
  }
  if (candidate.ok === false) {
    return isErrorBody(candidate.error);
  }
  return false;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { Accept: "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Could not reach the API.", 0);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("INVALID_RESPONSE", "The API returned a malformed response.", response.status);
  }

  if (!isEnvelope<T>(body)) {
    throw new ApiError("INVALID_RESPONSE", "The API returned a malformed response.", response.status);
  }

  if (!body.ok) {
    throw new ApiError(body.error.code, body.error.message, response.status);
  }

  return body.data;
}

export const client = {
  get: <T>(path: string): Promise<T> => request<T>(path),
};
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd web && npm test -- src/api/client.test.ts`
Expected: 6 passed

- [ ] **Step 9: Verify the drift check would catch a stale file**

`git diff` compares the working tree against the index, so the file has to be
tracked before this proves anything — an untracked file shows no diff and the
check would silently pass.

```bash
git add web/src/api/generated.ts
printf '\n// deliberate drift\n' >> web/src/api/generated.ts
git diff --exit-code -- web/src/api/generated.ts \
  && echo "NO DRIFT DETECTED, BUG" \
  || echo "drift detected as expected"
make types
git diff --exit-code -- web/src/api/generated.ts && echo "clean after regeneration"
```

Expected: `drift detected as expected`, then `clean after regeneration`. This
confirms the mechanism Task 11 relies on.

- [ ] **Step 10: Run lint, typecheck, and the full suite**

Run: `make lint && make test`
Expected: everything passes; 8 frontend tests.

- [ ] **Step 11: Commit**

```bash
git add web/src/api web/vite.config.ts Makefile
git commit -m "feat(web): generate API types and add the typed client

client.ts narrows the ADR 002 envelope exactly once, returning data or
throwing ApiError, so no ok checks reach components. (ADR 003 A1)"
```

---

### Task 9: Health feature end to end

**Files:**
- Create: `web/src/features/health/useHealth.ts`
- Create: `web/src/features/health/HealthPage.tsx`
- Create: `web/src/routes/NotFound.tsx`
- Create: `web/src/test/render.tsx`
- Test: `web/src/features/health/HealthPage.test.tsx`
- Modify: `web/src/routes/router.tsx`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: `client` and `ApiError` from `web/src/api/client.ts`; `components` from `web/src/api/generated.ts`; `server` from `web/src/test/setup.ts`.
- Produces: `useHealth(): UseQueryResult<HealthData, ApiError>`; `HealthPage` component; `renderWithProviders(ui: ReactElement): RenderResult` in `web/src/test/render.tsx`.

- [ ] **Step 1: Create the test render helper**

Create `web/src/test/render.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

/** A fresh client per test, with retries off so error states render at once. */
export function renderWithProviders(ui: ReactElement): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
```

- [ ] **Step 2: Write the failing health page test**

Create `web/src/features/health/HealthPage.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { server } from "../../test/setup";
import { HealthPage } from "./HealthPage";

const HEALTH = "http://localhost:8000/v1/health";

describe("HealthPage", () => {
  it("renders the loading state first", async () => {
    server.use(
      http.get(HEALTH, async () => {
        await delay(50);
        return HttpResponse.json({ ok: true, data: { db: "ok" } });
      }),
    );

    renderWithProviders(<HealthPage />);

    expect(screen.getByText(/checking/i)).toBeInTheDocument();
    expect(await screen.findByText(/database: ok/i)).toBeInTheDocument();
  });

  it("renders the database status on success", async () => {
    server.use(http.get(HEALTH, () => HttpResponse.json({ ok: true, data: { db: "ok" } })));

    renderWithProviders(<HealthPage />);

    expect(await screen.findByText(/database: ok/i)).toBeInTheDocument();
  });

  it("renders the error code and message on 503", async () => {
    server.use(
      http.get(HEALTH, () =>
        HttpResponse.json(
          { ok: false, error: { code: "DB_UNAVAILABLE", message: "Database is not reachable." } },
          { status: 503 },
        ),
      ),
    );

    renderWithProviders(<HealthPage />);

    expect(await screen.findByText(/DB_UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByText(/database is not reachable/i)).toBeInTheDocument();
  });

  it("renders a network failure without crashing", async () => {
    server.use(http.get(HEALTH, () => HttpResponse.error()));

    renderWithProviders(<HealthPage />);

    expect(await screen.findByText(/NETWORK_ERROR/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npm test -- src/features/health`
Expected: FAIL — cannot resolve `./HealthPage`

- [ ] **Step 4: Implement the query hook**

Create `web/src/features/health/useHealth.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { client, type ApiError } from "../../api/client";
import type { components } from "../../api/generated";

/** Derived from the Pydantic model. Changing HealthData in Python breaks tsc. */
export type HealthData = components["schemas"]["HealthData"];

export function useHealth(): UseQueryResult<HealthData, ApiError> {
  return useQuery<HealthData, ApiError>({
    queryKey: ["health"],
    queryFn: () => client.get<HealthData>("/v1/health"),
    retry: false,
  });
}
```

- [ ] **Step 5: Implement the page**

Create `web/src/features/health/HealthPage.tsx`:

```tsx
import { useHealth } from "./useHealth";

export function HealthPage() {
  const { data, error, isPending } = useHealth();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">secretbox</h1>

      {isPending && <p className="mt-4 text-slate-500">Checking API…</p>}

      {data && <p className="mt-4">Database: {data.db}</p>}

      {error && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-4">
          <p className="font-mono text-sm">{error.code}</p>
          <p className="text-sm">{error.message}</p>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd web && npm test -- src/features/health`
Expected: 4 passed

- [ ] **Step 7: Mount the page on the index route**

Task 7 left `router.tsx` exporting both components and non-component values,
which trips `react-refresh/only-export-components`. Resolve it here by moving
the last component out, so `router.tsx` holds routing configuration only.

Create `web/src/routes/NotFound.tsx`:

```tsx
export function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <p>Page not found.</p>
    </main>
  );
}
```

Then replace `web/src/routes/router.tsx` entirely:

```tsx
import { createBrowserRouter, type RouteObject } from "react-router";

import { HealthPage } from "../features/health/HealthPage";
import { NotFound } from "./NotFound";

/** Exported separately so tests can build a memory router over them. */
export const routes: RouteObject[] = [
  { path: "/", element: <HealthPage /> },
  { path: "*", element: <NotFound /> },
];

export const router = createBrowserRouter(routes);
```

`npm run lint` must now be warning-free, not merely exit zero.

- [ ] **Step 8: Update the router test for the new index route**

In `web/src/routes/router.test.tsx`, the index-route test now renders a component that issues a query, so it needs providers and a handler. Replace the file with:

```tsx
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../test/render";
import { server } from "../test/setup";
import { routes } from "./router";

describe("router", () => {
  it("renders the health page at the index route", async () => {
    server.use(
      http.get("http://localhost:8000/v1/health", () =>
        HttpResponse.json({ ok: true, data: { db: "ok" } }),
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: /secretbox/i })).toBeInTheDocument();
  });

  it("renders a not-found message for an unknown path", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/nope"] });

    renderWithProviders(<RouterProvider router={router} />);

    expect(await screen.findByText(/page not found/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Add the QueryClientProvider to the entry point**

Replace `web/src/main.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import "./index.css";
import { router } from "./routes/router";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 10: Run the whole frontend suite**

Run: `cd web && npm test`
Expected: 15 passed (2 router, 9 client, 4 health)

- [ ] **Step 11: Run lint, typecheck, and the full suite**

Run: `make lint && make test`
Expected: everything passes

- [ ] **Step 12: Commit**

```bash
git add web/src Makefile
git commit -m "feat(web): render API health through the generated client

Exercises the full path: Pydantic model, OpenAPI schema, generated types,
typed client, Query hook, rendered assertion."
```

---

### Task 10: Local developer workflow and README

**Files:**
- Modify: `Makefile`
- Create: `README.md`

**Interfaces:**
- Consumes: every target added so far.
- Produces: `make dev`, bringing up Postgres, the API with reload, and Vite from a clean checkout.

- [ ] **Step 1: Add the dev target**

In `Makefile`, add `dev` and `install` to `.PHONY` and append:

Also add `SHELL := /bin/bash` near the top of the file, above `.DEFAULT_GOAL`.
`wait -n` below is a bash builtin, and make otherwise runs recipes under
`/bin/sh`, which on many systems is dash and rejects it.

```make
install: ## Install backend and frontend dependencies
	cd api && uv sync
	cd web && npm install

dev: db-up migrate ## Run Postgres, the API with reload, and the Vite dev server
	@echo "API  -> http://localhost:8000"
	@echo "Web  -> http://localhost:5173"
	@trap 'kill 0' EXIT; \
	(cd api && uv run uvicorn app.main:app --reload --port 8000) & \
	(cd web && npm run dev) & \
	wait -n
```

`trap 'kill 0' EXIT` means one Ctrl-C stops both processes rather than
orphaning the API. `wait -n` returns as soon as the first job exits, so if one
server dies on its own the trap still fires and stops the other. A bare `wait`
would block until every job finished, leaving the survivor running.

- [ ] **Step 2: Verify the clean-checkout path**

```bash
git stash list  # confirm nothing is stashed you need
make db-down
rm -rf api/.venv web/node_modules
cp .env.example .env
cp web/.env.example web/.env.local
make install
make dev
```

Expected: Postgres starts, the baseline migration applies, uvicorn serves on 8000, Vite serves on 5173. Open `http://localhost:5173` and confirm it renders **Database: ok**.

Stop with Ctrl-C and confirm both processes exit.

- [ ] **Step 3: Write the README**

Create `README.md`:

````markdown
# secretbox

A self-hosted secret manager: encrypted key/value storage with a web UI and a
programmatic API for CI pipelines.

> **Status:** SP1, skeleton and pipeline. The application runs end to end
> locally and the deployment configuration is written and verified, but
> nothing is deployed yet. Provisioning the database, backend, frontend, and
> domain is the remaining step. No secrets are stored: there is no schema, no
> authentication, and no cryptography yet. See `docs/superpowers/specs/` for
> the sub-project plan and `docs/adr/` for the decision record.

Task 12 replaces this block with the live URLs once the deploy lands. Until
then it must not claim a running system.

## Architecture

```
browser → app.<domain>  (Vercel, React 19 + Vite)
                │  fetch, credentials: include
                ▼
          api.<domain>  (Fly.io, FastAPI in a container)
                │  SQLAlchemy, NullPool
                ▼
             Neon Postgres
```

## End-to-end type safety across Python and TypeScript

FastAPI emits an OpenAPI schema from the Pydantic models.
`openapi-typescript` compiles it into `web/src/api/generated.ts`, which is
committed.

```bash
make types
```

`api/scripts/dump_openapi.py` imports the FastAPI app object and writes the
schema to stdout: no server, no port, no readiness polling. CI runs the same
script and fails if the committed file differs.

The effect: **changing a response shape in Python breaks `tsc` in the
frontend.**

## Local development

Requires Docker, [uv](https://docs.astral.sh/uv/), and Node 20+.

```bash
cp .env.example .env
cp web/.env.example web/.env.local
make install
make dev
```

Then open <http://localhost:5173>.

| Target | Does |
|---|---|
| `make dev` | Postgres, API with reload, Vite dev server |
| `make test` | pytest and vitest |
| `make lint` | ruff, mypy, eslint, tsc |
| `make types` | Regenerate `web/src/api/generated.ts` |
| `make migrate` | Apply migrations locally |

## Repository layout

```
api/      FastAPI, SQLAlchemy (sync), Alembic, Dockerfile, fly.toml
web/      Vite, React 19, TanStack Query, Tailwind
docs/     ADRs and sub-project specs
```

## Testing

The backend runs against a real Postgres via testcontainers, not SQLite, because
database behaviour differences matter in this project. The frontend mocks at
the fetch layer with MSW rather than mocking hooks.

```bash
make test
```

## Threat model

Will be written up here in SP4, once there is something encrypted to reason
about. The short version, from ADR 002: secret values are encrypted with
AES-256-GCM under a per-bucket data key, itself wrapped by a key-encryption key
held outside the database. This protects against a stolen backup or a database
dump; it does not protect against a fully compromised application server.
````

- [ ] **Step 4: Commit**

```bash
git add Makefile README.md
git commit -m "feat: add make dev and project README

One Ctrl-C stops both dev processes. README documents the cross-language
type pipeline, which is the distinctive property of the project."
```

---

### Task 11: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `make`-equivalent commands from every previous task.
- Produces: three always-reporting checks named `api`, `web`, and `types-drift`, suitable as required status checks.

- [ ] **Step 1: Create the workflow**

Filtering happens **inside** jobs, not on triggers. A job skipped by a `paths:`
filter reports no status at all, so a required check never arrives and the pull
request cannot merge — a frontend-only change would block forever on an `api`
check that intentionally did not run. (ADR 001 A1)

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  # Superseded pull request runs are worth cancelling. Pushes to main are not:
  # cancelling one kills an in-flight deploy, and the job-level
  # deploy-production group cannot protect a run the workflow already cancelled.
  group: ci-${{ github.ref }}-${{ github.event_name }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

# Path filtering happens inside each job, never with a paths: key on the
# trigger or the job. A job skipped by a paths: filter reports no status at
# all, so a required check never arrives and the pull request cannot merge.
# Every job here checks out and evaluates its filter unconditionally, then
# skips the work but still reports. See ADR 0001 A1.
jobs:
  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            api:
              - 'api/**'
              - '.github/workflows/ci.yml'

      - name: Install uv
        if: steps.filter.outputs.api == 'true'
        uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true

      - name: Install dependencies
        if: steps.filter.outputs.api == 'true'
        working-directory: api
        run: uv sync --frozen

      - name: Ruff check
        if: steps.filter.outputs.api == 'true'
        working-directory: api
        run: uv run ruff check .

      - name: Ruff format check
        if: steps.filter.outputs.api == 'true'
        working-directory: api
        run: uv run ruff format --check .

      - name: Mypy
        if: steps.filter.outputs.api == 'true'
        working-directory: api
        run: uv run mypy app

      - name: Pytest
        # testcontainers needs a Docker daemon; ubuntu-latest runners have one.
        if: steps.filter.outputs.api == 'true'
        working-directory: api
        run: uv run pytest -v

      - name: No API changes
        if: steps.filter.outputs.api != 'true'
        run: echo "No changes under api/; nothing to check."

  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            web:
              - 'web/**'
              - '.github/workflows/ci.yml'

      - name: Setup Node
        if: steps.filter.outputs.web == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Install dependencies
        if: steps.filter.outputs.web == 'true'
        working-directory: web
        run: npm ci

      - name: ESLint
        if: steps.filter.outputs.web == 'true'
        working-directory: web
        run: npm run lint

      - name: Typecheck
        if: steps.filter.outputs.web == 'true'
        working-directory: web
        run: npm run typecheck

      - name: Vitest
        if: steps.filter.outputs.web == 'true'
        working-directory: web
        run: npm test

      - name: Build
        if: steps.filter.outputs.web == 'true'
        working-directory: web
        run: npm run build

      - name: No web changes
        if: steps.filter.outputs.web != 'true'
        run: echo "No changes under web/; nothing to check."

  types-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Install backend dependencies
        working-directory: api
        run: uv sync --frozen

      - name: Install frontend dependencies
        working-directory: web
        run: npm ci

      - name: Regenerate types
        run: make types

      - name: Fail if the committed types are stale
        run: |
          if ! git diff --exit-code -- web/src/api/generated.ts; then
            echo "::error::web/src/api/generated.ts is stale. Run 'make types' and commit the result."
            exit 1
          fi

  deploy:
    needs: [api, web, types-drift]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4

      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly
        working-directory: api
        run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

`types-drift` runs unconditionally with no filter: it is cheap, and it is the
one check that must notice a Python change the `web` filter would ignore.

- [ ] **Step 2: Push a branch and confirm all three checks report**

```bash
git checkout -b ci/verify
git add .github/workflows/ci.yml
git commit -m "ci: add lint, test, and type-drift checks"
git push -u origin ci/verify
gh pr create --fill --title "ci: add CI workflow" --body "Verifying checks report."
gh pr checks --watch
```

Expected: `api`, `web`, and `types-drift` all report and pass. `deploy` does not run.

- [ ] **Step 3: Prove a frontend-only change still reports all three checks**

This is the failure mode ADR 001 A1 exists to prevent.

```bash
printf '\n' >> web/src/index.css
git commit -am "style(web): whitespace to exercise path filtering"
git push
gh pr checks --watch
```

Expected: all three checks report. `api` reports success via its "No API changes" step.

- [ ] **Step 4: Prove the drift check fails on stale types**

```bash
printf '\n// stale\n' >> web/src/api/generated.ts
git commit -am "test: deliberately stale generated types"
git push
gh pr checks --watch
```

Expected: `types-drift` **fails** with the "is stale" error annotation.

- [ ] **Step 5: Restore the generated file and confirm the checks go green**

```bash
make types
git commit -am "fix(web): regenerate API types"
git push
gh pr checks --watch
```

Expected: all three checks pass.

- [ ] **Step 6: Restore the branch to a green state**

Undo the two deliberate breakages from Steps 3 and 4 if any remain, and confirm
the pull request is mergeable with all three checks passing.

**Do not merge here, and do not enable branch protection yet.** Both are
deferred until after the final whole-branch review, for two reasons. Merging
now would land CI on `main` ahead of the rest of SP1, leaving the trunk in a
state no review has covered. And enabling required status checks before the
first green merge exists can block that merge on checks GitHub has not yet
recorded a passing run for.

- [ ] **Step 7: Record what branch protection will require**

The settings to apply after SP1 merges, on `main`:
- Require a pull request before merging.
- Require status checks to pass: **`api`**, **`web`**, **`types-drift`**. Do not
  add `deploy`; it runs only after those three and gating on it would deadlock.

Applying them is a persistent change to repository configuration and belongs to
whoever owns the repository, not to the implementation run.

---

### Task 12: Production deployment and acceptance

**Files:**
- Create: `web/vercel.json` (only if Step 9 shows it is needed)
- Modify: `api/fly.toml` (app name and region from `fly launch`)
- Modify: `README.md` (record measured cold-start latency)

**Interfaces:**
- Consumes: everything above.
- Produces: a live system satisfying all eleven acceptance criteria in the spec.

This task requires the domain name, which the spec lists as an open question.
Buy it before starting. Everywhere below, replace `<domain>` with the real one.

- [ ] **Step 1: Create the Neon database and capture the pooled URL**

In the Neon console, create a project. Copy the **pooled** connection string —
the one whose host contains `-pooler`. Convert the scheme to
`postgresql+psycopg://`.

Verify it from your machine:

```bash
cd api && DATABASE_URL='<pooled-url>' uv run alembic upgrade head
```

Expected: `Running upgrade  -> 0001, Baseline`. This confirms the ADR 002
`NullPool` configuration cooperates with PgBouncer before anything depends on
it.

- [ ] **Step 2: Launch the Fly application**

```bash
cd api
fly launch --no-deploy --copy-config --name <your-app-name>
```

Answer **no** to creating a Postgres database and to creating Redis — Neon is
the database. Confirm `fly.toml` still contains the auto-stop block and the
`release_command` afterwards; `fly launch` sometimes rewrites the file.

- [ ] **Step 3: Set the Fly secrets**

```bash
fly secrets set \
  DATABASE_URL='<pooled-url>' \
  CORS_ORIGINS='https://app.<domain>' \
  ENVIRONMENT='production'
```

`SECRETS_KEK` is **not** set. Nothing decrypts in SP1, and an unvalidated secret
nobody reads is a configuration error that would go unnoticed. SP3 adds it with
a startup check.

- [ ] **Step 4: Deploy and confirm the release command ran**

```bash
fly deploy --remote-only
fly logs
```

Expected: the logs show the release command running `alembic upgrade head`, then
uvicorn starting on 8080.

- [ ] **Step 5: Point `api.<domain>` at Fly and verify (acceptance criterion 1)**

```bash
fly certs add api.<domain>
fly certs show api.<domain>
```

Add the DNS records it prints at your registrar, wait for the certificate to
issue, then:

```bash
curl -s https://api.<domain>/v1/health
```

Expected: `{"ok":true,"data":{"db":"ok"}}`

- [ ] **Step 6: Measure cold-start latency (spec risk: Fly cold start)**

```bash
fly machine list
fly machine stop <machine-id>
curl -s -o /dev/null -w 'cold start: %{time_total}s\n' https://api.<domain>/v1/health
curl -s -o /dev/null -w 'warm:       %{time_total}s\n' https://api.<domain>/v1/health
```

Record both numbers in the README's architecture section. ADR 001 A5 notes the
original rationale overclaimed here; SP3's crypto startup work should be
measured against a real figure.

- [ ] **Step 7: Deploy the frontend to Vercel**

Import the GitHub repository in Vercel with:
- **Root directory:** `web`
- **Framework preset:** Vite
- **Environment variable:** `VITE_API_URL` = `https://api.<domain>`

Then add `app.<domain>` as a custom domain and create the DNS record Vercel
specifies.

- [ ] **Step 8: Verify the deployed frontend (acceptance criterion 2)**

Open `https://app.<domain>`.
Expected: **Database: ok**.

If the browser console shows a CORS error, `CORS_ORIGINS` on Fly does not
exactly match the origin — it must be `https://app.<domain>` with no trailing
slash.

- [ ] **Step 9: Verify SPA deep links (acceptance criterion 10)**

This is the spec's named production-only risk.

Navigate directly to `https://app.<domain>/nope` — type it into the address bar
rather than clicking a link, so the request reaches the server.

Expected: the app's **"Page not found."** screen renders.

If instead you get Vercel's own 404 page, the SPA fallback is missing. Create
`web/vercel.json`:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Then commit, push to `main`, wait for redeploy, and re-test.

```bash
git add web/vercel.json
git commit -m "fix(web): add SPA rewrite so deep links resolve"
git push
```

- [ ] **Step 10: Verify auto-stop (acceptance criterion 9)**

Leave the application idle for roughly 10 minutes, then:

```bash
fly machine list
```

Expected: the machine's state is `stopped`. Then load `https://app.<domain>` and
confirm it starts again and health returns ok.

This is the entire cost argument from ADR 001. A machine that never stops is the
surprise-bill failure mode the whole platform choice was meant to avoid.

- [ ] **Step 11: Set a billing alert**

ADR 001 lists this as follow-up work. Set a spending limit or alert on the Fly
organisation, and confirm Neon is on the free tier.

Also complete the other ADR 001 follow-up: check the personal AWS account for a
running NAT Gateway from a prior project.

- [ ] **Step 12: Walk the full acceptance checklist**

Confirm each item from the spec:

1. `https://api.<domain>/v1/health` returns the ok envelope — Step 5
2. `https://app.<domain>` renders it through `generated.ts` — Step 8
3. A pull request turns `api`, `web`, `types-drift` green — Task 11 Step 2
4. Editing a Pydantic model without `make types` fails drift — Task 11 Step 4
5. A frontend-only PR reports all three checks — Task 11 Step 3
6. `make dev` works from a clean checkout — Task 10 Step 2
7. `make test` and `make lint` run both halves — Task 9 Step 11
8. `docker build` succeeds; container runs as non-root — Task 5 Steps 3–4
9. The Fly machine stops when idle and cold-starts — Step 10
10. Direct navigation to a nested URL loads the app — Step 9
11. The README describes architecture, setup, and the type pipeline — Task 10 Step 3

- [ ] **Step 13: Record the deployment details and commit**

Update the README's status note with the live URLs and the cold-start figures
from Step 6.

```bash
git add README.md api/fly.toml
git commit -m "docs: record live URLs and measured cold-start latency

Closes SP1. All eleven acceptance criteria verified against production."
git push
```

- [ ] **Step 14: Update the ADR open questions**

In `docs/adr/0001-repository-structure-and-deployment.md`, replace the "Domain
name not yet chosen" bullet under Open questions with the chosen domain, and
tick off the two follow-up items completed in Step 11.

```bash
git add docs/adr/0001-repository-structure-and-deployment.md
git commit -m "docs(adr): resolve the domain open question and follow-ups"
git push
```

---

## What SP1 deliberately leaves undone

Do not add these while implementing SP1. They belong to later sub-projects and
adding them early means untested, unreviewed code in the foundation.

| Deferred to | Items |
|---|---|
| **SP2** | Google OAuth, session storage, `users` schema, API key issuance and verification, Zod, React Hook Form. Replace the `sk_live_` prefix. (ADR 002 A6) |
| **SP3** | `KeyProvider`, `SECRETS_KEK` and its startup check, buckets and secrets schema, envelope encryption with length-prefixed AAD (ADR 002 A2), secret reveal UI, Zustand — with no `devtools` or `persist` middleware on the revealed-secrets store (ADR 003 A2) |
| **SP4** | Audit log, per-key rate limiting backed by shared storage (ADR 002 A7), security headers, threat model in the README |
| **v2** | Workspaces with members and roles; secret versioning with history (ADR 002 A5) |
