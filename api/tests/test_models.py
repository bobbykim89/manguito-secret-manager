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
