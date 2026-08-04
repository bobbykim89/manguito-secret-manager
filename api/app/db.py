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
