import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.api_keys import create_key, generate_token
from app.auth.caller import Caller, CurrentCaller
from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import create_session
from app.buckets import create_bucket
from app.crypto.keys import EnvKeyProvider
from app.envelope import ApiError, api_error_handler
from app.models import ApiKey, Bucket, User

KEK_1 = bytes(range(32))
UNAUTHENTICATED_BODY = {
    "ok": False,
    "error": {"code": "UNAUTHENTICATED", "message": "Authentication is required."},
}


def provider() -> EnvKeyProvider:
    return EnvKeyProvider({1: KEK_1}, 1)


def seed_user(session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    return user


@pytest.fixture
def caller_app(migrated_engine: Engine) -> Iterator[TestClient]:
    """A one route app that reports what the caller resolved to.

    Built here rather than reusing the real app because the point is the
    dependency in isolation, before any endpoint adopts it.
    """
    application = FastAPI()
    application.add_exception_handler(ApiError, api_error_handler)

    @application.get("/probe")
    def probe(caller: CurrentCaller) -> dict[str, object]:
        return {
            "email": caller.user.email,
            "api_key_id": str(caller.api_key_id) if caller.api_key_id else None,
            "may_write": caller.may_write(),
            "may_reveal": caller.may_reveal(),
        }

    with TestClient(application) as client:
        yield client


def a_bucket(session: Session, user: User, name: str) -> Bucket:
    return create_bucket(session, provider(), user, name)


def test_a_session_resolves_to_its_user(caller_app: TestClient, db_session: Session) -> None:
    user = seed_user(db_session, "caller-session")
    token, _ = create_session(db_session, user)
    db_session.commit()
    caller_app.cookies.set(SESSION_COOKIE, token)

    body = caller_app.get("/probe").json()

    assert body["email"] == user.email
    assert body["api_key_id"] is None


def test_a_session_may_write_but_never_reveal(caller_app: TestClient, db_session: Session) -> None:
    """ADR 003 requires a browser can never reach bulk reveal, whatever the
    user owns. Putting that in the caller means an endpoint cannot bypass it
    by forgetting."""
    user = seed_user(db_session, "caller-session-rights")
    token, _ = create_session(db_session, user)
    db_session.commit()
    caller_app.cookies.set(SESSION_COOKIE, token)

    body = caller_app.get("/probe").json()

    assert body["may_write"] is True
    assert body["may_reveal"] is False


def test_a_key_resolves_to_its_owner_and_its_rights(
    caller_app: TestClient, db_session: Session
) -> None:
    user = seed_user(db_session, "caller-key")
    bucket = a_bucket(db_session, user, "callerkey")
    key, token = create_key(
        db_session,
        user,
        name="ci",
        buckets=[bucket],
        can_write=True,
        can_reveal=True,
        expires_at=None,
    )
    db_session.commit()

    body = caller_app.get("/probe", headers={"Authorization": f"Bearer {token}"}).json()

    assert body["email"] == user.email
    assert body["api_key_id"] == str(key.id)
    assert body["may_write"] is True
    assert body["may_reveal"] is True


def test_a_key_without_flags_may_neither_write_nor_reveal(
    caller_app: TestClient, db_session: Session
) -> None:
    user = seed_user(db_session, "caller-key-readonly")
    bucket = a_bucket(db_session, user, "readonly")
    create_key(
        db_session,
        user,
        name="ci",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()
    _, token = create_key(
        db_session,
        user,
        name="ci2",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()

    body = caller_app.get("/probe", headers={"Authorization": f"Bearer {token}"}).json()

    assert body["may_write"] is False
    assert body["may_reveal"] is False


def test_no_credential_is_unauthenticated(caller_app: TestClient) -> None:
    response = caller_app.get("/probe")

    assert response.status_code == 401
    assert response.json() == UNAUTHENTICATED_BODY


@pytest.mark.parametrize(
    ("label", "header"),
    [
        ("not bearer", "Basic abc"),
        ("bearer, no token", "Bearer"),
        ("bearer, empty token", "Bearer "),
        ("malformed token", "Bearer msm_short"),
        ("unknown key", "Bearer msm_deadbeef_notarealsecretvalue"),
        ("non ascii", "Bearer msm_deadbeef_café"),
    ],
)
def test_every_bad_header_gives_the_identical_401(
    caller_app: TestClient, label: str, header: str
) -> None:
    """One body for every failure, so nothing can be inferred from the
    difference. The non-ASCII case guards against hash_token ever being
    changed to compare raw strings: compare_digest raises TypeError on a str
    containing non-ASCII, which in SP2 escaped a failure path entirely and
    returned a 500 with a live credential still set. It is not reachable
    today, which is the point of keeping it.
    """
    # Passed as bytes rather than str: this pinned httpx2 client encodes a
    # str header value as strict ASCII before the request is even built, so
    # the non-ASCII case would never leave the test process. Bytes skip that
    # client-side encode and let the value reach the server as intended.
    response = caller_app.get("/probe", headers={b"Authorization": header.encode()})

    assert response.status_code == 401
    assert response.json() == UNAUTHENTICATED_BODY


def test_a_wrong_secret_a_revoked_key_and_an_expired_key_are_indistinguishable(
    caller_app: TestClient, db_session: Session
) -> None:
    """The three failures that need a real key to construct.

    Same body as a malformed or unknown token, so nothing about which
    failure occurred can be read off the response.
    """
    user = seed_user(db_session, "caller-three-failures")
    bucket = a_bucket(db_session, user, "threefailures")

    def issue() -> tuple[ApiKey, str]:
        return create_key(
            db_session,
            user,
            name="ci",
            buckets=[bucket],
            can_write=False,
            can_reveal=False,
            expires_at=None,
        )

    wrong_key, _ = issue()
    revoked, revoked_token = issue()
    expired, expired_token = issue()
    revoked.revoked_at = datetime.now(UTC)
    expired.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()
    wrong_secret = f"msm_{wrong_key.lookup_id}_{generate_token()[0].split('_', 2)[2]}"

    for token in (wrong_secret, revoked_token, expired_token):
        response = caller_app.get("/probe", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 401
        assert response.json() == UNAUTHENTICATED_BODY


def test_a_bad_header_does_not_fall_back_to_the_cookie(
    caller_app: TestClient, db_session: Session
) -> None:
    """A CI script whose key expired three weeks ago should be told, not
    silently served as whoever last logged in on that machine."""
    user = seed_user(db_session, "caller-no-fallback")
    token, _ = create_session(db_session, user)
    db_session.commit()
    caller_app.cookies.set(SESSION_COOKIE, token)

    response = caller_app.get("/probe", headers={"Authorization": "Bearer msm_deadbeef_nope"})

    assert response.status_code == 401
    assert response.json() == UNAUTHENTICATED_BODY


def test_using_a_key_records_that_it_was_used(caller_app: TestClient, db_session: Session) -> None:
    user = seed_user(db_session, "caller-touch")
    bucket = a_bucket(db_session, user, "callertouch")
    key, token = create_key(
        db_session,
        user,
        name="ci",
        buckets=[bucket],
        can_write=False,
        can_reveal=False,
        expires_at=None,
    )
    db_session.commit()

    caller_app.get("/probe", headers={"Authorization": f"Bearer {token}"})

    db_session.expire(key)
    assert key.last_used_at is not None


def test_may_access_is_about_scope_and_not_ownership() -> None:
    """A session answers yes to any bucket, because ownership was already
    settled by the lookup that produced it. This method answers only the
    scope question."""
    user = User(google_sub="x", email="x@example.com", name=None)
    bucket = Bucket(id=uuid.uuid4(), user_id=uuid.uuid4(), name="b", wrapped_dek=b"", kek_version=1)
    session_caller = Caller(
        user=user,
        api_key_id=None,
        can_write=True,
        can_reveal=False,
        scoped_bucket_ids=frozenset(),
    )
    key_caller = Caller(
        user=user,
        api_key_id=uuid.uuid4(),
        can_write=False,
        can_reveal=False,
        scoped_bucket_ids=frozenset({uuid.uuid4()}),
    )

    assert session_caller.may_access(bucket) is True
    assert key_caller.may_access(bucket) is False
