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


def test_the_engine_hides_bound_parameters() -> None:
    """A wrapped DEK must not reach a log through a statement error.

    SQLAlchemy renders bound parameters into str(exc) for any DBAPI level
    failure, without truncating binary, and the unhandled exception handler
    logs that string at ERROR.
    """
    engine = create_db_engine("postgresql+psycopg://placeholder/placeholder")

    assert engine.hide_parameters is True
