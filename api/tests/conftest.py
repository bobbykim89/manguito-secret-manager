import os
from collections.abc import Iterator

import pytest
from testcontainers.postgres import PostgresContainer


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
