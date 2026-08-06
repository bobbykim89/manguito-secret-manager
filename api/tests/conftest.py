import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import Engine
from testcontainers.community.postgres import PostgresContainer

from app.db import create_db_engine

# Both assignments below have to agree. The CORS allowlist is the only
# security-relevant setting SP1 can test, and if the collection-time default
# and the fixture drift the test asserts against an origin the app never got.
DEV_ORIGIN = "http://localhost:5173"

# app.main builds the FastAPI app at import time, which validates Settings.
# Test modules import it at module scope, so these must be set before
# collection. The postgres_url fixture overwrites DATABASE_URL with the real
# container URL and clears the cached settings and engine.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://placeholder/placeholder")
os.environ.setdefault("CORS_ORIGINS", DEV_ORIGIN)
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-client-secret")
os.environ.setdefault("GOOGLE_REDIRECT_URI", "http://testserver/v1/auth/google/callback")
os.environ.setdefault("APP_URL", "http://testserver")


@pytest.fixture(scope="session")
def postgres_url() -> Iterator[str]:
    """A real Postgres for the whole test session.

    ADR 002 requires a real database rather than SQLite, because database
    behaviour differences matter in this project.
    """
    with PostgresContainer("postgres:17-alpine", driver="psycopg") as container:
        url = container.get_connection_url()
        os.environ["DATABASE_URL"] = url
        os.environ["CORS_ORIGINS"] = DEV_ORIGIN
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


@pytest.fixture(scope="session")
def migrated_engine(postgres_url: str) -> Iterator[Engine]:
    """An engine against a database with every migration applied.

    Session scoped because running Alembic per test would dominate the
    suite's runtime. Tests that write must clean up after themselves or use
    values unique to the test.
    """
    from alembic.config import Config

    from alembic import command

    api_root = Path(__file__).resolve().parent.parent
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))
    config.set_main_option("sqlalchemy.url", postgres_url)
    command.upgrade(config, "head")

    engine = create_db_engine(postgres_url)
    yield engine
    engine.dispose()
    command.downgrade(config, "base")
