import base64
import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session

from app.auth.sessions import (
    _TOKEN_BYTES,
    SESSION_LIFETIME,
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


def test_create_session_returns_the_plaintext_and_stores_only_the_hash(
    migrated_engine: Engine,
) -> None:
    with Session(migrated_engine) as session:
        user = make_user(session, "create-1")

        token, row = create_session(session, user)
        session.commit()

        assert row.token_hash == hash_token(token)
        stored_row = (
            session.execute(
                text("SELECT * FROM sessions WHERE token_hash = :hash"),
                {"hash": hash_token(token)},
            )
            .mappings()
            .one()
        )
        assert all(token not in str(value) for value in stored_row.values())
        stored = session.execute(select(UserSession.token_hash)).scalars().all()
        assert hash_token(token) in stored


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

        remaining = (
            session.execute(select(UserSession).where(UserSession.user_id == mine.id))
            .scalars()
            .all()
        )
        assert len(remaining) == 1
        assert lookup_session_user(session, my_live_token) == mine

        theirs_remaining = (
            session.execute(select(UserSession).where(UserSession.user_id == theirs.id))
            .scalars()
            .all()
        )
        assert len(theirs_remaining) == 1
