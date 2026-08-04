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
