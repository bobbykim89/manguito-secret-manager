import os
from collections.abc import Iterator

import pytest
from testcontainers.community.postgres import PostgresContainer

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
